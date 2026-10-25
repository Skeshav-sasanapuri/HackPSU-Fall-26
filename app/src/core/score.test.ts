import { describe, expect, it } from 'vitest';
import { Detection } from './detector';
import { scoreAttempt, stars } from './score';

const det = (o: Partial<Detection>): Detection => ({
  move: 'jab', t: 0, tEnd: 300, peakSpeed: 7, forceN: 2000, power: 80, extensionDeg: 8, flareDeg: 10, hookElbowDeg: 90, ...o,
});

describe('scoring', () => {
  it('rewards a fast, straight jab', () => {
    const a = scoreAttempt('jab', det({}), { returnMs: 300, reactionMs: 400 });
    expect(a.correct).toBe(true);
    expect(a.score).toBeGreaterThan(85);
    expect(a.tips).toEqual([]);
  });
  it('gives form tips', () => {
    const a = scoreAttempt('jab', det({ peakSpeed: 3, extensionDeg: 35, flareDeg: 40 }), { returnMs: 900 });
    expect(a.tips.length).toBeGreaterThanOrEqual(3);
    expect(a.score).toBeLessThan(70);
    expect(scoreAttempt('hook', det({ move: 'hook', hookElbowDeg: 140 })).tips.join()).toMatch(/loopy/);
  });
  it('marks the wrong move and missing moves', () => {
    expect(scoreAttempt('hook', det({ move: 'jab' })).correct).toBe(false);
    expect(scoreAttempt('hook', null).score).toBe(0);
  });
  it('turns attempts into stars', () => {
    const good = Array.from({ length: 5 }, () => scoreAttempt('jab', det({}), { returnMs: 300 }));
    expect(stars(good)).toBe(3);
    expect(stars([scoreAttempt('jab', null), scoreAttempt('jab', null)])).toBe(0);
  });
});
