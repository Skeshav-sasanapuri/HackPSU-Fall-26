import * as THREE from 'three';
import { ArmDriver } from './armDriver';
import { noOutline, toon } from './toon';

/* Placeholder boxer until the real GLB arrives: a bone hierarchy with toon-shaded parts hung on the bones, so the arm
 * driving code is the same one the Mixamo rig will use. Faces +z. Left side is +x. Height about 1.8 m. */
export type Side = 'L' | 'R';
export interface BoxerColors { skin: string; shorts: string; gloves: string; trim: string }
export const DEFAULT_COLORS: BoxerColors = { skin: '#c68a5e', shorts: '#a3271c', gloves: '#b3261c', trim: '#efe6d2' };

const L1 = 0.3, L2 = 0.27;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Guard pose (character space) for a side: +1 = left (+x), -1 = right. */
export function guardDirs(s: number) {
  return {
    U: v(0.24 * s, -0.86, 0.45).normalize(),
    D: v(-0.38 * s, 0.85, 0.36).normalize(),
    N: v(0.35 * s, 0, 1).normalize(),
  };
}

export class Boxer {
  readonly root = new THREE.Group();
  readonly hips = new THREE.Bone();
  readonly chest = new THREE.Bone();
  readonly head = new THREE.Bone();
  readonly arms: Record<Side, { upper: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone; drv: ArmDriver }>;
  private thighs: Record<Side, THREE.Bone> = {} as Record<Side, THREE.Bone>;
  private shins: Record<Side, THREE.Bone> = {} as Record<Side, THREE.Bone>;
  /** which side leads (that foot forward, that shoulder turned toward the camera) */
  lead: Side = 'L';
  private mats: Record<keyof BoxerColors, THREE.MeshToonMaterial>;

