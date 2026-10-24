/* Vector / quaternion helpers, ported from laptop/shared.js and tests/fake_watch.js.
 * Frames: sensors report Android ENU (z up). Everything here is the three.js frame (y up);
 * after calibration the heading frame has forward = +z, up = +y. Quaternions are [x, y, z, w]. */
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export const G0 = 9.81;
export const DEG = Math.PI / 180;

/** Device axis by "clock" direction (12 = top of the screen, 3 = right edge). */
export type Clock = '12' | '3' | '6' | '9';
export const AXES: Record<Clock, V3> = { '12': [0, 1, 0], '3': [1, 0, 0], '6': [0, -1, 0], '9': [-1, 0, 0] };

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const nrm = (v: V3): V3 => {
  const l = Math.max(len(v), 1e-9);
  return [v[0] / l, v[1] / l, v[2] / l];
};
export const mean = (vs: V3[]): V3 => {
  const s: V3 = [0, 0, 0];
  for (const v of vs) { s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; }
  const n = Math.max(vs.length, 1);
  return [s[0] / n, s[1] / n, s[2] / n];
};
export const angDeg = (a: V3, b: V3) => Math.acos(Math.max(-1, Math.min(1, dot(nrm(a), nrm(b))))) / DEG;

export const qrot = (q: Q4, v: V3): V3 => {
  const [x, y, z, w] = q;
  const t: V3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [
    v[0] + w * t[0] + (y * t[2] - z * t[1]),
    v[1] + w * t[1] + (z * t[0] - x * t[2]),
    v[2] + w * t[2] + (x * t[1] - y * t[0]),
  ];
};
export const qconj = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];
export const qnorm = (q: Q4): Q4 => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

/** Android sensor vector -> three frame, and back. */
export const toThree = (v: V3): V3 => [v[0], v[2], -v[1]];
export const fromThree = (v: V3): V3 => [v[0], -v[2], v[1]];
/** ENU quaternion -> three frame (normalised). */
export const qT = (q: Q4): Q4 => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[2] / l, -q[1] / l, q[3] / l];
};
/** three-frame quaternion -> ENU quaternion as the sensors report it. */
export const qE = (q: Q4): Q4 => [q[0], -q[2], q[1], q[3]];

/** Rotate about the vertical axis (heading). */
export const yawRot = (v: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
};

/** Rodrigues: rotate v about unit axis k by th. */
export const rotAxis = (v: V3, k: V3, th: number): V3 =>
  add(add(mul(v, Math.cos(th)), mul(cross(k, v), Math.sin(th))), mul(k, dot(k, v) * (1 - Math.cos(th))));

/** Rotation matrix with the given columns. */
export type M3 = [V3, V3, V3]; // stored as rows
export const matFromCols = (a: V3, b: V3, c: V3): M3 => [
  [a[0], b[0], c[0]],
  [a[1], b[1], c[1]],
  [a[2], b[2], c[2]],
];
export const matMul = (A: M3, B: M3): M3 =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j])) as M3;
export const matT = (A: M3): M3 => [
  [A[0][0], A[1][0], A[2][0]],
  [A[0][1], A[1][1], A[2][1]],
  [A[0][2], A[1][2], A[2][2]],
];
export const matVec = (A: M3, v: V3): V3 => [dot(A[0], v), dot(A[1], v), dot(A[2], v)];

export function qFromMat(m: M3): Q4 {
  const t = m[0][0] + m[1][1] + m[2][2];
  let x: number, y: number, z: number, w: number;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    w = s / 4; x = (m[2][1] - m[1][2]) / s; y = (m[0][2] - m[2][0]) / s; z = (m[1][0] - m[0][1]) / s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    w = (m[2][1] - m[1][2]) / s; x = s / 4; y = (m[0][1] + m[1][0]) / s; z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    w = (m[0][2] - m[2][0]) / s; x = (m[0][1] + m[1][0]) / s; y = s / 4; z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    w = (m[1][0] - m[0][1]) / s; x = (m[0][2] + m[2][0]) / s; y = (m[1][2] + m[2][1]) / s; z = s / 4;
  }
  return qnorm([x, y, z, w]);
}

/** Any unit vector perpendicular to v. */
export const perp = (v: V3): V3 => nrm(cross(v, Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
