import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArmDriver } from './armDriver';

function chain(rootRot: THREE.Euler) {
  const root = new THREE.Object3D();
  root.rotation.copy(rootRot);
  const chest = new THREE.Bone(); root.add(chest);
  chest.rotation.set(0.3, -0.2, 0.1); // arbitrary parent orientation, like a real rig
  const upper = new THREE.Bone(); upper.position.set(0.2, 0.1, 0); upper.rotation.set(0.4, 1.1, -0.7); chest.add(upper);
  const fore = new THREE.Bone(); fore.position.set(0.05, -0.3, 0.02); fore.rotation.set(-0.2, 0.3, 0.5); upper.add(fore);
  const hand = new THREE.Bone(); hand.position.set(0, -0.27, 0.01); fore.add(hand);
  root.updateMatrixWorld(true);
  return { root, upper, fore, hand };
}

const worldDir = (a: THREE.Object3D, b: THREE.Object3D) =>
  b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3())).normalize();
const deg = (a: THREE.Vector3, b: THREE.Vector3) => (a.angleTo(b) * 180) / Math.PI;

describe('ArmDriver', () => {
  it('points the bones along the targets and rolls the forearm to the twist target, for any rig axes', () => {
    const { root, upper, fore, hand } = chain(new THREE.Euler(0.2, 2.5, -0.1));
    const drv = new ArmDriver(upper, fore, hand, new THREE.Vector3(1, 0, 0));
    const cases = [
      [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
      [new THREE.Vector3(0.3, -0.8, 0.5), new THREE.Vector3(-0.2, 0.9, 0.3), new THREE.Vector3(0, 0, 1)],
      [new THREE.Vector3(1, 0, 0.2), new THREE.Vector3(-0.6, 0.1, 0.8), new THREE.Vector3(0, 1, 0)],
    ];
    for (const [U, D, N] of cases) {
      U.normalize(); D.normalize(); N.normalize();
      drv.set(U, D, N);
      root.updateMatrixWorld(true);
      expect(deg(worldDir(upper, fore), U)).toBeLessThan(0.5);
      expect(deg(worldDir(fore, hand), D)).toBeLessThan(0.5);
      // reference of the forearm now points at N (projected across the forearm)
      const q = fore.getWorldQuaternion(new THREE.Quaternion());
      const ref = drv.fore.refLocal!.clone().applyQuaternion(q);
      const want = N.clone().addScaledVector(D, -N.dot(D)).normalize();
      expect(deg(ref, want)).toBeLessThan(0.5);
    }
  });
});
