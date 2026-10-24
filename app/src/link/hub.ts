import { PhoneSample, WatchPacket, PhonePacket, WatchSample, decodePhone, decodeWatch, isPhonePacket, isWatchPacket } from '../core/packets';
import { Clock } from '../core/vec';
import { ArmSim, SimOptions } from '../sim/armSim';
import { RELAY_WS } from './config';
import { RelaySocket, SocketState } from './relaySocket';

/* Everything the laptop knows about the two body-worn sensors. The rest of the app only sees this interface, so the
 * phone can later be swapped for an Arduino over Web Bluetooth (another UpperArmSource) without touching the screens. */
export interface UpperArmSource { onPhone(cb: (s: PhoneSample) => void): () => void }
export interface ForearmSource { onWatch(cb: (s: WatchSample) => void): () => void }

export interface DeviceStatus {
  up: boolean;
  /** samples per second over the last second */
  hz: number;
  /** ms since the last sample, null if none yet */
  ageMs: number | null;
  /** median sensor-to-laptop delay over the last samples (ms), null until the clocks are synced */
  latencyMs: number | null;
  /** best ping round trip laptop -> device -> laptop (ms) */
  rttMs: number | null;
}
export interface HubStatus {
  relay: SocketState;
  phone: DeviceStatus;
  watch: DeviceStatus & { battery: number | null };
  /** rolling angular-speed-ish activity 0..1 for the "move it and see" bars */
  activity: { phone: number; watch: number };
  sim: boolean;
}

/* NTP-style clock sync from ping/pong: keep the pong with the smallest round trip. offset = device clock - laptop clock. */
export class ClockSync {
  rtt: number | null = null;
  offset: number | null = null;
  private samples: { rtt: number; offset: number }[] = [];
  add(t0: number, t1: number, device: number) {
    this.samples.push({ rtt: t1 - t0, offset: device - (t0 + t1) / 2 });
    if (this.samples.length > 30) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.rtt = best.rtt; this.offset = best.offset;
  }
}

class Counter {
  n = 0; hz = 0; last: number | null = null;
  readonly sync = new ClockSync();
  private win = 0;
  private lat: number[] = [];
  hit(now: number, deviceT?: number) {
    this.n++; this.win++; this.last = now;
    if (deviceT != null && this.sync.offset != null) {
      this.lat.push(now - (deviceT - this.sync.offset));
      if (this.lat.length > 200) this.lat.shift();
    }
  }
  tick() { this.hz = this.win; this.win = 0; }
  status(now: number, up: boolean): DeviceStatus {
    const lat = this.lat.length ? [...this.lat].sort((a, b) => a - b)[this.lat.length >> 1] : null;
    return {
      up, hz: up ? this.hz : 0, ageMs: this.last == null ? null : Math.round(now - this.last),
      latencyMs: lat == null ? null : Math.round(lat), rttMs: this.sync.rtt == null ? null : Math.round(this.sync.rtt),
    };
  }
}

export abstract class DeviceHub implements UpperArmSource, ForearmSource {
  watchAxis: Clock = '3';
  protected watchCbs = new Set<(s: WatchSample) => void>();
  protected phoneCbs = new Set<(s: PhoneSample) => void>();
  protected wc = new Counter();
  protected pc = new Counter();
  protected battery: number | null = null;
  protected presence = { phone: false, watch: false };
  protected relayState: SocketState = 'down';
  private lastQ: PhoneSample | null = null;
  private lastW: WatchSample | null = null;
  private actW = 0;
  private actP = 0;
  private tick: ReturnType<typeof setInterval> | null = null;

  abstract readonly sim: boolean;
  /** subclasses call super.start() first */
  start() {
    this.tick ??= setInterval(() => {
      this.wc.tick(); this.pc.tick();
      this.actW *= 0.5; this.actP *= 0.5;
    }, 1000);
  }
  stop() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  onWatch(cb: (s: WatchSample) => void) { this.watchCbs.add(cb); return () => { this.watchCbs.delete(cb); }; }
  onPhone(cb: (s: PhoneSample) => void) { this.phoneCbs.add(cb); return () => { this.phoneCbs.delete(cb); }; }

  protected ingestWatch(p: WatchPacket, arrival: number) {
    const s = decodeWatch(p, this.watchAxis, arrival);
    this.wc.hit(arrival, p.t);
    const w = Math.hypot(...s.W);
    this.actW = Math.max(this.actW, Math.min(1, w / 8));
    this.lastW = s;
    for (const cb of this.watchCbs) cb(s);
  }
  protected ingestPhone(p: PhonePacket, arrival: number) {
    const s = decodePhone(p, arrival);
    this.pc.hit(arrival, p.t);
    if (this.lastQ) {
      const d = Math.abs(s.q[0] * this.lastQ.q[0] + s.q[1] * this.lastQ.q[1] + s.q[2] * this.lastQ.q[2] + s.q[3] * this.lastQ.q[3]);
      const ang = 2 * Math.acos(Math.min(1, d));
      const dt = Math.max((s.arrival - this.lastQ.arrival) / 1000, 1e-3);
      this.actP = Math.max(this.actP, Math.min(1, ang / dt / 8));
    }
    this.lastQ = s;
    for (const cb of this.phoneCbs) cb(s);
  }

