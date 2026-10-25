import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ArmDriver } from './armDriver';
import { guardDirs } from './boxer';
import { Fighter, FighterColors, Side } from './fighter';
import { toon } from './toon';

/* A rigged character from a GLB (Mixamo skeleton). Bones are found by their Mixamo names, the model is scaled to
 * a human height and turned to face +z, the idle clip plays underneath, and the tracked arm is overridden every
 * frame by the same ArmDriver the placeholder uses. Comic gloves are attached to the hand bones. */
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

type BoneMap = Record<string, THREE.Bone>;
const find = (bones: BoneMap, name: string) => Object.entries(bones).find(([k]) => k.endsWith(name))?.[1];

export class GltfFighter implements Fighter {
  readonly root = new THREE.Group();
  lead: Side = 'L';
  private mixer: THREE.AnimationMixer | null = null;
  private arms = {} as Record<Side, { upper: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone; drv: ArmDriver; glove: THREE.Object3D }>;
  private hips: THREE.Bone | null = null;
  private skinMats: THREE.MeshToonMaterial[] = [];
  private shortsMats: THREE.MeshToonMaterial[] = [];
  private gloveMats: THREE.MeshToonMaterial[] = [];
  private yaw = new THREE.Quaternion();
  private hipsRest = new THREE.Quaternion();

  static async load(url: string, colors: FighterColors, height = 1.8): Promise<GltfFighter> {
    const gltf = await loader.loadAsync(url);
    return new GltfFighter(gltf.scene, gltf.animations, colors, height);
  }

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], colors: FighterColors, height: number) {
    this.root.add(model);
    const bones: BoneMap = {};
    model.traverse((o) => { if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone; });
    const need = (n: string) => { const b = find(bones, n); if (!b) throw new Error(`model has no ${n} bone`); return b; };

    // size and facing: height from the bounding box, left shoulder must end up on +x (facing +z)
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const s = height / Math.max(box.max.y - box.min.y, 1e-3);
    model.scale.multiplyScalar(s);
    model.updateMatrixWorld(true);
    const l = need('LeftArm').getWorldPosition(new THREE.Vector3()), r = need('RightArm').getWorldPosition(new THREE.Vector3());
    const across = l.sub(r).setY(0).normalize();
    model.rotation.y += Math.atan2(across.z, across.x);
    model.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(model);
    model.position.y -= box2.min.y;
    model.position.x -= (box2.min.x + box2.max.x) / 2;
    model.position.z -= (box2.min.z + box2.max.z) / 2;
    model.updateMatrixWorld(true);

    // comic materials: skin and shorts get recoloured, anything textured keeps its texture
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      const conv = (old: THREE.Material) => {
        const src = old as THREE.MeshStandardMaterial;
        const name = (src.name || '').toLowerCase();
        if (/short|pant|trunk|cloth/.test(name)) { const t = toon(colors.shorts); this.shortsMats.push(t); return t; }
        if (/joint/.test(name)) return toon('#2a2622');
        if (src.map && !/skin|body/.test(name)) return toon('#ffffff', { map: src.map });
        const t = toon(colors.skin, { map: src.map ?? undefined });
        if (!src.map) this.skinMats.push(t);
        return t;
      };
      m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
    });

    // rest pose is the bind pose here (before any animation): set up the arm drivers now
    this.hips = find(bones, 'Hips') ?? null;
    if (this.hips) this.hipsRest.copy(this.hips.quaternion);
    for (const side of ['L', 'R'] as Side[]) {
      const pre = side === 'L' ? 'Left' : 'Right', sx = side === 'L' ? 1 : -1;
      const upper = need(`${pre}Arm`), fore = need(`${pre}ForeArm`), hand = need(`${pre}Hand`);
      const hp = hand.getWorldPosition(new THREE.Vector3());
      const mid = find(bones, `${pre}HandMiddle1`), idx = find(bones, `${pre}HandIndex1`), pinky = find(bones, `${pre}HandPinky1`);
      const fdir = (mid ? mid.getWorldPosition(new THREE.Vector3()) : hp.clone().sub(fore.getWorldPosition(new THREE.Vector3())).add(hp)).sub(hp).normalize();
      let back = new THREE.Vector3(0, 1, 0);   // T-pose, palms down
      if (idx && pinky) {
        const a = pinky.getWorldPosition(new THREE.Vector3()).sub(idx.getWorldPosition(new THREE.Vector3()));
        back = new THREE.Vector3().crossVectors(fdir, a).multiplyScalar(sx).normalize();
      }
      const drv = new ArmDriver(upper, fore, hand, back);
      // glove: a toon mitt at the knuckles, parented to the hand bone without changing its world placement
      const glove = new THREE.Group();
      const gm = toon(colors.gloves); this.gloveMats.push(gm);
      const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.092, 22, 16), gm);
      mitt.scale.set(1, 1, 1.18);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.066, 0.08, 16), toon('#efe6d2'));
      cuff.rotation.x = Math.PI / 2;
      cuff.position.z = -0.1;
      glove.add(mitt, cuff);
      mitt.castShadow = true;
      glove.position.copy(hp).addScaledVector(fdir, 0.065);
      glove.lookAt(glove.position.clone().add(fdir));
      glove.updateMatrixWorld();
      this.root.updateMatrixWorld(true);
      hand.attach(glove);
      // fingers stay hidden inside the glove
      for (const f of ['Thumb1', 'Index1', 'Middle1', 'Ring1', 'Pinky1']) find(bones, `${pre}Hand${f}`)?.scale.setScalar(0.55);
      this.arms[side] = { upper, fore, hand, drv, glove };
    }

    const idle = clips.find((c) => /idle|stance|guard|fight/i.test(c.name));
    if (idle) {
      this.mixer = new THREE.AnimationMixer(model);
      this.mixer.clipAction(idle).play();
    }
    this.setLead('L');
  }

  setLead(side: Side) {
    this.lead = side;
    this.yaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side === 'L' ? -0.2 : 0.2);
  }

  private pq = new THREE.Quaternion();
  update(dt: number) {
    const h = this.hips;
    if (h) h.quaternion.copy(this.hipsRest);
    this.mixer?.update(dt);
    if (!h?.parent) return;
    // turn the hips about the world vertical so the lead shoulder comes forward (after the animation wrote its pose)
    h.parent.getWorldQuaternion(this.pq);
    h.quaternion.premultiply(this.pq).premultiply(this.yaw).premultiply(this.pq.invert());
  }

  private rootQ = new THREE.Quaternion();
  private tmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
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

  gloveWorld(side: Side, out = new THREE.Vector3()) { return this.arms[side].glove.getWorldPosition(out); }
  shoulderWorld(side: Side, out = new THREE.Vector3()) { return this.arms[side].upper.getWorldPosition(out); }

  setColors(c: Partial<FighterColors>) {
    if (c.skin) this.skinMats.forEach((m) => m.color.set(c.skin!));
    if (c.shorts) this.shortsMats.forEach((m) => m.color.set(c.shorts!));
    if (c.gloves) this.gloveMats.forEach((m) => m.color.set(c.gloves!));
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose()); }
    });
  }
}
