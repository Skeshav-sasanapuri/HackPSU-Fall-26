import * as THREE from 'three';
import { dot as dotTex } from './textures';
import { noOutline, toon } from './toon';

/* The heavy bag for bag mode: a pendulum with damping, a little twist and squash, and a capsule to hit. */
export interface BagHit { point: THREE.Vector3; normal: THREE.Vector3; speed: number }

const G = 9.81;
const BAG_KG = 35;

export class HeavyBag {
  readonly pivot = new THREE.Group();
  readonly body = new THREE.Group();
  readonly R = 0.25;
  readonly H = 1.15;
  readonly L = 1.25;            // anchor to bag centre
  private d = new THREE.Vector2();
  private v = new THREE.Vector2();
  private twist = 0;
  private twistV = 0;
  private squash = 0;
  private armed = true;
  private center = new THREE.Vector3();

  constructor() {
    const leather = toon('#6b1d14');
    const band = toon('#1b1714');
    const chain = toon('#2a2724');
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; this.body.add(m); return m;
    };
    add(new THREE.CylinderGeometry(this.R, this.R, this.H, 28), leather, 0);
    add(new THREE.SphereGeometry(this.R, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2), leather, this.H / 2).scale.y = 0.25;
    add(new THREE.SphereGeometry(this.R, 28, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), leather, -this.H / 2).scale.y = 0.3;
    for (const y of [0.42, -0.42]) add(new THREE.CylinderGeometry(this.R + 0.006, this.R + 0.006, 0.07, 28), band, y);
    // a worn patch where everyone hits
    add(new THREE.CylinderGeometry(this.R + 0.003, this.R + 0.003, 0.3, 28, 1, true, -0.6, 1.2), toon('#8a2a1d'), 0.18);
    this.body.position.y = -this.L;
    this.pivot.add(this.body);
    for (const a of [0, 2.1, 4.2]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, this.L - this.H / 2 - 0.05), chain);
      c.position.set(Math.cos(a) * 0.08, -(this.L - this.H / 2) / 2, Math.sin(a) * 0.08);
      c.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12);
      this.pivot.add(c);
    }
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2), chain);
    top.position.y = 1;
    this.pivot.add(top);
  }

  /** hang the bag so its centre is at `center` */
  place(center: THREE.Vector3) {
    this.pivot.position.set(center.x, center.y + this.L, center.z);
    this.d.set(0, 0); this.v.set(0, 0); this.twist = this.twistV = this.squash = 0;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const w2 = G / this.L, c = 0.9;
    this.v.x += (-w2 * this.d.x - c * this.v.x) * dt;
    this.v.y += (-w2 * this.d.y - c * this.v.y) * dt;
    this.d.addScaledVector(this.v, dt);
    this.twistV += (-6 * this.twist - 1.5 * this.twistV) * dt;
    this.twist += this.twistV * dt;
    this.squash *= Math.exp(-dt * 9);
    this.pivot.rotation.set(-this.d.y / this.L, this.twist, this.d.x / this.L);
    const s = this.squash;
    this.body.scale.set(1 + 0.1 * s, 1 - 0.06 * s, 1 + 0.1 * s);
  }

  /** Glove sphere vs bag capsule. Returns a hit when the glove arrives moving toward the bag. */
  test(glove: THREE.Vector3, gloveVel: THREE.Vector3, gloveR = 0.1): BagHit | null {
    this.body.getWorldPosition(this.center);
    const up = new THREE.Vector3().subVectors(this.pivot.position, this.center).normalize();
    const rel = new THREE.Vector3().subVectors(glove, this.center);
    const along = THREE.MathUtils.clamp(rel.dot(up), -this.H / 2, this.H / 2);
    const closest = this.center.clone().addScaledVector(up, along);
    const n = new THREE.Vector3().subVectors(glove, closest);
    const dist = n.length();
    if (dist > this.R + gloveR + 0.04) this.armed = true;
    if (!this.armed || dist > this.R + gloveR || dist < 1e-6) return null;
    n.divideScalar(dist);
    const approach = -gloveVel.dot(n);
    if (approach < 0.8) return null;
    this.armed = false;
    return { point: closest.addScaledVector(n, this.R), normal: n, speed: approach };
  }

  /** Push the bag. `effMass` is the punch's effective mass (kg), `speed` the fist speed (m/s). */
  punch(hit: BagHit, speed: number, effMass: number) {
    const dv = (effMass * speed * 1.3) / BAG_KG;
    this.v.x += -hit.normal.x * dv;
    this.v.y += -hit.normal.z * dv;
    // off-centre hits twist the bag
    this.twistV += (hit.normal.x * 0.6 - hit.normal.z * 0.2) * dv * 2;
    this.squash = Math.min(1, this.squash + 0.3 + speed / 15);
  }
}

