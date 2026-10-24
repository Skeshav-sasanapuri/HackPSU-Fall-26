import { AXES, Clock, DEG, Q4, V3, angDeg, fromThree, mean, nrm, qconj, qrot, toThree, yawRot } from './vec';

/* Calibration pose ("ghost pose"): arm straight out in front, palm flat, held still.
 * Neither the watch's game rotation vector nor the phone's relative orientation sensor knows north, so each has its own
 * arbitrary heading. Holding the pose lets us rotate both into one heading frame with forward = +z. */

export interface PhoneCal {
  /** actual arm axis (shoulder -> elbow) in the PHONE device frame; absorbs strap tilt */
  aP: V3;
  /** heading of the phone's world relative to the heading frame */
  yawP: number;
  /** degrees between aP and the axis the user said (large means the wrong Shoulder/Elbow choice) */
  tiltDeg: number;
  axis: Clock;
}

export interface Calibration {
  /** heading of the watch's world relative to the heading frame */
  yaw: number;
  phone: PhoneCal | null;
  /** reference palm normal in the heading frame */
  nRef: V3;
  warnings: string[];
  /** the recorded hold, so the phone axis can be re-applied without holding the pose again */
  input: CalInput;
}

export interface CalInput {
  /** forearm directions and face normals recorded during the hold (watch frame, raw) */
  D: V3[];
  N: V3[];
  /** phone orientations (three-frame quaternions) recorded during the hold, or null when no phone is used */
  phoneQ: Q4[] | null;
  /** which clock direction of the PHONE points from the shoulder toward the elbow: '6' if the top edge points to the shoulder */
  phoneAxis: Clock;
}

export const MIN_WATCH_SAMPLES = 40;
export const MIN_PHONE_SAMPLES = 20;

export function calibrate(inp: CalInput): Calibration | { error: string } {
  if (inp.D.length < MIN_WATCH_SAMPLES) return { error: 'Not enough data from the watch.' };
  const d = nrm(mean(inp.D));
  const n = nrm(mean(inp.N));
  const yaw = Math.atan2(-d[0], d[2]);
  const dd = yawRot(d, yaw); // forearm in heading frame (about +z)
  const warnings: string[] = [];

  let phone: PhoneCal | null = null;
  if (inp.phoneQ) {
    if (inp.phoneQ.length < MIN_PHONE_SAMPLES) return { error: 'No data from the phone yet.' };
    const ax0 = AXES[inp.phoneAxis];
    const us = mean(inp.phoneQ.map((q) => qrot(q, toThree(ax0))));
    const yawP = Math.atan2(-us[0], us[2]);
    const ut = yawRot(dd, -yawP); // true upper-arm direction (= forearm in this pose) in the phone's world
    const aP = nrm(mean(inp.phoneQ.map((q) => fromThree(qrot(qconj(q), ut)))));
    const tiltDeg = angDeg(aP, ax0);
    phone = { aP, yawP, tiltDeg, axis: inp.phoneAxis };
    if (tiltDeg > 35) warnings.push(`The phone's axis is ${Math.round(tiltDeg)}° from where you said it points. Check which way its top edge faces.`);
  }

  const elev = Math.asin(Math.max(-1, Math.min(1, d[1]))) / DEG;
  const palmTilt = Math.acos(Math.max(-1, Math.min(1, n[1]))) / DEG;
  if (Math.abs(elev) > 25 || palmTilt > 50) warnings.push("Your arm wasn't level or your palm wasn't flat, so the boxer may look rotated.");

  return { yaw, phone, nRef: yawRot(n, yaw), warnings, input: inp };
}

/** Upper-arm direction in the heading frame from a phone orientation. */
export function upperArmDir(cal: PhoneCal, q: Q4): V3 {
  return yawRot(qrot(q, toThree(cal.aP)), cal.yawP);
}
