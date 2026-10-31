import * as THREE from 'three';
import { ProjectileKind } from '../../game/units';
import { glowMaterial, registerModel, setRig } from '../models';

/** Projectiles are built along +z and oriented along their velocity by the rig. */
function projectile(length: number, width: number, color: number): THREE.Object3D {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, width, length), glowMaterial(color));
  m.userData.noShadow = true;
  const root = new THREE.Group();
  root.add(m);
  return setRig(root, { faceVelocity: true });
}

const looks: Record<ProjectileKind, () => THREE.Object3D> = {
  bullet: () => projectile(0.6, 0.06, 0xffe7a0),
  shell: () => projectile(0.5, 0.14, 0xffb050),
  missile: () => projectile(0.45, 0.12, 0xff8a40),
  artillery: () => projectile(0.4, 0.22, 0xffc070),
};

for (const kind of Object.keys(looks) as ProjectileKind[]) {
  registerModel(`projectile:${kind}`, looks[kind]);
}