  constructor(colors: BoxerColors = DEFAULT_COLORS) {
    this.mats = {
      skin: toon(colors.skin), shorts: toon(colors.shorts), gloves: toon(colors.gloves), trim: toon(colors.trim),
    };
    const dark = toon('#1f1813'), hair = toon('#1b130e'), sock = toon('#e9e2d2');
    const skin = this.mats.skin;
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, p: THREE.Vector3, s?: THREE.Vector3, r?: THREE.Euler) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(p); if (s) m.scale.copy(s); if (r) m.rotation.copy(r);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    const cap = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 6, 14);

    // skeleton
    this.root.add(this.hips);
    this.hips.position.set(0, 0.98, 0);
    const spine = new THREE.Bone(); spine.position.set(0, 0.14, 0); this.hips.add(spine);
    this.chest.position.set(0, 0.22, 0); spine.add(this.chest);
    const neck = new THREE.Bone(); neck.position.set(0, 0.2, 0); this.chest.add(neck);
    this.head.position.set(0, 0.1, 0); neck.add(this.head);

    // torso
    add(this.chest, cap(0.16, 0.16), skin, v(0, 0.02, 0), v(1.3, 1, 0.72));
    for (const s of [-1, 1]) add(this.chest, new THREE.SphereGeometry(0.085, 16, 12), skin, v(0.075 * s, 0.05, 0.085), v(1.1, 0.8, 0.55));
    add(spine, cap(0.135, 0.14), skin, v(0, 0.06, 0), v(1.12, 1, 0.75));
    for (let row = 0; row < 3; row++) for (const s of [-1, 1]) {
      add(spine, new THREE.SphereGeometry(0.036, 12, 8), skin, v(0.035 * s, 0.13 - row * 0.065, 0.095), v(1, 0.85, 0.42));
    }
    add(neck, new THREE.CylinderGeometry(0.055, 0.065, 0.12, 12), skin, v(0, 0.02, 0));
    // head
    add(this.head, new THREE.SphereGeometry(0.105, 24, 18), skin, v(0, 0.08, 0.005), v(0.92, 1.12, 1));
    add(this.head, new THREE.SphereGeometry(0.108, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.36), hair, v(0, 0.105, -0.012), v(0.95, 1.08, 1.02));
    for (const s of [-1, 1]) {
      add(this.head, new THREE.SphereGeometry(0.022, 8, 8), skin, v(0.095 * s, 0.07, -0.005), v(0.5, 1, 0.8));
      add(this.head, new THREE.SphereGeometry(0.011, 8, 8), dark, v(0.036 * s, 0.1, 0.092));
      add(this.head, new THREE.BoxGeometry(0.04, 0.009, 0.01), dark, v(0.037 * s, 0.128, 0.094), undefined, new THREE.Euler(0, 0, -0.18 * s));
    }
    add(this.head, new THREE.ConeGeometry(0.016, 0.04, 8), skin, v(0, 0.065, 0.112), undefined, new THREE.Euler(Math.PI / 2.4, 0, 0));
    add(this.head, new THREE.BoxGeometry(0.04, 0.007, 0.01), dark, v(0, 0.02, 0.1));

    // shorts + legs
    add(this.hips, new THREE.CylinderGeometry(0.19, 0.22, 0.3, 24), this.mats.shorts, v(0, -0.07, 0), v(1, 1, 0.78));
    add(this.hips, new THREE.CylinderGeometry(0.192, 0.192, 0.07, 24), this.mats.trim, v(0, 0.09, 0), v(1, 1, 0.78));
    for (const s of [-1, 1]) {
      const thigh = new THREE.Bone(); thigh.position.set(0.1 * s, -0.08, 0); this.hips.add(thigh);
      this.thighs[s > 0 ? 'L' : 'R'] = thigh;
      add(thigh, new THREE.CylinderGeometry(0.11, 0.1, 0.22, 16), this.mats.shorts, v(0, -0.08, 0));
      add(thigh, new THREE.CylinderGeometry(0.112, 0.112, 0.03, 16), this.mats.trim, v(0, -0.19, 0));
      add(thigh, cap(0.075, 0.3), skin, v(0, -0.25, 0));
      const shin = new THREE.Bone(); shin.position.set(0, -0.44, 0); thigh.add(shin);
      this.shins[s > 0 ? 'L' : 'R'] = shin;
      add(shin, cap(0.058, 0.3), skin, v(0, -0.2, 0));
      add(shin, new THREE.CylinderGeometry(0.065, 0.062, 0.18, 14), dark, v(0, -0.38, 0));
      add(shin, new THREE.CylinderGeometry(0.067, 0.067, 0.03, 14), sock, v(0, -0.28, 0));
      add(shin, new THREE.BoxGeometry(0.11, 0.08, 0.24), dark, v(0, -0.47, 0.05));
    }

    // arms (rest pose: hanging, palms facing the thighs)
    const makeArm = (side: Side) => {
      const s = side === 'L' ? 1 : -1;
      const upper = new THREE.Bone(); upper.position.set(0.22 * s, 0.09, 0); this.chest.add(upper);
      add(upper, new THREE.SphereGeometry(0.075, 14, 12), skin, v(0, -0.01, 0), v(1, 0.9, 1));       // shoulder/deltoid
      add(upper, cap(0.058, L1 - 0.1), skin, v(0, -L1 / 2, 0), v(1, 1, 1.05));
      add(upper, new THREE.SphereGeometry(0.05, 12, 10), skin, v(0, -L1 * 0.42, 0.025), v(1, 1.3, 0.9));  // bicep
      const fore = new THREE.Bone(); fore.position.set(0, -L1, 0); upper.add(fore);
      add(fore, cap(0.048, L2 - 0.08), skin, v(0, -L2 / 2 + 0.01, 0));
      const hand = new THREE.Bone(); hand.position.set(0, -L2, 0); fore.add(hand);
      add(hand, new THREE.CylinderGeometry(0.056, 0.06, 0.07, 14), this.mats.trim, v(0, 0.0, 0));
      add(hand, new THREE.SphereGeometry(0.09, 20, 16), this.mats.gloves, v(0, -0.085, 0.01), v(1, 1.15, 1.05));
      add(hand, new THREE.SphereGeometry(0.04, 12, 10), this.mats.gloves, v(-0.06 * s, -0.06, 0.04));   // thumb
      this.root.updateMatrixWorld(true);
      const drv = new ArmDriver(upper, fore, hand, v(s, 0, 0)); // back of the hand faces outward at rest
      return { upper, fore, hand, drv };
    };
    this.arms = { L: makeArm('L'), R: makeArm('R') };
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
    this.setLead('L');
  }

  /** Boxing stance: the lead foot forward, knees soft. */
  setLead(side: Side) {
    this.lead = side;
    for (const k of ['L', 'R'] as Side[]) {
      const front = k === side, s = k === 'L' ? 1 : -1;
      this.thighs[k].rotation.set(front ? -0.2 : 0.14, 0, 0.06 * s);
      this.shins[k].rotation.x = front ? 0.24 : 0.12;
    }
  }

  setColors(c: Partial<BoxerColors>) {
    for (const k of Object.keys(c) as (keyof BoxerColors)[]) if (c[k]) this.mats[k].color.set(c[k]!);
  }

  /** Breathing / bounce. Call every frame before driving the arms. */
  idle(t: number, energy = 1) {
    this.hips.position.y = 0.98 + Math.sin(t * 4.2) * 0.012 * energy;
    const turn = this.lead === 'L' ? -1 : 1;   // lead shoulder toward the camera
    this.hips.rotation.y = 0.18 * turn + Math.sin(t * 1.3) * 0.03;
    this.chest.rotation.x = 0.08 + Math.sin(t * 2.1) * 0.015;
    this.chest.rotation.y = -0.05 * turn + Math.sin(t * 1.3 + 1) * 0.02;
    this.head.rotation.x = -0.12;
    this.head.rotation.y = -0.12 * turn;
  }

  private tmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private rootQ = new THREE.Quaternion();

  /** Drive one arm with character-space directions. */
  driveArm(side: Side, U: THREE.Vector3, D: THREE.Vector3, N: THREE.Vector3 | null) {
    this.root.getWorldQuaternion(this.rootQ);
    const [u, d, n] = this.tmp;
    u.copy(U).applyQuaternion(this.rootQ);
    d.copy(D).applyQuaternion(this.rootQ);
    if (N) n.copy(N).applyQuaternion(this.rootQ);
    this.arms[side].drv.set(u, d, N ? n : null);
  }

  guard(side: Side, t = 0) {
    const g = guardDirs(side === 'L' ? 1 : -1);
    g.D.y += Math.sin(t * 2.1 + (side === 'L' ? 0 : 1.5)) * 0.03;
    this.driveArm(side, g.U, g.D.normalize(), g.N);
  }

  gloveWorld(side: Side, out = new THREE.Vector3()) {
    return this.arms[side].hand.localToWorld(out.set(0, -0.085, 0.01));
  }
  shoulderWorld(side: Side, out = new THREE.Vector3()) {
    return this.arms[side].upper.getWorldPosition(out);
  }
}

