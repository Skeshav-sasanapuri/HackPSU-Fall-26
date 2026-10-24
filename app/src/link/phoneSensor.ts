import { Q4, V3, dot, qconj, qrot } from '../core/vec';
import { RELAY_WS } from './config';
import { RelaySocket, SocketState } from './relaySocket';

/* The phone side: reads the orientation sensor and streams it to the session room. Ported from laptop/phone.html.
 * Sensing stops when the page is in the background or the screen is off, so we hold a screen wake lock. */
export type SensorState = 'idle' | 'running' | 'error' | 'unsupported' | 'blocked' | 'insecure';

export interface PhoneState {
  socket: SocketState;
  /** is the laptop in the room */
  viewer: boolean;
  sensor: SensorState;
  message: string;
  hz: number;
  /** quaternion convention check against gravity */
  conv: 'pending' | 'ok' | 'inverted' | 'assumed';
  wake: 'unknown' | 'yes' | 'no';
  hidden: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export class PhoneSensor {
  state: PhoneState = { socket: 'down', viewer: false, sensor: 'idle', message: '', hz: 0, conv: 'pending', wake: 'unknown', hidden: false };
  private sock: RelaySocket;
  private sensor: any = null;
  private acc: any = null;
  private wakeLock: any = null;
  private lastQ: Q4 | null = null;
  private convMode: 'A' | 'B' | null = null;
  private scoreA = 0; private scoreB = 0; private nScore = 0;
  private buf: { pq: number[]; t: number }[] = [];
  private sentWin = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private t0 = 0;
  private onVis = () => this.visibility();

  constructor(session: string, private onChange: (s: PhoneState) => void) {
    this.sock = new RelaySocket(`${RELAY_WS}/s/${session}?role=phone`, {
      onState: (s) => this.set({ socket: s, ...(s !== 'up' ? { viewer: false } : {}) }),
      onMessage: (t) => {
        try {
          const m = JSON.parse(t);
          if (m && m.event === 'presence') this.set({ viewer: !!m.viewer });
          // clock sync: answer with the phone clock so the laptop can measure the delay
          else if (m && typeof m.ping === 'number') this.sock.send(JSON.stringify({ pong: m.ping, tl: m.tl, tp: +performance.now().toFixed(2) }));
        } catch { /* not for us */ }
      },
    });
  }

  private set(p: Partial<PhoneState>) {
    this.state = { ...this.state, ...p };
    this.onChange(this.state);
  }

  connect() {
    this.sock.open();
    if (!window.isSecureContext) this.set({ sensor: 'insecure', message: 'This page needs a secure (https) address to read the motion sensors.' });
    else if (!('RelativeOrientationSensor' in window)) this.set({ sensor: 'unsupported', message: 'This browser cannot read the orientation sensor. Use Chrome on an Android phone.' });
    document.addEventListener('visibilitychange', this.onVis);
    this.timers.push(setInterval(() => { this.set({ hz: this.sentWin }); this.sentWin = 0; }, 1000));
  }

  disconnect() {
    this.stop();
    this.sock.close();
    document.removeEventListener('visibilitychange', this.onVis);
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  async start() {
    if (this.state.sensor === 'running' || this.state.sensor === 'insecure' || this.state.sensor === 'unsupported') return;
    try {
      for (const name of ['accelerometer', 'gyroscope']) {
        try {
          const r = await navigator.permissions.query({ name } as any);
          if (r.state === 'denied') { this.set({ sensor: 'blocked', message: 'Motion sensors are blocked for this site. In Chrome open Site settings > Motion sensors and allow them.' }); return; }
        } catch { /* permission name not supported */ }
      }
      this.t0 = performance.now();
      this.convMode = null; this.scoreA = this.scoreB = this.nScore = 0;
      this.set({ conv: 'pending' });
      const w = window as any;
      this.sensor = new w.RelativeOrientationSensor({ frequency: 60, referenceFrame: 'device' });
      this.acc = new w.Accelerometer({ frequency: 30, referenceFrame: 'device' });
      this.sensor.onerror = (e: any) => this.set({ sensor: 'error', message: `Orientation sensor error: ${e?.error?.name ?? 'unknown'}` });
      this.acc.onerror = () => { /* the accelerometer is only used for the convention check */ };
      this.acc.onreading = () => { if (this.lastQ) this.checkConv([this.acc.x, this.acc.y, this.acc.z], this.lastQ); };
      this.sensor.onreading = () => this.reading();
      this.sensor.start();
      this.acc.start();
      this.set({ sensor: 'running', message: '' });
      this.timers.push(setInterval(() => this.flush(), 33));
      await this.takeWakeLock();
    } catch (e: any) {
      this.set({ sensor: 'error', message: `Could not start: ${e?.message ?? e}` });
    }
  }

  stop() {
    try { this.sensor?.stop(); this.acc?.stop(); } catch { /* ignore */ }
    this.sensor = this.acc = null;
    try { this.wakeLock?.release(); } catch { /* ignore */ }
    this.wakeLock = null;
    if (this.state.sensor === 'running') this.set({ sensor: 'idle' });
  }

  private reading() {
    const q = this.sensor?.quaternion;
    if (!q) return;
    this.lastQ = [q[0], q[1], q[2], q[3]];
    // Could not verify against gravity within 6 s: assume the standard device->world convention.
    if (this.convMode == null && performance.now() - this.t0 > 6000) { this.convMode = 'A'; this.set({ conv: 'assumed' }); }
    if (this.convMode == null) return;
    const out = this.convMode === 'B' ? qconj(this.lastQ) : this.lastQ;
    this.buf.push({ pq: out.map((v) => +v.toFixed(5)), t: +performance.now().toFixed(1) });
    // send at once: waiting to batch adds up to a frame of lag (about 60 small messages a second)
    this.flush();
  }

  /* The quaternion should be device->world (like Android's rotation vector). Do not assume it: the accelerometer
   * includes gravity so it points "up" in the device frame; pick the convention that agrees. */
  private checkConv(g: V3, q: Q4) {
    const m = Math.hypot(...g);
    if (m < 8.3 || m > 11.3) return; // phone is accelerating; skip
    const gn: V3 = [g[0] / m, g[1] / m, g[2] / m];
    this.scoreA += dot(gn, qrot(qconj(q), [0, 0, 1]));
    this.scoreB += dot(gn, qrot(q, [0, 0, 1]));
    this.nScore++;
    if (this.convMode == null && this.nScore >= 40) {
      const a = this.scoreA / this.nScore, b = this.scoreB / this.nScore;
      if (Math.max(a, b) > 0.85) {
        this.convMode = a >= b ? 'A' : 'B';
        this.set({ conv: this.convMode === 'A' ? 'ok' : 'inverted' });
      } else { this.nScore = 0; this.scoreA = this.scoreB = 0; }
    }
  }

  private flush() {
    if (!this.buf.length) return;
    // two samples per frame is the usual case (60 Hz sensor, ~30 frames/s)
    if (this.sock.send(JSON.stringify(this.buf))) this.sentWin += this.buf.length;
    this.buf = [];
  }

  private async takeWakeLock() {
    try {
      this.wakeLock = await (navigator as any).wakeLock.request('screen');
      this.set({ wake: 'yes' });
    } catch { this.set({ wake: 'no' }); }
  }

  private visibility() {
    const hidden = document.visibilityState === 'hidden';
    this.set({ hidden });
    if (!hidden && this.state.sensor === 'running') void this.takeWakeLock();
  }
}
