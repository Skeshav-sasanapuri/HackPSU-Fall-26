import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { Boxer, GhostArm } from './boxer';
import { Gym, buildGym } from './gym';

/* The 3D stage shared by the calibrate / home / mirror screens: one renderer, one gym, one boxer.
 * Screens register per-frame callbacks and pick a camera shot. */
export type Shot = 'hero' | 'threeQuarter' | 'side' | 'front';
type FrameFn = (dt: number, t: number) => void;

const SHOTS: Record<Shot, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  hero: { pos: [0.0, 1.35, 3.6], look: [0, 1.15, 0], fov: 42 },
  threeQuarter: { pos: [1.9, 1.55, 3.0], look: [0.05, 1.2, 0.2], fov: 40 },
  side: { pos: [3.4, 1.45, 0.6], look: [0, 1.25, 0.3], fov: 38 },
  front: { pos: [0, 1.5, 3.2], look: [0, 1.25, 0.2], fov: 42 },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
  readonly boxer = new Boxer();
  readonly ghost = new GhostArm();
  readonly gym: Gym;
  private effect: OutlineEffect;
  private frames = new Set<FrameFn>();
  private raf = 0;
  private last = 0;
  private t = 0;
  private host: HTMLElement | null = null;
  private ro: ResizeObserver | null = null;
  private camFrom = new THREE.Vector3();
  private camTo = new THREE.Vector3();
  private lookFrom = new THREE.Vector3();
  private lookTo = new THREE.Vector3();
  private look = new THREE.Vector3();
  private camK = 1;
  private shake = 0;
  /** frames per second, smoothed */
  fps = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // the ink-outline pass draws everything twice
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.effect = new OutlineEffect(this.renderer, { defaultThickness: 0.004, defaultColor: [0.09, 0.06, 0.04], defaultAlpha: 1 });
    this.gym = buildGym(this.scene);
    this.scene.add(this.boxer.root, this.ghost.group);
    this.setShot('threeQuarter', true);
  }

  mount(host: HTMLElement) {
    this.host = host;
    host.appendChild(this.renderer.domElement);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const raw = (now - this.last) / 1000;
      if (raw > 0) this.fps += (1 / raw - this.fps) * 0.05;
      const dt = Math.min(0.05, raw);
      this.last = now;
      this.t += dt;
      this.step(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  unmount() {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.renderer.domElement.remove();
    this.host = null;
  }

  onFrame(fn: FrameFn) { this.frames.add(fn); return () => { this.frames.delete(fn); }; }

  setShot(shot: Shot, instant = false) {
    const s = SHOTS[shot];
    this.camFrom.copy(this.camera.position);
    this.lookFrom.copy(this.look);
    this.camTo.set(...s.pos);
    this.lookTo.set(...s.look);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.camK = instant ? 1 : 0;
    if (instant) { this.camera.position.copy(this.camTo); this.look.copy(this.lookTo); }
  }

  /** small camera kick, 0..1 */
  kick(amount: number) { this.shake = Math.min(1, this.shake + amount); }

  /** world point -> CSS pixels inside the host */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    const el = this.renderer.domElement;
    return { x: ((v.x + 1) / 2) * el.clientWidth, y: ((1 - v.y) / 2) * el.clientHeight };
  }

  private resize() {
    if (!this.host) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    // narrow screens: pull back so the boxer still fits
    this.camera.zoom = Math.min(1, (w / Math.max(h, 1)) / 1.2);
    this.camera.updateProjectionMatrix();
  }

  private step(dt: number) {
    const t = this.t;
    if (this.camK < 1) {
      this.camK = Math.min(1, this.camK + dt / 0.6);
      const k = 1 - Math.pow(1 - this.camK, 3);
      this.camera.position.lerpVectors(this.camFrom, this.camTo, k);
      this.look.lerpVectors(this.lookFrom, this.lookTo, k);
    }
    // slow handheld drift + shake
    const sh = this.shake * this.shake * 0.04;
    this.shake = Math.max(0, this.shake - dt * 3);
    this.camera.position.x += Math.sin(t * 0.35) * 0.0008 + (Math.random() - 0.5) * sh;
    this.camera.position.y += (Math.random() - 0.5) * sh;
    this.camera.lookAt(this.look);

    this.boxer.idle(t);
    for (const f of this.frames) f(dt, t);
    this.gym.update(dt, t);
    this.effect.render(this.scene, this.camera);
  }
}

let shared: Stage | null = null;
/** One stage for the whole app (WebGL contexts are precious). */
export function getStage(): Stage {
  shared ??= new Stage();
  if (import.meta.env.DEV) (window as unknown as { __stage: Stage }).__stage = shared;
  return shared;
}
