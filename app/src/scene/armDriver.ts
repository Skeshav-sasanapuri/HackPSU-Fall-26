import * as THREE from 'three';

/* Points a bone along a world direction without assuming anything about the rig's axes: the bone's own axis is the
 * direction to its child (taken from the rest pose), and the rotation is solved in the parent's space. Works the same
 * for the placeholder rig and for Mixamo skeletons. */
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class BoneAim {
  readonly rest: THREE.Quaternion;
  /** bone axis (towards the child) in the bone's local frame */
  readonly axisLocal: THREE.Vector3;
  /** a reference direction perpendicular to the axis, in the bone's local frame (used for twist) */
  refLocal: THREE.Vector3 | null = null;

  constructor(readonly bone: THREE.Object3D, child: THREE.Object3D) {
    this.rest = bone.quaternion.clone();
    this.axisLocal = child.position.clone().normalize();
  }

  /** Remember which way `worldDir` points in bone space right now (call in the rest pose). */
  setTwistReference(worldDir: THREE.Vector3) {
    this.bone.updateWorldMatrix(true, false);
    const inv = this.bone.getWorldQuaternion(_q).invert();
    const r = worldDir.clone().applyQuaternion(inv);
    r.addScaledVector(this.axisLocal, -r.dot(this.axisLocal)).normalize();
    this.refLocal = r;
  }

  /** Aim the bone along `dirWorld` (unit). If `twistWorld` is given, roll the bone so its reference points that way. */
  aim(dirWorld: THREE.Vector3, twistWorld?: THREE.Vector3 | null) {
    const parent = this.bone.parent!;
    parent.updateWorldMatrix(true, false);
    const parentInv = parent.getWorldQuaternion(_q).invert();
    const target = _v.copy(dirWorld).applyQuaternion(parentInv).normalize();
    const restDir = _v2.copy(this.axisLocal).applyQuaternion(this.rest);
    _q2.setFromUnitVectors(restDir, target);
    this.bone.quaternion.copy(_q2).multiply(this.rest);

    if (twistWorld && this.refLocal) {
      // current world direction of the reference, both projected onto the plane across the bone
      const worldQ = parent.getWorldQuaternion(new THREE.Quaternion()).multiply(this.bone.quaternion);
      const axisW = this.axisLocal.clone().applyQuaternion(worldQ);
      const refW = this.refLocal.clone().applyQuaternion(worldQ);
      const want = twistWorld.clone().addScaledVector(axisW, -twistWorld.dot(axisW));
      if (want.lengthSq() < 1e-6) return;
      want.normalize();
      const ang = Math.atan2(axisW.dot(refW.clone().cross(want)), refW.dot(want));
      this.bone.quaternion.multiply(_q2.setFromAxisAngle(this.axisLocal, ang));
    }
  }

  reset() { this.bone.quaternion.copy(this.rest); }
}

/** Upper arm + forearm of one side. */
export class ArmDriver {
  readonly upper: BoneAim;
  readonly fore: BoneAim;

  constructor(upper: THREE.Object3D, fore: THREE.Object3D, hand: THREE.Object3D, backOfHandRestWorld: THREE.Vector3) {
    this.upper = new BoneAim(upper, fore);
    this.fore = new BoneAim(fore, hand);
    this.fore.setTwistReference(backOfHandRestWorld);
  }

  /** U, D, N are world directions: upper arm, forearm, back of the wrist (watch face). */
  set(U: THREE.Vector3, D: THREE.Vector3, N: THREE.Vector3 | null) {
    this.upper.aim(U);
    this.fore.aim(D, N);
  }
}
