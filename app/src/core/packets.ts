import { AXES, Clock, G0, Q4, V3, fromThree, mul, nrm, qT, qrot, sub, toThree, dot } from './vec';

/** Watch frame exactly as the Wear OS app sends it. q = ENU device->world [x,y,z,w], g in rad/s, a in m/s^2 incl. gravity. */
export interface WatchPacket { t: number; dg?: number; da?: number; q: Q4; g: V3; a: V3 }
/** Phone frame: Generic Sensor quaternion, already convention-corrected on the phone. */
export interface PhonePacket { pq: Q4; t: number }

/** Watch sample in the three frame (y up), before heading alignment. */
export interface WatchSample {
  /** watch clock, ms */
  t: number;
  /** laptop performance.now() when it arrived */
  arrival: number;
  /** forearm direction (wrist -> fingers) */
  D: V3;
  /** watch face normal, made orthogonal to D */
  N: V3;
  /** angular velocity, world frame (rad/s) */
  W: V3;
  /** linear acceleration with gravity removed, world frame (m/s^2) */
  A: V3;
}

/** Phone sample: orientation in the three frame. */
export interface PhoneSample { t: number; arrival: number; q: Q4 }

export function decodeWatch(p: WatchPacket, axis: Clock, arrival: number): WatchSample {
  const q = qT(p.q);
  const D = nrm(qrot(q, toThree(AXES[axis])));
  let N = qrot(q, [0, 1, 0]);
  N = nrm(sub(N, mul(D, dot(N, D))));
  return { t: p.t, arrival, D, N, W: qrot(q, toThree(p.g)), A: sub(qrot(q, toThree(p.a)), [0, G0, 0]) };
}

export function decodePhone(p: PhonePacket, arrival: number): PhoneSample {
  return { t: p.t, arrival, q: qT(p.pq) };
}

export const isWatchPacket = (m: unknown): m is WatchPacket =>
  !!m && typeof m === 'object' && Array.isArray((m as WatchPacket).q) && Array.isArray((m as WatchPacket).g);
export const isPhonePacket = (m: unknown): m is PhonePacket =>
  !!m && typeof m === 'object' && Array.isArray((m as PhonePacket).pq);

export { fromThree };
