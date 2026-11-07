import * as THREE from 'three';
import { box, registerModel, setRig } from '../models';

/** God powers' own models (see game/god.ts): the airstrike's bombers and their bombs. Nobody's colours. */

const HULL = 0x3e4248;
const WING = 0x2f3236;
const STRIPE = 0xe8d27a;

registerModel('god:bomber', () => {
  const root = new THREE.Group();
  root.add(box(2.6, 0.45, 0.6, HULL, 0, 0.3, 0)); // fuselage
  root.add(box(0.4, 0.28, 0.44, 0x9fe3ff, 1.3, 0.4, 0)); // canopy
  root.add(box(0.9, 0.08, 3.8, WING, 0.15, 0.36, 0)); // wings
  root.add(box(0.2, 0.09, 3.82, STRIPE, -0.15, 0.37, 0)); // a gold band, so they read as nobody's side
  root.add(box(0.5, 0.06, 1.3, WING, -1.15, 0.48, 0)); // tailplane
  root.add(box(0.45, 0.55, 0.07, HULL, -1.15, 0.7, 0)); // fin
  for (const side of [-1, 1]) for (const out of [0.75, 1.35]) root.add(box(0.6, 0.22, 0.22, 0x5d6066, 0.35, 0.25, side * out)); // engines
  return root;
});

/** A falling bomb, built along +z and turned to fall nose first by the rig. */
function bomb(length: number, width: number): THREE.Object3D {
  const root = new THREE.Group();
  root.add(box(width, width, length, 0x2b2b2e, 0, 0, 0));
  root.add(box(width * 1.8, 0.04, width * 0.6, 0x5d6066, 0, 0, -length * 0.45)); // fins
  root.add(box(0.04, width * 1.8, width * 0.6, 0x5d6066, 0, 0, -length * 0.45));
  return setRig(root, { faceVelocity: true });
}

registerModel('god:bomb', () => bomb(0.55, 0.16));
registerModel('god:bigBomb', () => bomb(1.6, 0.5));
