import { ArmLengths, armFromHeight } from '../core/body';
import { ArmState, CALIBRATION_KEYS, GUARD_KEY, MOVE_KEYS, MoveId, guardState, moveDuration, sampleKeys, sampleMove } from '../core/moves';
import { PhonePacket, WatchPacket } from '../core/packets';
import {
  AXES, Clock, DEG, G0, M3, Q4, V3, add, cross, fromThree, matFromCols, matMul, matT, matVec, mul, nrm, perp, qE,
  qFromMat, rotAxis, sub, toThree, yawRot,
} from '../core/vec';

/* A simulated lead arm that produces exactly what the watch app and the phone page send, including a random heading
 * for each sensor, strap tilt, wobble and noise. Used by ?sim=1, by tools/simDevices.ts and by the unit tests.
 * Ground truth lives in the heading frame (forward = +z, up = +y, the lead arm's side = +x). */

export type { ArmState } from '../core/moves';
export type MoveName = 'hold' | 'guard' | MoveId;

export interface SimOptions {
  watchAxis?: Clock;
  phoneAxis?: Clock;
  /** heading of the watch's world / phone's world relative to the true heading frame (rad) */
  watchHeading?: number;
  phoneHeading?: number;
  /** strap tilt: angle between the phone's nominal axis and the real arm axis (deg) */
  strapTiltDeg?: number;
  wobbleDeg?: number;
  noise?: number;
  seed?: number;
  /** seconds the arm holds the calibration pose before the script starts */
  holdSec?: number;
  /** the moves the scripted arm cycles through */
  order?: MoveId[];
  lengths?: ArmLengths;
}

export interface ScriptItem { name: MoveName; t0: number; t1: number }

export class ArmSim {
  readonly opt: Required<Omit<SimOptions, 'lengths'>> & { lengths: ArmLengths };
  readonly script: ScriptItem[] = [];
  private rng: () => number;
  private phoneRoll: number;
  private tiltAxisDev: V3; // phone device-frame (sensor coords) arm axis, including strap tilt

  constructor(o: SimOptions = {}) {
    this.opt = {
      watchAxis: o.watchAxis ?? '3',
      phoneAxis: o.phoneAxis ?? '6',
      watchHeading: o.watchHeading ?? 1.9,
      phoneHeading: o.phoneHeading ?? -0.6,
      strapTiltDeg: o.strapTiltDeg ?? 12,
      wobbleDeg: o.wobbleDeg ?? 1.5,
      noise: o.noise ?? 1,
      seed: o.seed ?? 7,
      holdSec: o.holdSec ?? 4,
      order: o.order ?? ['jab', 'jab', 'double jab', 'hook', 'uppercut', 'body jab', 'parry', 'jab', 'hook', 'double jab'],
      lengths: o.lengths ?? armFromHeight(1.75),
    };
    let s = this.opt.seed >>> 0;
    this.rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.phoneRoll = this.rng() * 6.28;
    const nominal = AXES[this.opt.phoneAxis];
    const p = perp(toThree(nominal));
    this.tiltAxisDev = fromThree(nrm(rotAxis(toThree(nominal), p, this.opt.strapTiltDeg * DEG)));
    this.buildScript();
  }

  private gauss() {
    return Math.sqrt(-2 * Math.log(this.rng() + 1e-12)) * Math.cos(2 * Math.PI * this.rng());
  }

  private buildScript() {
    let t = this.opt.holdSec;
    const push = (name: MoveName, dur: number) => { this.script.push({ name, t0: t, t1: t + dur }); t += dur; };
    const order: MoveId[] = this.opt.order;
    for (let rep = 0; rep < 6; rep++) {
      for (const m of order) {
        push('guard', 0.7 + this.rng() * 0.8);
        push(m, moveDuration(m));
      }
    }
    push('guard', 1);
  }

  /** The move being performed at time t (seconds), 'hold' during calibration. */
  moveAt(t: number): MoveName {
    if (t < this.opt.holdSec) return 'hold';
    for (const s of this.script) if (t >= s.t0 && t < s.t1) return s.name;
    return 'guard';
  }

