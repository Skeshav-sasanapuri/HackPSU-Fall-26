import * as THREE from 'three';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ArmLengths } from './core/body';
import { Calibration, calibrate } from './core/calibration';
import { ArmEngine, ArmPose } from './core/engine';
import { Detection, MoveDetector } from './core/detector';
import { HoldRecorder } from './core/hold';
import { Punch, PunchMeter } from './core/punch';
import { Clock } from './core/vec';
import { DeviceHub } from './link/hub';
import type { Side } from './scene/boxer';

/* Glue between the sensors and the screens: feeds the engine, records calibration holds, runs the punch meter once
 * per rendered frame, and maps the arm from the user's heading frame into the character's space. */
/* Kept for the browser tab, per session: a page reload does not restart the sensors, so their headings, and with
 * them the calibration, stay valid. A new session clears it. */
interface CalState { cal: Calibration | null; at: number; session: string; set: (c: Calibration | null) => void; forSession: (code: string) => void }
export const useCalibration = create<CalState>()(
  persist(
    (set, get) => ({
      cal: null, at: 0, session: '',
      set: (cal) => set({ cal, at: Date.now() }),
      forSession: (code) => { if (get().session !== code) set({ cal: null, at: 0, session: code }); },
    }),
    { name: 'jab.cal', storage: createJSONStorage(() => sessionStorage) },
  ),
);

export interface CharArm { side: Side; U: THREE.Vector3; D: THREE.Vector3; N: THREE.Vector3 }

export class ArmSession {
  readonly engine: ArmEngine;
  readonly meter: PunchMeter;
  readonly detector: MoveDetector;
  pose: ArmPose | null = null;
  lastMove: Detection | null = null;
  /** straight punches keep reading bent: the sensor headings have probably drifted apart */
  driftSuspect = false;
  private jabExt: number[] = [];
  private moveCbs = new Set<(d: Detection) => void>();
  lastPunch: Punch | null = null;
  punches = 0;
  bestSpeed = 0;
  private recorder: HoldRecorder | null = null;
  private punchCbs = new Set<(p: Punch) => void>();
  private ch: CharArm = { side: 'L', U: new THREE.Vector3(), D: new THREE.Vector3(), N: new THREE.Vector3() };

  constructor(private hub: DeviceHub, lengths: ArmLengths, bodyKg: number) {
    this.engine = new ArmEngine(lengths);
    this.meter = new PunchMeter(bodyKg);
    this.detector = new MoveDetector(lengths, bodyKg);
  }

  attach(): () => void {
    const a = this.hub.onWatch((s) => { this.engine.pushWatch(s); this.recorder?.pushWatch(s); });
    const b = this.hub.onPhone((s) => { this.engine.pushPhone(s); this.recorder?.pushPhone(s); });
    return () => { a(); b(); };
  }

  setBody(lengths: ArmLengths, bodyKg: number, lead: 'left' | 'right' = 'left') {
    this.engine.lengths = lengths; this.meter.bodyKg = bodyKg;
    this.detector.lengths = lengths; this.detector.bodyKg = bodyKg; this.detector.lead = lead;
  }
  setCalibration(cal: Calibration | null) { this.engine.setCalibration(cal); this.meter.reset(); this.jabExt = []; this.driftSuspect = false; }

  /** Re-apply a stored hold with another phone orientation (no need to hold the pose again). */
  static reapply(cal: Calibration, phoneAxis: Clock): Calibration | null {
    const r = calibrate({ ...cal.input, phoneAxis });
    return 'error' in r ? null : r;
  }

  beginHold() { this.recorder = new HoldRecorder(); }
  endHold(phoneAxis: Clock, usePhone: boolean): Calibration | { error: string } {
    const r = this.recorder?.finish(performance.now(), phoneAxis, usePhone) ?? { error: 'No hold was recorded.' };
    this.recorder = null;
    return r;
  }
  cancelHold() { this.recorder = null; }

  onPunch(cb: (p: Punch) => void) { this.punchCbs.add(cb); return () => { this.punchCbs.delete(cb); }; }
  /** every recognised move (strikes, covers, parries, feints) */
  onMove(cb: (d: Detection) => void) { this.moveCbs.add(cb); return () => { this.moveCbs.delete(cb); }; }
  /** the tracked hand is back in the guard */
  get inGuard() { return this.detector.inGuard; }
  resetStats() { this.punches = 0; this.bestSpeed = 0; this.lastPunch = null; }

  /** Once per rendered frame. */
  tick(now: number): ArmPose | null {
    this.pose = this.engine.pose(now);
    if (this.pose) {
      const p = this.meter.update(now, this.pose.speed, this.pose.hand);
      if (p) {
        this.lastPunch = p; this.punches++; this.bestSpeed = Math.max(this.bestSpeed, p.peakSpeed);
        for (const cb of this.punchCbs) cb(p);
      }
      for (const d of this.detector.update(now, this.pose)) {
        this.lastMove = d;
        if (d.move === 'jab' || d.move === 'body jab' || d.move === 'double jab') {
          this.jabExt.push(d.extensionDeg);
          if (this.jabExt.length > 6) this.jabExt.shift();
          const sorted = [...this.jabExt].sort((a, b) => a - b);
          this.driftSuspect = sorted.length >= 4 && sorted[sorted.length >> 1] > 28;
        }
        for (const cb of this.moveCbs) cb(d);
      }
    }
    return this.pose;
  }

  /** The tracked arm in character space. Mirror view drives the opposite arm with x flipped, like a mirror. */
  toCharacter(pose: ArmPose, lead: 'left' | 'right', mirror: boolean): CharArm {
    const own: Side = lead === 'left' ? 'L' : 'R';
    const sx = mirror ? -1 : 1;
    this.ch.side = mirror ? (own === 'L' ? 'R' : 'L') : own;
    this.ch.U.set(pose.U[0] * sx, pose.U[1], pose.U[2]);
    this.ch.D.set(pose.D[0] * sx, pose.D[1], pose.D[2]);
    this.ch.N.set(pose.N[0] * sx, pose.N[1], pose.N[2]);
    return this.ch;
  }
}
