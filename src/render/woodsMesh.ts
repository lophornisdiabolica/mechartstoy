import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { TREE_HEIGHT } from '../world/woods';
import { pineGeometry, treeGeometry } from './propsMesh';

/** Height of the tree geometries (pine and broadleaf both come out about this tall at scale 1). */
const GEOMETRY_HEIGHT = 1.4;

/**
 * The dense forest's trees (see woods.ts), as one instanced mesh: bigger
 * and darker than the light woods' scenery. A tree that's knocked down is
 * laid on its side where it fell, pointing away from what felled it. Stops
 * listening when `dispose` (on the returned group's userData) is called.
 */
export function buildWoods(field: Battlefield, rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'woods';
  const trees = field.woods.trees;
  if (trees.length === 0) {
    group.userData.dispose = () => {};
    return group;
  }
  const biome = field.config.biome;
  const geometry = biome === 'snow' ? pineGeometry(true) : biome === 'forest' || biome === 'temperate' ? pineGeometry(false) : treeGeometry();
  const tint = biome === 'desert' ? 0x6f7a44 : biome === 'snow' || biome === 'forest' || biome === 'temperate' ? 0xc8d2c0 : 0x3f6a34;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geometry, material, trees.length);
  const dummy = new THREE.Object3D();
  const base = new THREE.Color(tint);
  const spin = trees.map(() => rng.range(0, Math.PI * 2));
  const place = (k: number) => {
    const t = trees[k];
    const scale = (TREE_HEIGHT / GEOMETRY_HEIGHT) * t.size;
    if (t.fell === null) {
      dummy.position.set(t.x, t.y - 0.05, t.z);
      dummy.rotation.set(0, spin[k], 0);
    } else {
      // Lying along the ground, foot at the stump, top pointing the way it fell.
      dummy.position.set(t.x, t.y + 0.15, t.z);
      dummy.rotation.set(0, -t.fell, -Math.PI / 2 + 0.08, 'YXZ');
    }
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
  };
  trees.forEach((_, k) => {
    place(k);
    mesh.setColorAt(k, base.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.07, 0.03)));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.dispose = field.woods.onFell((k) => {
    place(k);
    // Fallen trees go darker, like dead wood.
    mesh.setColorAt(k, new THREE.Color(0xe8c49a));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return group;
}
