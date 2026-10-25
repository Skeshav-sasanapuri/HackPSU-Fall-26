import { ArmLengths } from './body';
import { ArmPose } from './engine';
import { MoveId } from './moves';
import { estimateForce, powerScore } from './punch';
import { DEG, V3, angDeg } from './vec';

/* Rule-based move detector (lead arm only). It cuts the motion into segments (hand speed above a threshold),
 * describes each segment with a few numbers, and names it. Static covers (high guard, elbow block) are found from
 * held poses. Everything works in a lead-normalised heading frame: forward +z, up +y, the lead arm's side +x, with
 * hand positions divided by the arm's reach. It only labels moves; it never changes the displayed pose. */
export interface Detection {
  move: MoveId;
  /** segment start / end (ms, same clock as the input) */
  t: number;
  tEnd: number;
  peakSpeed: number;
  forceN: number;
  power: number;
  /** straightest elbow during the move (deg, 0 = fully straight) */
  extensionDeg: number;
  /** how far the elbow flared out to the side at full extension (deg) */
  flareDeg: number;
  /** elbow bend when the upper arm was furthest out (hooks; deg) */
  hookElbowDeg: number;
}

export interface SegmentFeatures {
  dz: number; dyUp: number; dyRise: number; yMean: number; sweepIn: number; outMax: number; phiMin: number;
  yAtZmax: number; yAtOut: number; vPeak: number; jabs: number; durMs: number; zStart: number;
  /** where the hand got furthest from its start, relative to the start (reach units): x lead side, y up, z forward */
  apex: V3;
}

const START = 1.5, END = 0.8, END_MS = 40, MAX_MS = 900;
const HOLD_STILL = 0.6, HOLD_MS = 350;
export const MIN_STRIKE_SPEED = 2.4;

interface Sample { t: number; h: V3; U: V3; D: V3; phi: number; v: number }

export class MoveDetector {
  private seg: Sample[] | null = null;
  private below: number | null = null;
  private still: number | null = null;
  private holdFired: MoveId | null = null;
  private fromHold: MoveId | null = null;
  /** the current pose looks like a guard */
  inGuard = false;
  last: SegmentFeatures | null = null;

  constructor(public lengths: ArmLengths, public bodyKg: number, public lead: 'left' | 'right' = 'left') {}

  private reach() { return this.lengths.upperArm + this.lengths.forearm + 0.09; }

  update(t: number, pose: ArmPose): Detection[] {
    const sx = this.lead === 'left' ? 1 : -1, R = this.reach();
    const U: V3 = [pose.U[0] * sx, pose.U[1], pose.U[2]];
    const D: V3 = [pose.D[0] * sx, pose.D[1], pose.D[2]];
    const h: V3 = [(pose.hand[0] * sx) / R, pose.hand[1] / R, pose.hand[2] / R];
    const phi = angDeg(U, D), v = pose.speed;
    const s: Sample = { t, h, U, D, phi, v };
    const out: Detection[] = [];
    this.inGuard = phi > 90 && D[1] > 0.35 && h[1] > -0.25;

    // static covers
    if (v < HOLD_STILL) {
      this.still ??= t;
      if (t - this.still >= HOLD_MS && !this.seg) {
        const held = holdPose(s);
        if (held && held !== this.holdFired) {
          this.holdFired = held;
          out.push({ move: held, t: this.still, tEnd: t, peakSpeed: 0, forceN: 0, power: 0, extensionDeg: phi, flareDeg: 0, hookElbowDeg: 0 });
        }
        if (!held) this.holdFired = null;
      }
    } else { this.still = null; }

    // moving segments
    if (!this.seg) {
      if (v > START) {
        this.seg = [s]; this.below = null;
        // leaving a cover: that motion is just the return to the guard
        this.fromHold = this.holdFired;
        this.holdFired = null;
      }
      return out;
    }
    this.seg.push(s);
    if (v < END) this.below ??= t; else this.below = null;
    const ended = (this.below != null && t - this.below >= END_MS) || t - this.seg[0].t > MAX_MS;
    if (!ended) return out;
    const seg = this.seg;
    this.seg = null;
    const f = features(seg);
    this.last = f;
    const move = classify(f);
    // leaving a cover is just the return to the guard, except a real punch out of a high guard (a tight guard can look like one)
    const fromHold = this.fromHold;
    this.fromHold = null;
    if (!move || (fromHold && (fromHold !== 'high guard' || f.vPeak < MIN_STRIKE_SPEED))) return out;
    const peak = seg.reduce((a, b) => (b.v > a.v ? b : a));
    const ext = seg.reduce((a, b) => (b.phi < a.phi ? b : a));
    const outS = seg.reduce((a, b) => (b.U[0] > a.U[0] ? b : a));
    const base = {
      t: seg[0].t, tEnd: t, peakSpeed: f.vPeak, forceN: estimateForce(f.vPeak, this.bodyKg), power: powerScore(f.vPeak, this.bodyKg),
      extensionDeg: f.phiMin, flareDeg: Math.max(0, Math.asin(Math.max(-1, Math.min(1, ext.U[0]))) / DEG), hookElbowDeg: outS.phi,
    };
    void peak;
    if (move === 'jab' && f.jabs >= 2) out.push({ ...base, move: 'double jab' });
    else out.push({ ...base, move });
    return out;
  }
}

