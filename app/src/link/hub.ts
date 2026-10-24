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
}
export interface HubStatus {
  relay: SocketState;
  phone: DeviceStatus;
  watch: DeviceStatus & { battery: number | null; rttMs: number | null; offsetMs: number | null };
  /** rolling angular-speed-ish activity 0..1 for the "move it and see" bars */
  activity: { phone: number; watch: number };
  sim: boolean;
}

class Counter {
  n = 0; hz = 0; last: number | null = null;
  private win = 0;
  hit(now: number, k = 1) { this.n += k; this.win += k; this.last = now; }
  tick() { this.hz = this.win; this.win = 0; }
  status(now: number, up: boolean): DeviceStatus {
    return { up, hz: up ? this.hz : 0, ageMs: this.last == null ? null : Math.round(now - this.last) };
  }
}

export abstract class DeviceHub implements UpperArmSource, ForearmSource {
  watchAxis: Clock = '3';
  protected watchCbs = new Set<(s: WatchSample) => void>();
  protected phoneCbs = new Set<(s: PhoneSample) => void>();
  protected wc = new Counter();
  protected pc = new Counter();
  protected battery: number | null = null;
  protected rtt: number | null = null;
  protected offset: number | null = null;
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
    this.wc.hit(arrival);
    const w = Math.hypot(...s.W);
    this.actW = Math.max(this.actW, Math.min(1, w / 8));
    this.lastW = s;
    for (const cb of this.watchCbs) cb(s);
  }
  protected ingestPhone(p: PhonePacket, arrival: number) {
    const s = decodePhone(p, arrival);
    this.pc.hit(arrival);
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
      watch: { ...this.wc.status(now, this.presence.watch && (this.wc.last != null && now - this.wc.last < 3000)), battery: this.battery, rttMs: this.rtt, offsetMs: this.offset },
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
  private samples: { rtt: number; offset: number }[] = [];
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
    if (!this.presence.watch) return;
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
      const t0 = this.pings.get(o.pong);
      this.pings.delete(o.pong);
      if (t0 == null || typeof o.tw !== 'number') return;
      const rtt = arrival - t0;
      this.samples.push({ rtt, offset: o.tw - (t0 + arrival) / 2 });
      if (this.samples.length > 30) this.samples.shift();
      const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.rtt = best.rtt; this.offset = best.offset;
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
    this.rtt = 6; this.offset = 0;
    // 25 frames/s, like the real devices: the watch sends 4 samples (100 Hz), the phone 2 (50 Hz)
    this.timer = setInterval(() => {
      const now = performance.now();
      const holding = now < this.holdUntil;
      if (!holding) this.scriptT += (now - this.last) / 1000;
      this.last = now;
      // inside the sim's opening hold (1..holdSec s) the arm is perfectly still in the calibration pose
      const t = holding ? this.arm.opt.holdSec - 1 : this.scriptT;
      for (let i = 3; i >= 0; i--) this.ingestWatch(this.arm.watchPacket(t - i * 0.01, now - i * 10), now);
      for (let i = 1; i >= 0; i--) this.ingestPhone(this.arm.phonePacket(t - i * 0.02, now - i * 20), now);
    }, 40);
  }
  stop() {
    super.stop();
    if (this.timer) clearInterval(this.timer);
  }
}
