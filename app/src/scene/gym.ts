import * as THREE from 'three';
import { brickWall, canvasMat, dot, poster, shaftGradient, woodFloor, woodPanel } from './textures';
import { noOutline, toon } from './toon';

/* An old boxing gym: wood floor, brick walls, a ring behind the boxer, heavy bags, posters and hanging lamps with
 * dusty light shafts. The boxer stands at the origin facing +z (toward the camera). Units are metres. */
export interface Gym {
  group: THREE.Group;
  update(dt: number, t: number): void;
  /** the heavy bag that bag mode will use (front-right of the boxer) */
  bags: THREE.Object3D[];
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pos: [number, number, number], parent: THREE.Object3D, shadow = false) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}

function lamp(parent: THREE.Object3D, x: number, y: number, z: number, shaftH: number, shaftR: number, strength: number) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.2), toon('#1a1410'));
  cord.position.y = 0.6; g.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.26, 24, 1, true), toon('#3d4a3c', { side: THREE.DoubleSide }));
  g.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), noOutline(new THREE.MeshBasicMaterial({ color: '#fff3c9' })));
  bulb.position.y = -0.1; g.add(bulb);
  const shaft = new THREE.Mesh(
    new THREE.ConeGeometry(shaftR, shaftH, 40, 1, true),
    noOutline(new THREE.MeshBasicMaterial({ map: shaftGradient(), transparent: true, opacity: 0.16 * strength, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
  );
  shaft.position.y = -shaftH / 2 - 0.1;
  g.add(shaft);
  return g;
}

export function buildGym(scene: THREE.Scene): Gym {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color('#1c130c');
  scene.fog = new THREE.Fog('#1c130c', 9, 20);

  // floor and walls
  const floor = mesh(new THREE.PlaneGeometry(22, 22), toon('#ffffff', { map: woodFloor(), outline: false }), [0, 0, 0], group);
  floor.rotation.x = -Math.PI / 2;
  const brick = toon('#ffffff', { map: brickWall(), outline: false });
  const back = mesh(new THREE.PlaneGeometry(18, 7), brick, [0, 3.5, -7], group);
  void back;
  for (const s of [-1, 1]) {
    const side = mesh(new THREE.PlaneGeometry(16, 7), brick, [s * 8, 3.5, 0], group);
    side.rotation.y = -s * Math.PI / 2;
  }
  const panelMat = toon('#ffffff', { map: woodPanel(), outline: false });
  mesh(new THREE.PlaneGeometry(18, 1.3), panelMat, [0, 0.65, -6.98], group);
  for (const s of [-1, 1]) {
    const p = mesh(new THREE.PlaneGeometry(16, 1.3), panelMat, [s * 7.98, 0.65, 0], group);
    p.rotation.y = -s * Math.PI / 2;
  }
  // ceiling beams
  const beam = toon('#3a2616');
  for (const z of [-5.5, -2.5, 0.5, 3.5]) mesh(new THREE.BoxGeometry(16, 0.35, 0.3), beam, [0, 5.2, z], group);

  // posters
  const posters: [string, string, string, number, number, number, number][] = [
    ['FIGHT', 'SAT · 8 PM', '#9e2a1e', -4.2, 2.6, -6.95, 0],
    ['BOXING', 'MAIN EVENT', '#2f4a63', 3.9, 2.7, -6.95, 0],
    ['JAB', 'TRAIN HARD', '#9e2a1e', 0.9, 3.4, -6.95, 0],
    ['KO!', '10 ROUNDS', '#b8860b', -7.95, 2.6, -1.5, Math.PI / 2],
    ['CHAMP', 'TITLE BOUT', '#2f4a63', 7.95, 2.6, -2.5, -Math.PI / 2],
  ];
  for (const [t, s, col, x, y, z, ry] of posters) {
    const p = mesh(new THREE.PlaneGeometry(0.9, 1.35), toon('#ffffff', { map: poster(t, s, col), outline: false }), [x, y, z], group);
    p.rotation.y = ry;
    p.rotation.z = (Math.sin(x * 7) * 0.04);
  }

  // ring behind the boxer
  const ring = new THREE.Group();
  ring.position.set(0, 0, -4);
  group.add(ring);
  const H = 0.55, S = 5;
  mesh(new THREE.BoxGeometry(S, H, S), [toon('#6b2119'), toon('#6b2119'), toon('#ffffff', { map: canvasMat() }), toon('#6b2119'), toon('#6b2119'), toon('#6b2119')], [0, H / 2, 0], ring);
  const postMat = toon('#2b2622');
  const pads = ['#a32a1f', '#2d4a6b', '#e8dfc8', '#e8dfc8'];
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz], i) => {
    mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.7, 12), postMat, [sx * S / 2, H + 0.85, sz * S / 2], ring, true);
    mesh(new THREE.BoxGeometry(0.22, 1.05, 0.22), toon(pads[i]), [sx * (S / 2 - 0.02), H + 0.9, sz * (S / 2 - 0.02)], ring);
  });
  const ropeCols = ['#c43a2a', '#efe4cc', '#2f4f7a'];
  for (let k = 0; k < 3; k++) {
    const y = H + 0.45 + k * 0.4;
    const mat = toon(ropeCols[k], { thickness: 0.003 });
    for (const [x, z, rot] of [[0, -S / 2, 0], [0, S / 2, 0], [-S / 2, 0, 1], [S / 2, 0, 1]] as const) {
      const r = mesh(new THREE.CylinderGeometry(0.03, 0.03, S, 8), mat, [x, y, z], ring);
      r.rotation.z = Math.PI / 2;
      if (rot) r.rotation.y = Math.PI / 2;
    }
  }

  // heavy bags with chains
  const bags: THREE.Object3D[] = [];
  const leather = [toon('#5a1712'), toon('#2a2320'), toon('#6b2a18')];
  [[-3.4, -1.6], [3.6, -2.2], [-5.2, -4.5]].forEach(([x, z], i) => {
    const bag = new THREE.Group();
    bag.position.set(x, 3.0, z);
    group.add(bag);
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.2), toon('#2a2724'), [0, 1.1, 0], bag);
    for (const a of [0, 2.1, 4.2]) {
      const ch = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.45), toon('#2a2724'), [Math.cos(a) * 0.1, -0.18, Math.sin(a) * 0.1], bag);
      ch.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
    }
    mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.15, 24), leather[i], [0, -0.95, 0], bag, true);
    mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.06, 24), toon('#1a1512'), [0, -0.5, 0], bag);
    mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.06, 24), toon('#1a1512'), [0, -1.4, 0], bag);
    bags.push(bag);
  });

  // lamps + light
  lamp(group, 0, 4.1, 0.3, 4.0, 1.7, 1);
  lamp(group, 0, 4.1, -4, 3.5, 1.9, 0.6);
  lamp(group, -3.4, 4.3, -1.6, 3.6, 1.3, 0.4);
  lamp(group, 3.6, 4.3, -2.2, 3.6, 1.3, 0.4);

  scene.add(new THREE.HemisphereLight('#ffe2bf', '#2a1a0e', 0.55));
  const key = new THREE.SpotLight('#ffd49a', 26, 0, 0.62, 0.65, 1.6);
  key.position.set(0, 4.0, 0.4);
  key.target.position.set(0, 0.8, 0.1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  scene.add(key, key.target);
  const ringLight = new THREE.SpotLight('#ffcf8a', 18, 0, 0.7, 0.8, 1.6);
  ringLight.position.set(0, 4, -4);
  ringLight.target.position.set(0, 0, -4);
  scene.add(ringLight, ringLight.target);
  const fill = new THREE.DirectionalLight('#ffe2b8', 0.45);
  fill.position.set(2, 2.5, 5);
  scene.add(fill);

  // dust motes floating in the main light shaft
  const N = 220;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = Math.sqrt(Math.random()) * 1.4, a = Math.random() * 6.28;
    pos.set([Math.cos(a) * r, 0.3 + Math.random() * 3.6, 0.3 + Math.sin(a) * r], i * 3);
    vel[i] = 0.02 + Math.random() * 0.05;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, noOutline(new THREE.PointsMaterial({ size: 0.035, map: dot(), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ffe7b8' })));
  group.add(dust);

  return {
    group,
    bags,
    update(dt, t) {
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] -= vel[i] * dt;
        pos[i * 3] += Math.sin(t * 0.3 + i) * 0.002;
        if (pos[i * 3 + 1] < 0.2) pos[i * 3 + 1] = 3.9;
      }
      dustGeo.attributes.position.needsUpdate = true;
      bags.forEach((b, i) => { b.rotation.z = Math.sin(t * 0.6 + i) * 0.01; });
    },
  };
}
