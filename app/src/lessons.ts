import { useEffect, useMemo } from 'react';
import { ArmSession } from './armSession';
import { Detection } from './core/detector';
import { COMBOS, Combo, MOVE_IDS, MOVE_INFO, MoveId } from './core/moves';
import { DeviceHub, SimHub } from './link/hub';
import { getStage } from './scene/stage';
import { COACH_COLORS } from './scene/boxer';
import { GltfFighter } from './scene/gltfFighter';
import { SenseiPlayer } from './scene/sensei';

/* Lesson catalogue and the small async helpers lesson scripts are written with. */
export interface Lesson { id: string; title: string; blurb: string; moves: MoveId[]; combo: Combo | null }

export const LESSONS: Lesson[] = [
  ...MOVE_IDS.map((m) => ({ id: m.replace(' ', '-'), title: MOVE_INFO[m].name, blurb: MOVE_INFO[m].blurb, moves: [m], combo: null })),
  ...COMBOS.map((c) => ({ id: `combo-${c.id}`, title: c.name, blurb: 'Put the pieces together without dropping the guard.', moves: c.moves, combo: c })),
];
export const lessonById = (id: string) => LESSONS.find((l) => l.id === id) ?? null;

export class Cancelled extends Error {}

export function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(new Cancelled());
    const id = setTimeout(res, ms);
    signal.addEventListener('abort', () => { clearTimeout(id); rej(new Cancelled()); }, { once: true });
  });
}

/** Detections that arrive within `ms`. Resolves early once `enough` says so. */
export function collectMoves(arm: ArmSession, ms: number, signal: AbortSignal, enough: (ds: Detection[]) => boolean): Promise<Detection[]> {
  return new Promise((res, rej) => {
    const got: Detection[] = [];
    let timer: ReturnType<typeof setTimeout>;
    const off = arm.onMove((d) => {
      got.push(d);
      if (enough(got)) { finish(); }
    });
    const finish = () => { clearTimeout(timer); off(); res(got); };
    timer = setTimeout(finish, ms);
    signal.addEventListener('abort', () => { clearTimeout(timer); off(); rej(new Cancelled()); }, { once: true });
  });
}

/** First attempt at `m` in the window; two jabs in quick succession count as a double jab. */
export async function waitForMove(arm: ArmSession, m: MoveId, ms: number, signal: AbortSignal): Promise<Detection | null> {
  const ds = await collectMoves(arm, ms, signal, (ds) => {
    if (m === 'double jab') return ds.some((d) => d.move === 'double jab') || ds.filter((d) => d.move === 'jab').length >= 2 || ds.some((d) => d.move !== 'jab');
    return ds.length > 0;
  });
  if (m === 'double jab') {
    const dj = ds.find((d) => d.move === 'double jab');
    if (dj) return dj;
    const jabs = ds.filter((d) => d.move === 'jab');
    if (jabs.length >= 2 && jabs[1].t - jabs[0].tEnd < 800) {
      return { ...jabs[0], move: 'double jab', tEnd: jabs[1].tEnd, peakSpeed: Math.max(jabs[0].peakSpeed, jabs[1].peakSpeed), forceN: Math.max(jabs[0].forceN, jabs[1].forceN) };
    }
  }
  return ds[0] ?? null;
}

/** ms until the hand is back in the guard (null if it never comes back within `ms`). */
export function timeToGuard(arm: ArmSession, ms: number): Promise<number | null> {
  const t0 = performance.now();
  return new Promise((res) => {
    const id = setInterval(() => {
      const dt = performance.now() - t0;
      if (arm.inGuard) { clearInterval(id); res(dt); } else if (dt > ms) { clearInterval(id); res(null); }
    }, 30);
  });
}

/** In sim mode, make the simulated arm do the moves (with a human-ish reaction delay). */
export function simDo(hub: DeviceHub, moves: MoveId[], delayMs = 380) {
  if (hub instanceof SimHub) hub.perform(moves, delayMs);
}

/** Sim mode: while mounted, the simulated arm only does what it is told. */
export function useSimPuppet(hub: DeviceHub) {
  useEffect(() => {
    if (!(hub instanceof SimHub)) return;
    hub.puppet = true;
    return () => { hub.puppet = false; };
  }, [hub]);
}

let player: SenseiPlayer | null = null;
let coachLoading = false;
/** swaps in the rigged coach (/models/coach.glb) once; keeps the built-in figure if it is missing */
function loadCoach() {
  if (coachLoading) return;
  coachLoading = true;
  GltfFighter.load('/models/coach.glb', COACH_COLORS, 1.76)
    .then((f) => getStage().setSensei(f))
    .catch((e) => console.warn('coach model not used', e));
}
/** Shows the coach while mounted and keeps him animated. */
export function useSensei(): SenseiPlayer {
  const stage = getStage();
  const p = useMemo(() => (player ??= new SenseiPlayer(() => stage.sensei)), [stage]);
  useEffect(() => {
    loadCoach();
    stage.sensei.root.visible = true;
    const off = stage.onFrame((dt, t) => p.update(dt, t, stage.boxer.lead));
    return () => { off(); p.stop(); stage.sensei.root.visible = false; };
  }, [stage, p]);
  return p;
}