/* Impact effects: shockwave ring, flash, chalk dust. Pooled, cheap. */
export class ImpactFx {
  readonly group = new THREE.Group();
  private rings: { m: THREE.Mesh; t: number; s: number }[] = [];
  private flashes: { m: THREE.Sprite; t: number }[] = [];
  private dust: THREE.Points;
  private dpos: Float32Array;
  private dvel: Float32Array;
  private dlife: Float32Array;
  private N = 240;
  private next = 0;

  constructor() {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), noOutline(new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })));
      m.visible = false; this.group.add(m); this.rings.push({ m, t: 1, s: 1 });
      const f = new THREE.Sprite(noOutline(new THREE.SpriteMaterial({ map: dotTex(), color: '#fff3c0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
      f.visible = false; this.group.add(f); this.flashes.push({ m: f, t: 1 });
    }
    this.dpos = new Float32Array(this.N * 3);
    this.dvel = new Float32Array(this.N * 3);
    this.dlife = new Float32Array(this.N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dpos, 3));
    this.dust = new THREE.Points(geo, noOutline(new THREE.PointsMaterial({ size: 0.05, map: dotTex(), color: '#efe3c4', transparent: true, opacity: 0.85, depthWrite: false })));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
    for (let i = 0; i < this.N; i++) this.dpos[i * 3 + 1] = -100;
  }

  burst(p: THREE.Vector3, n: THREE.Vector3, k: number) {
    const r = this.rings.find((x) => x.t >= 1) ?? this.rings[0];
    r.t = 0; r.s = 0.25 + 0.35 * k;
    r.m.position.copy(p).addScaledVector(n, 0.02);
    r.m.lookAt(p.clone().add(n));
    r.m.visible = true;
    const f = this.flashes.find((x) => x.t >= 1) ?? this.flashes[0];
    f.t = 0; f.m.position.copy(p).addScaledVector(n, 0.05); f.m.visible = true;
    const count = Math.round(20 + 40 * k);
    for (let c = 0; c < count; c++) {
      const i = this.next = (this.next + 1) % this.N;
      this.dpos.set([p.x, p.y, p.z], i * 3);
      const sp = 0.6 + Math.random() * 2.2 * (0.5 + k);
      const rnd = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(1.2);
      const v = n.clone().add(rnd).normalize().multiplyScalar(sp);
      this.dvel.set([v.x, v.y, v.z], i * 3);
      this.dlife[i] = 0.5 + Math.random() * 0.5;
    }
  }

  update(dt: number) {
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / 0.32);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.m.scale.setScalar(r.s * (0.3 + e));
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - r.t);
      if (r.t >= 1) r.m.visible = false;
    }
    for (const f of this.flashes) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt / 0.12);
      f.m.scale.setScalar(0.5 + f.t * 0.4);
      (f.m.material as THREE.SpriteMaterial).opacity = 1 - f.t;
      if (f.t >= 1) f.m.visible = false;
    }
    for (let i = 0; i < this.N; i++) {
      if (this.dlife[i] <= 0) continue;
      this.dlife[i] -= dt;
      this.dvel[i * 3 + 1] -= 3 * dt;
      for (let k = 0; k < 3; k++) { this.dvel[i * 3 + k] *= 1 - 2.5 * dt; this.dpos[i * 3 + k] += this.dvel[i * 3 + k] * dt; }
      if (this.dlife[i] <= 0) this.dpos[i * 3 + 1] = -100;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }
}
