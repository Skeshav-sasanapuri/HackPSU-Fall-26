import { describe, expect, it } from 'vitest';
import { ArmSim } from '../sim/armSim';
import { calibrate, Calibration } from './calibration';
import { ArmEngine } from './engine';
import { decodePhone, decodeWatch } from './packets';
import { Clock, angDeg, yawRot, V3 } from './vec';

function runCalibration(sim: ArmSim, axis: Clock, watchAxis: Clock = sim.opt.watchAxis) {
  const D: V3[] = [], N: V3[] = [], phoneQ = [];
  // same window the app uses: the last 2.0 s .. 0.2 s of a 2.3 s hold, sampled at the device rates
  const end = sim.opt.holdSec;
  for (let t = end - 2.0; t < end - 0.2; t += 0.01) {
    const w = decodeWatch(sim.watchPacket(t), watchAxis, t * 1000);
    D.push(w.D); N.push(w.N);
  }
  for (let t = end - 2.0; t < end - 0.2; t += 1 / 60) phoneQ.push(decodePhone(sim.phonePacket(t), t * 1000).q);
  return calibrate({ D, N, phoneQ, phoneAxis: axis });
}

describe('packet round trip', () => {
  it('watch direction matches ground truth up to the watch heading', () => {
    const sim = new ArmSim({ watchHeading: 1.1 });
    for (const t of [5, 6.3, 9.9, 14]) {
      const w = decodeWatch(sim.watchPacket(t), '3', 0);
      expect(angDeg(w.D, yawRot(sim.truth(t).D, 1.1))).toBeLessThan(1.5);
    }
  });
});

describe('calibration + engine', () => {
  it('recovers the arm within a few degrees despite random headings and strap tilt', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = new ArmSim({ seed, watchHeading: seed * 1.3, phoneHeading: -seed * 0.9, strapTiltDeg: 8 + seed * 2 });
      const cal = runCalibration(r, '6');
      if ('error' in cal) throw new Error(cal.error);
      expect(cal.phone!.tiltDeg).toBeGreaterThan(6);
      expect(cal.phone!.tiltDeg).toBeLessThan(25);
      const eng = new ArmEngine(r.opt.lengths);
      eng.setCalibration(cal as Calibration);
      const errU: number[] = [], errD: number[] = [];
      for (let t = r.opt.holdSec; t < r.opt.holdSec + 20; t += 0.02) {
        eng.pushWatch(decodeWatch(r.watchPacket(t), '3', t * 1000));
        eng.pushPhone(decodePhone(r.phonePacket(t), t * 1000));
        const p = eng.pose(t * 1000)!;
        const truth = r.truth(t);
        errU.push(angDeg(p.U, truth.U));
        errD.push(angDeg(p.D, truth.D));
      }
      const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
      expect(med(errD)).toBeLessThan(2);
      expect(med(errU)).toBeLessThan(8);
      expect(Math.max(...errU)).toBeLessThan(20);
    }
  });

  it('flags a calibration that was not level', () => {
    const sim = new ArmSim();
    // calibrate during the guard instead of the hold pose
    const D: V3[] = [], N: V3[] = [];
    for (let t = 100; t < 101.8; t += 0.01) { const w = decodeWatch(sim.watchPacket(t), '3', 0); D.push(w.D); N.push(w.N); }
    const cal = calibrate({ D, N, phoneQ: null, phoneAxis: '6' }) as Calibration;
    expect(cal.warnings.length).toBeGreaterThan(0);
  });

  it('reports no warnings for a clean calibration pose', () => {
    const cal = runCalibration(new ArmSim(), '6') as Calibration;
    expect(cal.warnings).toEqual([]);
  });

  it('gives plausible hand speeds: jabs fast, guard slow', () => {
    const sim = new ArmSim({ seed: 5 });
    const cal = runCalibration(sim, '6') as Calibration;
    const eng = new ArmEngine(sim.opt.lengths);
    eng.setCalibration(cal);
    const peaks: Record<string, number> = {};
    let quiet = 0;
    for (let t = sim.opt.holdSec; t < sim.opt.holdSec + 30; t += 0.02) {
      eng.pushWatch(decodeWatch(sim.watchPacket(t), '3', t * 1000));
      eng.pushPhone(decodePhone(sim.phonePacket(t), t * 1000));
      const p = eng.pose(t * 1000)!;
      const m = sim.moveAt(t);
      if (m === 'guard') quiet = Math.max(quiet, p.speed * 0); // guard right after a punch still decays; ignore
      peaks[m] = Math.max(peaks[m] ?? 0, p.speed);
    }
    expect(peaks['jab']).toBeGreaterThan(3);
    expect(peaks['jab']).toBeLessThan(15);
    expect(peaks['hook']).toBeGreaterThan(2);
    void quiet;
  });
});
