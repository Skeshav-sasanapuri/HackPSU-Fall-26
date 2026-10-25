import * as THREE from 'three';

/* What the stage needs from the user's character, whether it is the built-in placeholder or a rigged GLB. */
export type Side = 'L' | 'R';
export interface FighterColors { skin: string; shorts: string; gloves: string }

export interface Fighter {
  readonly root: THREE.Object3D;
  lead: Side;
  setLead(side: Side): void;
  /** per frame, before the arms are driven (idle animation, breathing) */
  update(dt: number, t: number): void;
  /** drive one arm with character-space directions (upper arm, forearm, back of the wrist) */
  driveArm(side: Side, U: THREE.Vector3, D: THREE.Vector3, N: THREE.Vector3 | null): void;
  guard(side: Side, t?: number): void;
  gloveWorld(side: Side, out?: THREE.Vector3): THREE.Vector3;
  shoulderWorld(side: Side, out?: THREE.Vector3): THREE.Vector3;
  setColors(c: Partial<FighterColors>): void;
  dispose?(): void;
}

/** Skin tones from very light to very dark, sampled by the customisation slider (0..1). */
const SKIN_RAMP = ['#f7dcc8', '#efc8a8', '#e2b28c', '#d29b72', '#c08259', '#a76a43', '#8c5534', '#704027', '#56301d', '#3d2214'];
export function skinTone(k: number): string {
  const x = Math.max(0, Math.min(1, k)) * (SKIN_RAMP.length - 1);
  const i = Math.min(SKIN_RAMP.length - 2, Math.floor(x));
  return '#' + new THREE.Color(SKIN_RAMP[i]).lerp(new THREE.Color(SKIN_RAMP[i + 1]), x - i).getHexString();
}
export const SKIN_GRADIENT = `linear-gradient(90deg, ${SKIN_RAMP.join(', ')})`;
