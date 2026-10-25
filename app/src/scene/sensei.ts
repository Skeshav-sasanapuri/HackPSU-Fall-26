import * as THREE from 'three';
import { Key, MOVE_KEYS, MoveId, comboDuration, comboKeys, guardState, moveDuration, sampleKeys } from '../core/moves';
import { Boxer, Side } from './boxer';
import { Fighter } from './fighter';

/* Plays textbook moves on the coach. Keyframes are in the heading frame with the lead arm on +x; `side` is the
 * coach's arm that leads on screen (the same side the student's boxer leads with, so the student copies naturally). */
/** move -> the Mixamo clips that show it (moves without one fall back to keyframes) */
const DEMO_CLIPS: Partial<Record<MoveId, string[]>> = {
  jab: ['jab'], 'double jab': ['jab', 'jab'], 'body jab': ['body_jab'], hook: ['hook'], uppercut: ['uppercut'], 'high guard': ['block'],
};

export class SenseiPlayer {
  private keys: Key[] | null = null;
  private t = 0;
  private dur = 0;
  private speed = 1;
  private done: (() => void) | null = null;
  private v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  constructor(private fighter: () => Fighter) {}

  get busy() { return this.keys != null; }

  /** a whole-body clip on the rigged coach (talking, clapping); a no-op on the built-in figure */
  gesture(name: string): Promise<void> { return this.fighter().gesture?.(name) ?? Promise.resolve(); }

  /** Demonstrates moves one after another: the rigged coach's Mixamo clip where there is one (mirrored to lead
   * with `side`), otherwise the built-in keyframes. `speed` 1 is full speed. */
  async demo(moves: MoveId[], speed: number, side: Side) {
    for (const m of moves) {
      const f = this.fighter(), clips = DEMO_CLIPS[m];
      if (clips && f.gesture && clips.every((c) => f.hasClip?.(c))) {
        for (const c of clips) await f.gesture(c, { speed, side });
      } else {
        await this.playMove(m, speed * 0.9);
      }
    }
  }

  play(keys: Key[], dur: number, speed = 1): Promise<void> {
    this.done?.();
    this.fighter().stopGesture?.();
    this.keys = keys; this.dur = dur; this.t = 0; this.speed = speed;
    return new Promise((res) => { this.done = res; });
  }
  playMove(m: MoveId, speed = 1) { return this.play(MOVE_KEYS[m], moveDuration(m), speed); }
  playCombo(moves: MoveId[], speed = 1) { return this.play(comboKeys(moves), comboDuration(moves), speed); }
  stop() { this.keys = null; const d = this.done; this.done = null; d?.(); this.fighter().stopGesture?.(); }

  update(dt: number, time: number, side: Side) {
    const b = this.fighter();
    if (b instanceof Boxer) b.idle(time + 2.3, 0.7); else b.update(dt, time);
    if ((b as Fighter).gesturing && !this.keys) return;
    let s = guardState();
    if (this.keys) {
      this.t += dt * this.speed;
      s = sampleKeys(this.keys, this.t);
      if (this.t >= this.dur) { this.keys = null; const d = this.done; this.done = null; d?.(); }
    }
    const fx = side === 'L' ? 1 : -1;
    const [U, D, N] = this.v;
    U.set(s.U[0] * fx, s.U[1], s.U[2]);
    D.set(s.D[0] * fx, s.D[1], s.D[2]);
    N.set(s.N[0] * fx, s.N[1], s.N[2]);
    b.driveArm(side, U, D, N);
    b.guard(side === 'L' ? 'R' : 'L', time);
  }
}