function holdPose(s: Sample): MoveId | null {
  if (s.D[1] > 0.8 && s.h[1] > 0.08 && s.phi > 140 && s.h[2] < 0.3) return 'high guard';
  if (s.U[1] < -0.85 && s.h[1] < -0.3 && s.phi > 70) return 'elbow block';
  return null;
}

export function features(seg: Sample[]): SegmentFeatures {
  const z0 = seg[0].h[2], y0 = seg[0].h[1];
  let zmax = -9, ymax = -9, outMax = -9, phiMin = 999, yAtZmax = 0, yAtOut = 0, vPeak = 0, runMaxX = -9, sweepIn = 0, jabs = 0, armed = true;
  let runMinY = 9, dyRise = 0, ySum = 0, far = -1, apex: V3 = [0, 0, 0];
  const x0 = seg[0].h[0];
  for (const s of seg) {
    const ax = s.h[0] - x0, ay = s.h[1] - y0, az = s.h[2] - z0, r = ax * ax + ay * ay + az * az;
    if (r > far) { far = r; apex = [ax, ay, az]; }
    if (s.h[2] > zmax) { zmax = s.h[2]; yAtZmax = s.h[1]; }
    if (s.h[1] > ymax) ymax = s.h[1];
    if (s.U[0] > outMax) { outMax = s.U[0]; yAtOut = s.h[1]; }
    if (s.phi < phiMin) phiMin = s.phi;
    if (s.v > vPeak) vPeak = s.v;
    runMaxX = Math.max(runMaxX, s.h[0]);
    runMinY = Math.min(runMinY, s.h[1]);
    dyRise = Math.max(dyRise, s.h[1] - runMinY);
    ySum += s.h[1];
    sweepIn = Math.max(sweepIn, runMaxX - s.h[0]);
    if (armed && s.phi < 40) { jabs++; armed = false; }
    if (!armed && s.phi > 50) armed = true;
  }
  return { dz: zmax - z0, dyUp: ymax - y0, dyRise, yMean: ySum / seg.length, sweepIn, outMax, phiMin, yAtZmax, yAtOut, vPeak, jabs, durMs: seg[seg.length - 1].t - seg[0].t, zStart: z0, apex };
}

/* Order matters: the sideways sweep of a hook and the upward path of an uppercut are checked before the straight
 * line of a jab, because a hook or uppercut thrown with a fairly straight elbow would otherwise read as a jab.
 * The apex (where the hand got furthest from its start) says which way the punch actually went. */
export function classify(f: SegmentFeatures): MoveId | null {
  const strike = f.vPeak >= MIN_STRIKE_SPEED;
  const [, up, fwd] = f.apex;
  // hook: the upper arm swings out to the side and the hand sweeps back inward
  if (strike && f.sweepIn > 0.2 && f.outMax > 0.35 && fwd < 0.45) return f.yAtOut < -0.3 ? 'body hook' : 'hook';
  // uppercut: the hand travels mostly upward (or rises with the elbow kept bent)
  if (strike && f.outMax < 0.55 && ((up > 0.15 && up >= 0.6 * fwd) || (f.dyRise > 0.25 && f.phiMin >= 35 && f.dz > 0.12))) return 'uppercut';
  // jab: a straight line forward with the elbow (nearly) locked
  if (f.phiMin < 45 && f.dz > 0.2 && fwd > 0.15) {
    if (!strike) return 'feint';
    return f.yAtZmax < -0.2 ? 'body jab' : 'jab';
  }
  if (f.dz > 0.06 && f.phiMin >= 40 && f.phiMin < 95 && f.durMs < 450 && f.sweepIn < 0.15) return 'feint';
  if (f.sweepIn > 0.08 && f.dz < 0.2 && f.phiMin > 80 && f.yMean > -0.15) return 'parry';
  return null;
}
