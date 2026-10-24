import { ArmLengths } from './body';
import { Calibration, upperArmDir } from './calibration';
import { PhoneSample, WatchSample } from './packets';
import { V3, add, len, mul, nrm, sub, yawRot } from './vec';

/* Turns the latest watch + phone samples into one arm pose in the heading frame (forward = +z, up = +y).
 * Hand position assumes the shoulder is fixed: hand = L1*U + (L2 + hand)*D. Speed is a finite difference of that,
 * smoothed, capped at 25 m/s (same as the old mirror page). */
export interface ArmPose {
  /** upper arm direction (shoulder -> elbow) */
  U: V3;
  /** forearm direction (elbow -> wrist) */
  D: V3;
  /** palm normal */
  N: V3;
  /** hand position relative to the shoulder (m) */
  hand: V3;
  /** hand speed (m/s), lightly smoothed: use for punch peaks */
  speed: number;
  /** hand speed (m/s), heavily smoothed: use for gauges */
  speedSmooth: number;
  /** hand velocity (m/s), smoothed */
  vel: V3;
}

const MAX_SPEED = 25;
/** wrist -> middle of the fist along the forearm axis (m) */
const HAND_REACH = 0.09;
const SPEED_TAU = 0.12;
const SPEED_TAU_FAST = 0.03;

export class ArmEngine {
  private watch: WatchSample | null = null;
  private phone: PhoneSample | null = null;
  private prevHand: V3 | null = null;
  private prevT = 0;
  private speed = 0;
  private speedSmooth = 0;
  private vel: V3 = [0, 0, 0];
  cal: Calibration | null = null;

  constructor(public lengths: ArmLengths) {}

  setCalibration(cal: Calibration | null) {
    this.cal = cal;
    this.prevHand = null;
    this.speed = 0;
    this.speedSmooth = 0;
    this.vel = [0, 0, 0];
  }
  pushWatch(s: WatchSample) { this.watch = s; }
  pushPhone(s: PhoneSample) { this.phone = s; }

  /** Pose at time `now` (performance.now() ms), or null before calibration / without data. */
  pose(now: number): ArmPose | null {
    const cal = this.cal;
    if (!cal || !this.watch) return null;
    const D = nrm(yawRot(this.watch.D, cal.yaw));
    const N = nrm(yawRot(this.watch.N, cal.yaw));
    const U = cal.phone && this.phone ? nrm(upperArmDir(cal.phone, this.phone.q)) : D;
    const { upperArm, forearm } = this.lengths;
    const hand = add(mul(U, upperArm), mul(D, forearm + HAND_REACH));
    if (this.prevHand && now > this.prevT) {
      const dt = (now - this.prevT) / 1000;
      if (dt < 0.2) {
        const raw = mul(sub(hand, this.prevHand), 1 / dt);
        const k = 1 - Math.exp(-dt / SPEED_TAU);
        this.vel = add(this.vel, mul(sub(raw, this.vel), k));
        const sp = Math.min(len(raw), MAX_SPEED);
        this.speedSmooth += (sp - this.speedSmooth) * k;
        this.speed += (sp - this.speed) * (1 - Math.exp(-dt / SPEED_TAU_FAST));
      }
    }
    this.prevHand = hand;
    this.prevT = now;
    return { U, D, N, hand, speed: this.speed, speedSmooth: this.speedSmooth, vel: this.vel };
  }
}
