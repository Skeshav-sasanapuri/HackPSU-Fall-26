import { describe, expect, it } from 'vitest';
import { ArmSim } from '../sim/armSim';
import { Calibration } from './calibration';
import { Detection, MoveDetector } from './detector';
import { ArmEngine } from './engine';
import { HoldRecorder } from './hold';
import { MOVE_IDS, MoveId } from './moves';
import { decodePhone, decodeWatch } from './packets';

/* Runs the full chain (simulated sensors -> calibration -> engine -> detector) and checks what gets named. */
function run(order: MoveId[], seed = 11, reps = 4) {
  const sim = new ArmSim({ seed, order });
  const rec = new HoldRecorder();
  const end0 = sim.opt.holdSec;
  for (let t = end0 - 2.3; t <= end0; t += 0.01) rec.pushWatch(decodeWatch(sim.watchPacket(t), '3', t * 1000));
  for (let t = end0 - 2.3; t <= end0; t += 1 / 60) rec.pushPhone(decodePhone(sim.phonePacket(t), t * 1000));
  const cal = rec.finish(end0 * 1000, '6', true) as Calibration;
  const eng = new ArmEngine(sim.opt.lengths);
  eng.setCalibration(cal);
  const det = new MoveDetector(sim.opt.lengths, 75, 'left');
  const found: Detection[] = [];
  const end = sim.script[order.length * 2 * reps - 1]?.t1 ?? sim.script.at(-1)!.t1;
  for (let t = end0; t < end + 1; t += 1 / 60) {
    eng.pushWatch(decodeWatch(sim.watchPacket(t), '3', t * 1000));
    eng.pushPhone(decodePhone(sim.phonePacket(t), t * 1000));
    found.push(...det.update(t * 1000, eng.pose(t * 1000)!));
  }
  return { sim, found, end };
}

describe('move detector', () => {
  for (const m of MOVE_IDS) {
    it(`recognises ${m}`, () => {
      const { sim, found, end } = run([m], 5 + m.length);
      const items = sim.script.filter((s) => s.name === m && s.t1 <= end);
      let hit = 0;
      for (const s of items) {
        const inWin = found.filter((d) => d.t / 1000 >= s.t0 - 0.05 && d.t / 1000 <= s.t1 + 0.1);
        if (inWin.some((d) => d.move === m)) hit++;
      }
      const wrong = found.filter((d) => d.move !== m);
      expect(hit, `found ${found.map((d) => d.move).join(', ')}`).toBe(items.length);
      expect(wrong.length, `extra ${wrong.map((d) => d.move).join(', ')}`).toBeLessThanOrEqual(Math.floor(items.length / 4));
    });
  }

  it('reports form numbers for a jab', () => {
    const { found } = run(['jab']);
    const j = found.find((d) => d.move === 'jab')!;
    expect(j.extensionDeg).toBeLessThan(25);
    expect(j.flareDeg).toBeLessThan(25);
    expect(j.peakSpeed).toBeGreaterThan(4);
  });
});
