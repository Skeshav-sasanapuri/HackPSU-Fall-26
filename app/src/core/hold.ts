import { Calibration, calibrate } from './calibration';
import { PhoneSample, WatchSample } from './packets';
import { Clock, Q4, V3, len } from './vec';

/* Records the calibration hold. The user holds the ghost pose for HOLD_MS; we use the samples from 2.0 s to 0.2 s
 * before the end (as the old mirror page did) and refuse the result if the arm moved. */
export const HOLD_MS = 2300;
const WINDOW_START = 2000, WINDOW_END = 200;
const MAX_STILL_RAD_S = 1.2;

export class HoldRecorder {
  private watch: { t: number; D: V3; N: V3; w: number }[] = [];
  private phone: { t: number; q: Q4 }[] = [];

  pushWatch(s: WatchSample) { this.watch.push({ t: s.arrival, D: s.D, N: s.N, w: len(s.W) }); }
  pushPhone(s: PhoneSample) { this.phone.push({ t: s.arrival, q: s.q }); }

  /** `now` in the same clock as sample arrival (performance.now()). */
  finish(now: number, phoneAxis: Clock, usePhone: boolean): Calibration | { error: string } {
    const inWin = (t: number) => now - t <= WINDOW_START && now - t >= WINDOW_END;
    const w = this.watch.filter((s) => inWin(s.t));
    if (w.length && Math.max(...w.map((s) => s.w)) > MAX_STILL_RAD_S) return { error: 'You moved during the hold. Keep the arm still and try again.' };
    const p = this.phone.filter((s) => inWin(s.t));
    return calibrate({ D: w.map((s) => s.D), N: w.map((s) => s.N), phoneQ: usePhone ? p.map((s) => s.q) : null, phoneAxis });
  }
}
