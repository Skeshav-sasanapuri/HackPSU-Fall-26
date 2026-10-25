import { DEG, V3, add, cross, mul, nrm, rotAxis } from './vec';

/* The lead-arm move library. Keyframes describe a textbook version of each move in the heading frame (forward = +z,
 * up = +y, the lead arm's side = +x). The same data drives the simulator, the sensei's demonstrations and the
 * detector tests, so they all agree on what a "jab" looks like. */
export type MoveId =
  | 'jab' | 'double jab' | 'body jab' | 'hook' | 'body hook' | 'uppercut'
  | 'high guard' | 'parry' | 'elbow block' | 'feint';

export const MOVE_IDS: MoveId[] = ['jab', 'double jab', 'body jab', 'hook', 'body hook', 'uppercut', 'high guard', 'parry', 'elbow block', 'feint'];

export interface ArmState { U: V3; D: V3; N: V3 }
export interface Key { t: number; U: V3; phi: number; ref: V3; tau?: number }

const REF_FWD: V3 = nrm([0.35, 0.45, 0.82]);
const REF_ACROSS: V3 = nrm([-0.7, 0.1, 0.7]);
/** twist that puts the palm down when the arm is straight out in front */
const TAU0 = Math.PI / 2 - Math.atan2(0.45, 0.35);

export const GUARD_KEY: Key = { t: 0, U: nrm([0.2, -0.85, 0.45]), phi: 125 * DEG, ref: REF_FWD };
const at = (t: number, k: Omit<Key, 't'>): Key => ({ ...k, t });
const k = (U: V3, phiDeg: number, ref = REF_FWD, tau = 0) => ({ U: nrm(U), phi: phiDeg * DEG, ref, tau });

const JAB_OUT = k([0.05, 0.1, 1], 6);
const BODY_OUT = k([0.05, -0.4, 0.92], 8);
const HIGH_GUARD = k([0.42, -0.62, 0.66], 150);
const ELBOW_BLOCK = k([0.08, -1, 0.05], 95, REF_ACROSS);

export const MOVE_KEYS: Record<MoveId, Key[]> = {
  jab: [GUARD_KEY, at(0.09, JAB_OUT), at(0.13, JAB_OUT), at(0.36, GUARD_KEY)],
  'double jab': [GUARD_KEY, at(0.09, JAB_OUT), at(0.24, k([0.15, -0.5, 0.8], 60)), at(0.33, JAB_OUT), at(0.38, JAB_OUT), at(0.62, GUARD_KEY)],
  'body jab': [GUARD_KEY, at(0.1, BODY_OUT), at(0.14, BODY_OUT), at(0.4, GUARD_KEY)],
  hook: [GUARD_KEY, at(0.15, k([0.95, 0.1, 0.15], 90, REF_ACROSS)), at(0.25, k([0.5, 0.1, 0.85], 90, REF_ACROSS)), at(0.55, GUARD_KEY)],
  'body hook': [GUARD_KEY, at(0.16, k([0.9, -0.45, 0.1], 90, REF_ACROSS)), at(0.27, k([0.45, -0.5, 0.75], 92, REF_ACROSS)), at(0.6, GUARD_KEY)],
  uppercut: [GUARD_KEY, at(0.14, k([0.1, -0.95, 0.2], 100)), at(0.25, k([0.1, -0.45, 0.88], 55)), at(0.55, GUARD_KEY)],
  'high guard': [GUARD_KEY, at(0.18, HIGH_GUARD), at(1.3, HIGH_GUARD), at(1.55, GUARD_KEY)],
  parry: [GUARD_KEY, at(0.1, k([0.05, -0.75, 0.66], 108, REF_ACROSS)), at(0.28, GUARD_KEY)],
  'elbow block': [GUARD_KEY, at(0.2, ELBOW_BLOCK), at(1.3, ELBOW_BLOCK), at(1.55, GUARD_KEY)],
  feint: [GUARD_KEY, at(0.08, k([0.1, -0.35, 0.93], 72)), at(0.26, GUARD_KEY)],
};

export const CALIBRATION_KEYS: Key[] = [at(0, k([0, 0, 1], 0))];

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export function stateFrom(U: V3, phi: number, ref: V3, tau: number): ArmState {
  U = nrm(U);
  const h = nrm(cross(U, ref));
  const D = nrm(rotAxis(U, h, phi));
  const N = rotAxis(nrm(cross(h, D)), D, tau + TAU0);
  return { U, D, N };
}

export function sampleKeys(keys: Key[], t: number): ArmState {
  let s = { U: keys[0].U, phi: keys[0].phi, ref: keys[0].ref, tau: keys[0].tau ?? 0 };
  if (t > keys[0].t) {
    const last = keys[keys.length - 1];
    s = { U: last.U, phi: last.phi, ref: last.ref, tau: last.tau ?? 0 };
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i].t) {
        const a = keys[i - 1], b = keys[i], f = smooth((t - a.t) / (b.t - a.t));
        s = {
          U: nrm(add(mul(a.U, 1 - f), mul(b.U, f))),
          phi: a.phi + (b.phi - a.phi) * f,
          ref: nrm(add(mul(a.ref, 1 - f), mul(b.ref, f))),
          tau: (a.tau ?? 0) + ((b.tau ?? 0) - (a.tau ?? 0)) * f,
        };
        break;
      }
    }
  }
  return stateFrom(s.U, s.phi, s.ref, s.tau);
}

