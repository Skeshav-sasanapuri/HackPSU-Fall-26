import * as THREE from 'three';

/* Cel shading: a 4-step gradient gives the inked-comic look; OutlineEffect draws the ink lines. */
let gradient: THREE.DataTexture | null = null;

export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = [70, 130, 205, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.needsUpdate = true;
  return gradient;
}

export interface ToonOpts { map?: THREE.Texture; outline?: boolean; thickness?: number; emissive?: THREE.ColorRepresentation; side?: THREE.Side }

export function toon(color: THREE.ColorRepresentation, o: ToonOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), map: o.map ?? null, side: o.side ?? THREE.FrontSide });
  if (o.emissive) m.emissive = new THREE.Color(o.emissive);
  m.userData.outlineParameters = { visible: o.outline !== false, thickness: o.thickness ?? 0.004, color: [0.09, 0.06, 0.04], alpha: 1 };
  return m;
}

/** Mark a material so the ink outline skips it (glows, ghosts, particles). */
export function noOutline<T extends THREE.Material>(m: T): T {
  m.userData.outlineParameters = { visible: false };
  return m;
}
