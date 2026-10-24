import { armMassKg } from './body';
import { V3 } from './vec';

/* Finds punches in the hand-speed stream and estimates their force. Everything here is an estimate ("est.").
 * Effective mass: arm mass (~5% of body) times a body-contribution factor, plus a constant for the glove and fist.
 * Force ~ m_eff * v_peak / dt_impact with dt about 20 ms. */
export interface Punch {
  /** ms, same clock as the input */
  t: number;
  peakSpeed: number;
  /** estimated peak force, newtons */
  forceN: number;
  /** 0..100 power score from kinetic energy */
  power: number;
  durationMs: number;
  /** hand position (relative to the shoulder) at peak speed */
  peakHand: V3;
}

const START = 2.2;          // m/s: a punch begins
const END = 1.0;            // m/s: and ends once speed stays below this
const END_HOLD_MS = 60;
const MIN_PEAK = 2.8;       // smaller bursts are not punches
const MAX_MS = 700;
const IMPACT_S = 0.02;
const BODY_FACTOR = 1.6;
const FIST_KG = 0.6;
const ENERGY_FOR_100 = 270; // J: a hard amateur punch

export function effectiveMass(bodyKg: number) { return armMassKg(bodyKg) * BODY_FACTOR + FIST_KG; }
export function estimateForce(speed: number, bodyKg: number) { return (effectiveMass(bodyKg) * speed) / IMPACT_S; }
export function powerScore(speed: number, bodyKg: number) {
  return Math.min(100, Math.round((100 * 0.5 * effectiveMass(bodyKg) * speed * speed) / ENERGY_FOR_100));
}

export class PunchMeter {
  private active = false;
  private t0 = 0;
  private peak = 0;
  private peakHand: V3 = [0, 0, 0];
  private belowSince: number | null = null;

  constructor(public bodyKg: number) {}

  /** Feed one frame. Returns a punch when one has just finished. */
  update(t: number, speed: number, hand: V3): Punch | null {
    if (!this.active) {
      if (speed > START) { this.active = true; this.t0 = t; this.peak = speed; this.peakHand = hand; this.belowSince = null; }
      return null;
    }
    if (speed > this.peak) { this.peak = speed; this.peakHand = hand; }
    if (speed < END) this.belowSince ??= t; else this.belowSince = null;
    const ended = (this.belowSince != null && t - this.belowSince >= END_HOLD_MS) || t - this.t0 > MAX_MS;
    if (!ended) return null;
    this.active = false;
    if (this.peak < MIN_PEAK) return null;
    return {
      t: this.t0, peakSpeed: this.peak, forceN: estimateForce(this.peak, this.bodyKg), power: powerScore(this.peak, this.bodyKg),
      durationMs: t - this.t0, peakHand: this.peakHand,
    };
  }

  reset() { this.active = false; this.belowSince = null; }
}