export const guardState = () => stateFrom(GUARD_KEY.U, GUARD_KEY.phi, GUARD_KEY.ref, 0);
export const moveDuration = (m: MoveId) => MOVE_KEYS[m][MOVE_KEYS[m].length - 1].t;
export const sampleMove = (m: MoveId, t: number) => sampleKeys(MOVE_KEYS[m], t);

/* ---- coaching text ---- */
export type MoveKind = 'strike' | 'hold' | 'defense';
export interface MoveInfo {
  id: MoveId;
  name: string;
  /** what the coach shouts */
  cue: string;
  kind: MoveKind;
  /** shown while the sensei demonstrates */
  keys: string[];
  /** one line for the lesson card */
  blurb: string;
}

export const MOVE_INFO: Record<MoveId, MoveInfo> = {
  jab: { id: 'jab', name: 'Jab', cue: 'Jab!', kind: 'strike', blurb: 'The fastest punch you own. Straight out, straight back.', keys: ['Straight line from the chin', 'Lock the elbow at the end', 'Snap it back to the guard'] },
  'double jab': { id: 'double jab', name: 'Double jab', cue: 'Double!', kind: 'strike', blurb: 'Two jabs, no rest between them. Half-return, then fire again.', keys: ['First jab reaches, half returns', 'Second jab full extension', 'Back to guard'] },
  'body jab': { id: 'body jab', name: 'Body jab', cue: 'Body jab!', kind: 'strike', blurb: 'The same jab, aimed at the stomach. Bend the knees, not the back.', keys: ['Drop the level with your knees', 'Punch straight to the body', 'Back up to the guard'] },
  hook: { id: 'hook', name: 'Lead hook', cue: 'Hook!', kind: 'strike', blurb: 'A short arc to the side of the head. Elbow up, arm bent at ninety.', keys: ['Elbow up to shoulder height', 'Keep the arm bent at 90°', 'Turn through the target'] },
  'body hook': { id: 'body hook', name: 'Body hook', cue: 'Body hook!', kind: 'strike', blurb: 'The hook, dropped to the ribs. Short and tight.', keys: ['Dip to the side', 'Elbow bent, swing low', 'Back to the guard'] },
  uppercut: { id: 'uppercut', name: 'Lead uppercut', cue: 'Uppercut!', kind: 'strike', blurb: 'Drop the hand a little, then drive straight up through the chin.', keys: ['Small dip, no big wind-up', 'Drive up and forward', 'Elbow stays in front'] },
  'high guard': { id: 'high guard', name: 'High guard', cue: 'Cover!', kind: 'hold', blurb: 'Glove to the temple, forearm vertical. Take the shot on the arm.', keys: ['Glove to the temple', 'Forearm straight up', 'Hold it tight'] },
  parry: { id: 'parry', name: 'Parry', cue: 'Parry!', kind: 'defense', blurb: 'A small, quick slap inward that knocks the punch off line.', keys: ['Small movement', 'Slap inward, in front of the face', 'Straight back to the guard'] },
  'elbow block': { id: 'elbow block', name: 'Elbow block', cue: 'Elbow!', kind: 'hold', blurb: 'Drop the elbow to the ribs and cover the body with the forearm.', keys: ['Elbow tight to the side', 'Forearm covers the stomach', 'Hold it'] },
  feint: { id: 'feint', name: 'Feint jab', cue: 'Feint!', kind: 'defense', blurb: 'Start a jab and stop it. Make them flinch, then make them pay.', keys: ['Sharp little twitch', 'Half extension, no more', 'Back fast'] },
};

/* ---- combos ---- */
export interface Combo { id: string; name: string; moves: MoveId[] }
export const COMBOS: Combo[] = [
  { id: 'jjh', name: 'Jab, jab, hook', moves: ['jab', 'jab', 'hook'] },
  { id: 'jbj', name: 'Jab, body jab', moves: ['jab', 'body jab'] },
  { id: 'juh', name: 'Jab, uppercut, hook', moves: ['jab', 'uppercut', 'hook'] },
  { id: 'pj', name: 'Parry, jab', moves: ['parry', 'jab'] },
  { id: 'ebh', name: 'Elbow block, hook', moves: ['elbow block', 'hook'] },
  { id: 'fjh', name: 'Feint, jab, hook', moves: ['feint', 'jab', 'hook'] },
];

/** Keyframes for a combo, moves back to back. */
export function comboKeys(moves: MoveId[], gap = 0.15): Key[] {
  const out: Key[] = [];
  let t0 = 0;
  for (const m of moves) {
    for (const key of MOVE_KEYS[m]) if (!(out.length && key.t === 0)) out.push({ ...key, t: t0 + key.t });
    t0 += moveDuration(m) + gap;
    out.push({ ...GUARD_KEY, t: t0 - 0.0001 });
  }
  return out;
}
export const comboDuration = (moves: MoveId[], gap = 0.15) => moves.reduce((s, m) => s + moveDuration(m) + gap, 0);
