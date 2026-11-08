import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { TREE_HEIGHT } from '../world/woods';
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
  const biome = field.config.biome;
  const desert = biome === 'desert';
  const geometry = desert ? cactusGeometry() : biome === 'snow' ? pineGeometry(true) : biome === 'forest' || biome === 'temperate' ? pineGeometry(false) : treeGeometry();
  const tint = desert ? 0x5f8a4a : biome === 'snow' || biome === 'forest' || biome === 'temperate' ? 0xc8d2c0 : 0x3f6a34;
  const heightAtScale1 = desert ? CACTUS_HEIGHT : GEOMETRY_HEIGHT;
  const slim = desert ? 0.7 : 1;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const dummy = new THREE.Object3D();
  const base = new THREE.Color(tint);
  // Fallen trees go darker, like dead wood; fallen cacti dry out to a pale khaki.
  const fallen = new THREE.Color(desert ? 0xa89a62 : 0xe8c49a);
  /** Per tree: the mesh its plants are in, and their instances there. */
  const drawn = new Map<number, { mesh: THREE.InstancedMesh; plants: Plant[]; instances: number[] }>();

  const place = (mesh: THREE.InstancedMesh, p: Plant, i: number) => {
    const t = trees[p.tree];
    const scale = (TREE_HEIGHT / heightAtScale1) * t.size * p.scale;
    // On the ground as it is now (a god power may have moved it since the tree was planted).
    const foot = field.heightAt(t.x, t.z);
    if (t.fell === null) {
      const y = p.dx === 0 && p.dz === 0 ? foot : field.heightAt(t.x + p.dx, t.z + p.dz);
      dummy.position.set(t.x + p.dx, y - 0.05, t.z + p.dz);
      dummy.rotation.set(0, p.spin, 0);
    } else {
      // Lying along the ground, foot at the stump, top pointing the way it fell.
      dummy.position.set(t.x + p.dx, foot + 0.15, t.z + p.dz);
      dummy.rotation.set(0, -t.fell, -Math.PI / 2 + 0.08, 'YXZ');
    }
    // Big cacti grow tall rather than fat: scaled up evenly they'd be barrels.
    dummy.scale.set(scale * slim, scale, scale * slim);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  /** Draw some trees as one more instanced mesh (all of them at first; then each batch planted mid-battle). */
  const addChunk = (indices: number[]) => {
    if (indices.length === 0) return;
    const plants = desert ? cactusClumps(indices, rng) : indices.map((k) => ({ tree: k, dx: 0, dz: 0, scale: 1, spin: rng.range(0, Math.PI * 2) }));
    const mesh = new THREE.InstancedMesh(geometry, material, plants.length);
    plants.forEach((p, i) => {
      place(mesh, p, i);
      mesh.setColorAt(i, trees[p.tree].fell === null ? base.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.07, 0.03)) : fallen);
      let entry = drawn.get(p.tree);
      if (!entry) drawn.set(p.tree, (entry = { mesh, plants: [], instances: [] }));
      entry.plants.push(p);
      entry.instances.push(i);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Its bounds are worked out once; trees planted later live in meshes of their own.
    mesh.computeBoundingSphere();
    group.add(mesh);
  };
  const redraw = (k: number, colour: boolean) => {
    const entry = drawn.get(k);
    if (!entry) return;
    entry.plants.forEach((p, n) => {
      place(entry.mesh, p, entry.instances[n]);
      if (colour) entry.mesh.setColorAt(entry.instances[n], fallen);
    });
    entry.mesh.instanceMatrix.needsUpdate = true;
    if (colour && entry.mesh.instanceColor) entry.mesh.instanceColor.needsUpdate = true;
  };
  addChunk(trees.map((_, k) => k));

  const stopFell = field.woods.onFell((k) => redraw(k, true));
  // Planted trees come a batch at a time (one brush dab), drawn together once the dab is done.
  let planted: number[] = [];
  const stopGrow = field.woods.onGrow((k) => {
    if (planted.length === 0) queueMicrotask(() => {
      addChunk(planted);
      planted = [];
    });
    planted.push(k);
  });
  // Ground that moves (quakes, the land brush, craters) takes its trees with it.
  const { cellSize } = field.config;
  const stopMoves = field.onChange((area) => {
    for (let j = area.j0; j <= area.j1; j++) {
      for (let i = area.i0; i <= area.i1; i++) {
        const x = field.bounds.minX + (i + 0.5) * cellSize;
        const z = field.bounds.minZ + (j + 0.5) * cellSize;
        for (const k of field.woods.treesNear(x, z)) redraw(k, false);
      }
    }
  });
  group.userData.dispose = () => {
    stopFell();
    stopGrow();
    stopMoves();
  };
  return group;
}

/**
 * Each desert tree as a clump: one big cactus at the tree's foot, about a
 * third taller than the trees elsewhere, and two or three smaller ones
 * crowded round it.
 */
function cactusClumps(trees: number[], rng: Rng): Plant[] {
  const plants: Plant[] = [];
  trees.forEach((k) => {
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
