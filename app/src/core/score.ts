import { Detection } from './detector';
import { MOVE_INFO, MoveId } from './moves';

/* Scores one attempt at a move and says what to fix. Strikes: correct move, speed, form (extension, elbow flare, hook
 * elbow angle), return to guard, reaction to the cue. Covers and parries: correct move and reaction. */
export interface Attempt {
  expected: MoveId;
  got: MoveId | null;
  correct: boolean;
  score: number;
  reactionMs: number | null;
  returnMs: number | null;
  peakSpeed: number;
  forceN: number;
  extensionDeg: number | null;
  flareDeg: number | null;
  hookElbowDeg: number | null;
  tips: string[];
  praise: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function scoreAttempt(expected: MoveId, d: Detection | null, extra: { reactionMs?: number | null; returnMs?: number | null } = {}): Attempt {
  const base: Attempt = {
    expected, got: d?.move ?? null, correct: false, score: 0, reactionMs: extra.reactionMs ?? null, returnMs: extra.returnMs ?? null,
    peakSpeed: d?.peakSpeed ?? 0, forceN: d?.forceN ?? 0, extensionDeg: null, flareDeg: null, hookElbowDeg: null, tips: [], praise: '',
  };
  if (!d) return { ...base, tips: ['Nothing came. Throw it as soon as you hear the call.'], praise: 'Missed' };
  const correct = d.move === expected;
  if (!correct) {
    return { ...base, score: 10, tips: [`That looked like a ${MOVE_INFO[d.move].name.toLowerCase()}. ${MOVE_INFO[expected].keys[0]}.`], praise: 'Wrong move' };
  }
  const kind = MOVE_INFO[expected].kind;
  const tips: string[] = [];
  let score = 55;
  if (kind === 'strike') {
    score += 20 * clamp01((d.peakSpeed - 2.5) / 5);           // 2.5 m/s -> 0, 7.5 m/s -> full
    if (d.peakSpeed < 4) tips.push('Faster. Snap it like a whip.');
    if (expected === 'jab' || expected === 'body jab' || expected === 'double jab') {
      base.extensionDeg = d.extensionDeg;
      base.flareDeg = d.flareDeg;
      score += 10 * clamp01((40 - d.extensionDeg) / 30);
      if (d.extensionDeg > 20) tips.push('Reach full extension: straighten the elbow.');
      score += 5 * clamp01((35 - d.flareDeg) / 20);
      if (d.flareDeg > 25) tips.push('Keep the elbow in, not flaring out.');
    } else if (expected === 'hook' || expected === 'body hook') {
      base.hookElbowDeg = d.hookElbowDeg;
      const off = Math.abs(d.hookElbowDeg - 90);
      score += 15 * clamp01((40 - off) / 30);
      if (d.hookElbowDeg < 65) tips.push('Bend the arm more: about 90° at the elbow.');
      if (d.hookElbowDeg > 120) tips.push('Too loopy. Tighten the elbow toward 90°.');
    } else if (expected === 'uppercut') {
      base.flareDeg = d.flareDeg;
      score += 15 * clamp01((40 - d.flareDeg) / 25);
      if (d.flareDeg > 30) tips.push('Keep the elbow in front of the body.');
    }
  } else {
    score += 35;
  }
  if (extra.returnMs != null) {
    score += 5 * clamp01((700 - extra.returnMs) / 400);
    if (extra.returnMs > 700) tips.push('Bring the hand back to the guard sooner.');
  }
  if (extra.reactionMs != null) {
    score += 5 * clamp01((900 - extra.reactionMs) / 500);
    if (extra.reactionMs > 1000) tips.push('React faster to the call.');
  }
  score = Math.round(Math.min(100, score));
  const praise = score >= 88 ? 'Perfect!' : score >= 75 ? 'Sharp!' : score >= 60 ? 'Good' : 'Got it';
  return { ...base, correct, score, tips, praise };
}

/** 0-3 stars for a set of attempts. */
export function stars(attempts: Attempt[]): number {
  if (!attempts.length) return 0;
  const avg = attempts.reduce((s, a) => s + a.score, 0) / attempts.length;
  const acc = attempts.filter((a) => a.correct).length / attempts.length;
  if (avg >= 82 && acc >= 0.85) return 3;
  if (avg >= 65 && acc >= 0.65) return 2;
  if (acc >= 0.4) return 1;
  return 0;
}