  status(): HubStatus {
    const now = performance.now();
    return {
      relay: this.relayState,
      phone: this.pc.status(now, this.presence.phone && (this.pc.last != null && now - this.pc.last < 3000)),
      watch: { ...this.wc.status(now, this.presence.watch && (this.wc.last != null && now - this.wc.last < 3000)), battery: this.battery },
      activity: { phone: this.actP, watch: this.actW },
      sim: this.sim,
    };
  }
  get latestWatch() { return this.lastW; }
}

/* ---------- real devices through the relay ---------- */
export class RelayHub extends DeviceHub {
  readonly sim = false;
  private sock: RelaySocket;
  private pings = new Map<number, number>();
  private pid = 0;
  private pinger: ReturnType<typeof setInterval> | null = null;

  constructor(session: string) {
    super();
    this.sock = new RelaySocket(`${RELAY_WS}/s/${session}?role=viewer`, {
      onState: (s) => { this.relayState = s; if (s !== 'up') this.presence = { phone: false, watch: false }; },
      onMessage: (t, at) => this.onText(t, at),
    });
  }

  start() {
    super.start();
    this.sock.open();
    this.pinger = setInterval(() => this.ping(), 1000);
  }
  stop() {
    super.stop();
    if (this.pinger) clearInterval(this.pinger);
    this.sock.close();
  }

  private ping() {
    if (!this.presence.watch && !this.presence.phone) return;
    const id = ++this.pid, t0 = performance.now();
    this.pings.set(id, t0);
    if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value!);
    this.sock.send(JSON.stringify({ ping: id, tl: +t0.toFixed(3) }));
  }

  private onText(text: string, arrival: number) {
    let m: unknown;
    try { m = JSON.parse(text); } catch { return; }
    for (const x of Array.isArray(m) ? m : [m]) this.onMessage(x, arrival);
  }

  private onMessage(m: unknown, arrival: number) {
    if (isWatchPacket(m)) return this.ingestWatch(m, arrival);
    if (isPhonePacket(m)) return this.ingestPhone(m, arrival);
    const o = m as Record<string, unknown>;
    if (o.event === 'presence') {
      this.presence = { phone: !!o.phone, watch: !!o.watch };
    } else if (typeof o.pong === 'number') {
      // both devices answer the same ping: the watch with "tw" (its clock), the phone with "tp"
      const t0 = this.pings.get(o.pong);
      if (t0 == null) return;
      if (typeof o.tw === 'number') this.wc.sync.add(t0, arrival, o.tw);
      if (typeof o.tp === 'number') this.pc.sync.add(t0, arrival, o.tp);
    } else if (typeof o.bat === 'number') {
      this.battery = o.bat;
    }
  }
}

/* ---------- simulated devices (?sim=1) ---------- */
export class SimHub extends DeviceHub {
  readonly sim = true;
  readonly arm: ArmSim;
  private last = 0;
  private scriptT = 0;
  private holdUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SimOptions = {}) {
    super();
    this.arm = new ArmSim(opts);
  }

  /** The simulated arm holds the calibration pose for the next `ms`, then carries on with its script. */
  holdFor(ms: number) { this.holdUntil = performance.now() + ms; }

  start() {
    super.start();
    this.last = performance.now();
    this.relayState = 'up';
    this.presence = { phone: true, watch: true };
    this.battery = 88;
    // the simulator stamps packets with the laptop clock
    this.wc.sync.add(0, 0, 0); this.pc.sync.add(0, 0, 0);
    // like the real devices: the watch sends 2 samples per frame (100 Hz), the phone about 50 Hz
    this.timer = setInterval(() => {
      const now = performance.now();
      const holding = now < this.holdUntil;
      if (!holding) this.scriptT += (now - this.last) / 1000;
      this.last = now;
      // inside the sim's opening hold (1..holdSec s) the arm is perfectly still in the calibration pose
      const t = holding ? this.arm.opt.holdSec - 1 : this.scriptT;
      for (let i = 1; i >= 0; i--) this.ingestWatch(this.arm.watchPacket(t - i * 0.01, now - i * 10), now);
      this.ingestPhone(this.arm.phonePacket(t, now), now);
    }, 20);
  }
  stop() {
    super.stop();
    if (this.timer) clearInterval(this.timer);
  }
}