/** Translucent arm shown during calibration: straight out in front, palm flat. */
export class GhostArm {
  readonly group = new THREE.Group();
  constructor() {
    const mat = noOutline(new THREE.MeshBasicMaterial({ color: '#f2c94c', transparent: true, opacity: 0.42, depthWrite: false }));
    const rim = noOutline(new THREE.MeshBasicMaterial({ color: '#7a5a10', transparent: true, opacity: 0.5, side: THREE.BackSide, depthWrite: false }));
    for (const m of [mat, rim]) {
      const grow = m === rim ? 1.18 : 1;
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.056 * grow, L1 + L2 - 0.05, 6, 14), m);
      arm.rotation.x = Math.PI / 2;
      arm.position.z = (L1 + L2) / 2;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.095 * grow, 18, 14), m);
      glove.position.z = L1 + L2 + 0.08;
      glove.scale.set(1.05, 1, 1.15);
      this.group.add(arm, glove);
    }
    this.group.visible = false;
    this.group.renderOrder = 10;
  }
  /** place at the boxer's shoulder, pointing straight forward (+z in character space) */
  attach(boxer: Boxer, side: Side) {
    boxer.shoulderWorld(side, this.group.position);
    boxer.root.getWorldQuaternion(this.group.quaternion);
  }
}
