import { describe, expect, it } from 'vitest';
import { ArmSim } from '../sim/armSim';
import { Calibration } from './calibration';
import { ArmEngine } from './engine';
import { HoldRecorder } from './hold';
import { decodePhone, decodeWatch } from './packets';
import { PunchMeter, estimateForce, powerScore } from './punch';

function calibrated(sim: ArmSim) {
  const rec = new HoldRecorder();
  const end = sim.opt.holdSec;
  for (let t = end - 2.3; t <= end; t += 0.01) rec.pushWatch(decodeWatch(sim.watchPacket(t), '3', t * 1000));
  for (let t = end - 2.3; t <= end; t += 1 / 60) rec.pushPhone(decodePhone(sim.phonePacket(t), t * 1000));
  return rec.finish(end * 1000, '6', true);
}

describe('hold recorder', () => {
  it('calibrates from a still hold', () => {
    const cal = calibrated(new ArmSim());
    expect('error' in cal).toBe(false);
  });
  it('rejects a hold where the arm moved', () => {
    const sim = new ArmSim();
    const rec = new HoldRecorder();
    // record during the punching script instead of the hold
    for (let t = 20; t <= 22.3; t += 0.01) rec.pushWatch(decodeWatch(sim.watchPacket(t), '3', t * 1000));
    const r = rec.finish(22300, '6', false);
    expect('error' in r && r.error).toMatch(/moved/);
  });
});

describe('punch meter', () => {
  it('finds the punches in the scripted session and nothing while in guard', () => {
    const sim = new ArmSim({ seed: 3 });
    const cal = calibrated(sim) as Calibration;
    const eng = new ArmEngine(sim.opt.lengths);
    eng.setCalibration(cal);
    const meter = new PunchMeter(75);
    const punches: { t: number; speed: number }[] = [];
    const end = sim.opt.holdSec + 60;
    for (let t = sim.opt.holdSec; t < end; t += 1 / 60) {
      eng.pushWatch(decodeWatch(sim.watchPacket(t), '3', t * 1000));
      eng.pushPhone(decodePhone(sim.phonePacket(t), t * 1000));
      const p = eng.pose(t * 1000)!;
      const hit = meter.update(t * 1000, p.speed, p.hand);
      if (hit) punches.push({ t: hit.t / 1000, speed: hit.peakSpeed });
    }
    const items = sim.script.filter((s) => s.t1 < end && s.name !== 'guard');
    const strikes = items.filter((s) => ['jab', 'hook', 'uppercut', 'body jab', 'double jab'].includes(s.name));
    for (const s of strikes) {
      const found = punches.filter((p) => p.t >= s.t0 - 0.05 && p.t <= s.t1);
      expect(found.length, `${s.name} at ${s.t0.toFixed(1)}`).toBeGreaterThanOrEqual(1);
    }
    // every detected punch falls inside some move, never in a pure guard stretch
    for (const p of punches) expect(items.some((s) => p.t >= s.t0 - 0.05 && p.t <= s.t1 + 0.1)).toBe(true);
  });

  it('gives plausible force numbers', () => {
    const f = estimateForce(7, 75);
    expect(f).toBeGreaterThan(1200);
    expect(f).toBeLessThan(3500);
    expect(powerScore(9, 75)).toBeGreaterThan(80);
    expect(powerScore(3, 75)).toBeLessThan(20);
  });
});