  /** When set, replaces the script (used by the "puppet" demo mode). */
  override: ((t: number) => ArmState) | null = null;

  /** Ground-truth arm in the heading frame. */
  truth(t: number): ArmState {
    if (this.override && t >= this.opt.holdSec) return this.override(t);
    if (t < this.opt.holdSec) {
      // ease into the calibration pose over the first second, then hold perfectly still
      return sampleKeys([GUARD_KEY, { ...CALIBRATION_KEYS[0], t: 1 }], t);
    }
    const m = this.moveAt(t);
    if (m === 'guard' || m === 'hold') return guardState();
    const item = this.script.find((s) => t >= s.t0 && t < s.t1)!;
    return sampleMove(m, t - item.t0);
  }

  /* ---- watch ---- */
  private watchRot(t: number): { R: M3; p: V3 } {
    const s = this.truth(t), hW = this.opt.watchHeading;
    const D = yawRot(s.D, hW), N = yawRot(s.N, hW), U = yawRot(s.U, hW);
    const ea = toThree(AXES[this.opt.watchAxis]), en: V3 = [0, 1, 0];
    const W = matFromCols(D, N, cross(D, N)), E = matFromCols(ea, en, cross(ea, en));
    const { upperArm, forearm } = this.opt.lengths;
    const p = add(add(mul(U, upperArm), mul(D, forearm - 0.02)), mul(N, 0.025));
    return { R: matMul(W, matT(E)), p };
  }

  watchPacket(t: number, wallMs = t * 1000): WatchPacket {
    const h = 1e-3, { R, p } = this.watchRot(t);
    const R1 = this.watchRot(t + h).R, R2 = this.watchRot(t - h).R;
    const M = matMul(R1, matT(R2));
    const w: V3 = [(M[2][1] - M[1][2]) / 2, (M[0][2] - M[2][0]) / 2, (M[1][0] - M[0][1]) / 2].map((v) => v / (2 * h)) as V3;
    const hh = 2e-3, pa = this.watchRot(t + hh).p, pb = this.watchRot(t - hh).p;
    const a = mul(add(sub(pa, mul(p, 2)), pb), 1 / (hh * hh));
    const n = this.opt.noise;
    const gl = (this.opt.wobbleDeg * DEG) * G0; // gravity leak from orientation error
    const aW = add(add(a, [0, G0, 0]), [Math.cos(0.4 * t) * gl * 0.3, 0, Math.sin(0.4 * t) * gl * 0.3]);
    const noise3 = (s: number): V3 => [this.gauss() * s * n, this.gauss() * s * n, this.gauss() * s * n];
    const RT = matT(R);
    const g = fromThree(matVec(RT, add(w, add(noise3(0.01), [0.004, 0, 0]))));
    const acc = fromThree(matVec(RT, add(aW, noise3(0.06))));
    const q = qE(qFromMat(R));
    const qn: Q4 = [q[0] + this.gauss() * 0.003 * n, q[1] + this.gauss() * 0.003 * n, q[2] + this.gauss() * 0.003 * n, q[3]];
    const l = Math.hypot(...qn);
    return { t: wallMs, dg: 0, da: 0, q: qn.map((v) => v / l) as Q4, g, a: acc };
  }

  /* ---- phone ---- */
  phonePacket(t: number, wallMs = t * 1000): PhonePacket {
    const s = this.truth(t);
    const n = this.opt.noise, wob = this.opt.wobbleDeg * DEG;
    // the strap shifts a little during a punch
    const wobAxis = perp(s.U);
    const U = rotAxis(s.U, wobAxis, wob * Math.sin(1.7 * t) * n + this.gauss() * 0.002 * n);
    const Uw = yawRot(U, this.opt.phoneHeading);
    const ea = toThree(this.tiltAxisDev);
    const eb = rotAxis(perp(ea), ea, this.phoneRoll);
    const wb = rotAxis(perp(Uw), Uw, this.phoneRoll);
    const R = matMul(matFromCols(Uw, wb, cross(Uw, wb)), matT(matFromCols(ea, eb, cross(ea, eb))));
    return { pq: qE(qFromMat(R)), t: wallMs };
  }
}
