import * as THREE from 'three';
import { ProjectileKind } from '../../game/units';
import { box, glowBox, registerModel, setRig } from '../models';

/** Projectiles are built along +z and oriented along their velocity by the rig. */
function projectile(length: number, width: number, color: number): THREE.Object3D {
  const m = glowBox(width, width, length, color);
  const root = new THREE.Group();
  root.add(m);
  return setRig(root, { faceVelocity: true });
}

const looks: Record<ProjectileKind, () => THREE.Object3D> = {
  bullet: () => projectile(0.6, 0.06, 0xffe7a0),
  shell: () => projectile(0.5, 0.14, 0xffb050),
  missile: () => projectile(0.45, 0.12, 0xff8a40),
  artillery: () => projectile(0.4, 0.22, 0xffc070),
  // A gout of burning fuel: short, fat and bright.
  flame: () => projectile(0.5, 0.32, 0xff7a1a),
  // Aegis's lance: a long, thin, blue-white bolt.
  beam: () => projectile(1.6, 0.07, 0xa8e4ff),
  // Rime's cryo spray: a pale puff of freezing mist.
  frost: () => projectile(0.4, 0.3, 0xdff6ff),
  hack: () => projectile(1.2, 0.09, 0x6ab8aa),
  // Antiquity's arrows and bolts, and a trebuchet's stone.
  arrow: () => projectile(0.7, 0.04, 0xb08a5a),
  stone: () => projectile(0.4, 0.4, 0x8a8478),
  // Verdant's seed pods and vine lashes.
  seed: () => projectile(0.3, 0.3, 0x7ab04a),
  vine: () => projectile(1.2, 0.06, 0x4a8a2a),
  // Lodestar's flung wrecks: a dark tumbling chunk of hull.
  scrap: () => {
    const root = new THREE.Group();
    root.add(box(0.5, 0.35, 0.6, 0x4a4640));
    return setRig(root, { faceVelocity: true });
  },
  // Hive's acid: a fat, sickly glob.
  acid: () => projectile(0.35, 0.26, 0xc6e03a),
  // Zenith's strike: a column of light coming straight down, its foot at the projectile.
  orbital: () => {
    const root = new THREE.Group();
    const core = glowBox(0.35, 16.4, 0.35, 0xfff2c8);
    core.position.y = 8;
    const glow = glowBox(0.9, 16, 0.9, 0xffb860);
    glow.position.y = 8;
    root.add(glow, core);
    return root;
  },
};

for (const kind of Object.keys(looks) as ProjectileKind[]) {
  registerModel(`projectile:${kind}`, looks[kind]);
}
