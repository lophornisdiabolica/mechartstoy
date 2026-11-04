import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { TREE_HEIGHT, Tree } from '../world/woods';
import { cactusGeometry, pineGeometry, treeGeometry } from './propsMesh';

/** Height of the tree geometries (pine and broadleaf both come out about this tall at scale 1). */
const GEOMETRY_HEIGHT = 1.4;
/** Height of the cactus geometry at scale 1. */
const CACTUS_HEIGHT = 1.2;

/** One drawn plant: which tree it belongs to, where it stands from the tree's foot, and its size against the tree's. */
interface Plant {
  tree: number;
  dx: number;
  dz: number;
  scale: number;
  spin: number;
}

/**
 * The dense forest's trees (see woods.ts), as one instanced mesh: bigger
 * and darker than the light woods' scenery. In the desert each tree is drawn
 * as a thick clump of extra-large cacti instead (looks only: the clump
 * stands, blocks and falls as the one tree it is). A tree that's knocked
 * down is laid on its side where it fell, pointing away from what felled it.
 * Stops listening when `dispose` (on the returned group's userData) is called.
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
  const desert = biome === 'desert';
  const geometry = desert ? cactusGeometry() : biome === 'snow' ? pineGeometry(true) : biome === 'forest' || biome === 'temperate' ? pineGeometry(false) : treeGeometry();
  const tint = desert ? 0x5f8a4a : biome === 'snow' || biome === 'forest' || biome === 'temperate' ? 0xc8d2c0 : 0x3f6a34;
  const heightAtScale1 = desert ? CACTUS_HEIGHT : GEOMETRY_HEIGHT;
  const slim = desert ? 0.7 : 1;
  const plants = desert ? cactusClumps(trees, rng) : trees.map((_, k) => ({ tree: k, dx: 0, dz: 0, scale: 1, spin: rng.range(0, Math.PI * 2) }));
  const byTree = trees.map(() => [] as number[]);
  plants.forEach((p, i) => byTree[p.tree].push(i));

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
  const dummy = new THREE.Object3D();
  const base = new THREE.Color(tint);
  // Fallen trees go darker, like dead wood; fallen cacti dry out to a pale khaki.
  const fallen = new THREE.Color(desert ? 0xa89a62 : 0xe8c49a);
  const place = (i: number) => {
    const p = plants[i];
    const t = trees[p.tree];
    const scale = (TREE_HEIGHT / heightAtScale1) * t.size * p.scale;
    if (t.fell === null) {
      const y = p.dx === 0 && p.dz === 0 ? t.y : field.heightAt(t.x + p.dx, t.z + p.dz);
      dummy.position.set(t.x + p.dx, y - 0.05, t.z + p.dz);
      dummy.rotation.set(0, p.spin, 0);
    } else {
      // Lying along the ground, foot at the stump, top pointing the way it fell.
      dummy.position.set(t.x + p.dx, t.y + 0.15, t.z + p.dz);
      dummy.rotation.set(0, -t.fell, -Math.PI / 2 + 0.08, 'YXZ');
    }
    // Big cacti grow tall rather than fat: scaled up evenly they'd be barrels.
    dummy.scale.set(scale * slim, scale, scale * slim);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };
  plants.forEach((_, i) => {
    place(i);
    mesh.setColorAt(i, base.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.07, 0.03)));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.userData.dispose = field.woods.onFell((k) => {
    for (const i of byTree[k]) {
      place(i);
      mesh.setColorAt(i, fallen);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return group;
}

/**
 * Each desert tree as a clump: one big cactus at the tree's foot, about a
 * third taller than the trees elsewhere, and two or three smaller ones
 * crowded round it.
 */
function cactusClumps(trees: Tree[], rng: Rng): Plant[] {
  const plants: Plant[] = [];
  trees.forEach((_, k) => {
    plants.push({ tree: k, dx: 0, dz: 0, scale: rng.range(1.2, 1.45), spin: rng.range(0, Math.PI * 2) });
    const extra = rng.int(2, 3);
    const turn = rng.range(0, Math.PI * 2);
    for (let n = 0; n < extra; n++) {
      const a = turn + (n / extra) * Math.PI * 2 + rng.range(-0.4, 0.4);
      const r = rng.range(0.35, 0.65);
      plants.push({ tree: k, dx: Math.cos(a) * r, dz: Math.sin(a) * r, scale: rng.range(0.55, 0.85), spin: rng.range(0, Math.PI * 2) });
    }
  });
  return plants;
}
