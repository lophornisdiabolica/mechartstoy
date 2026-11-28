import * as THREE from 'three';
import { BIOMES } from '../world/biomes';
import { markRange } from './upload';
import { Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { groundCode } from '../world/ground';
import { TREE_HEIGHT } from '../world/woods';
import { cactusGeometry, Detail, jungleTreeGeometry, monolithGeometry, pineGeometry, treeGeometry } from './propsMesh';
import { PlantMesh, PlantShapes } from './plantLod';

/** Height of the tree geometries (pine and broadleaf both come out about this tall at scale 1). */
const GEOMETRY_HEIGHT = 1.4;
/** How far a fallen trunk sinks into the ground once it's well trodden, at size 1. */
const SINK_DEPTH = 0.35;
/** Height of the cactus geometry at scale 1. */
const CACTUS_HEIGHT = 1.2;
/** The forest is drawn in squares this wide, so the squares off screen (or out of the shadow's reach) are skipped. */
const TILE = 32;
/** How far a tree in a square can reach past where the square's trees stood when its bounds were worked out (one falling over). */
const TILE_SLACK = 4;

/** One drawn plant: which tree it belongs to, where it stands from the tree's foot, and its size against the tree's. */
interface Plant {
  tree: number;
  dx: number;
  dz: number;
  scale: number;
  spin: number;
  /** Drawn this much bigger or smaller than the tree is, so a canopy isn't all one height (looks only). */
  grow?: number;
}

/** How much the forest's trees vary in drawn size, either way: a jungle canopy most, so it doesn't read as one flat roof. */
const GROW_VARY = 0.12;
const JUNGLE_GROW = [0.72, 1.32] as const;
/** Jungle trees are tinted part way toward one of these (sunlit yellow-green, deep shade, fresh lime), so the canopy's patchy. */
const JUNGLE_TINTS = [0xfff09a, 0x7a9a80, 0xd8ff90, 0xa8b870, 0xd2dcc8];

/**
 * The dense forest's trees (see woods.ts), as one instanced mesh: bigger
 * and darker than the light woods' scenery. In the desert each tree is drawn
 * as a thick clump of extra-large cacti instead (looks only: the clump
 * stands, blocks and falls as the one tree it is). A tree that's knocked
 * down is laid on its side where it fell, pointing away from what felled it.
 * The forest is split into squares (see TILE) and drawn with simpler shapes
 * when zoomed out and in the shadow map (see PlantMesh): call
 * `userData.setFar` each frame. Stops listening when `dispose` (on the
 * returned group's userData) is called.
 */
export function buildWoods(field: Battlefield, rng: Rng): THREE.Group {
  const group = new THREE.Group();
  group.name = 'woods';
  const trees = field.woods.trees;
  const woods = BIOMES[field.config.biome].woods;
  const desert = woods.plant === 'cactus';
  const shape = (d: Detail) => {
    switch (woods.plant) {
      case 'cactus':
        return cactusGeometry(d);
      case 'snowPine':
        return pineGeometry(true, d);
      case 'pine':
        return pineGeometry(false, d);
      case 'jungle':
        return jungleTreeGeometry(d);
      case 'monolith':
        return monolithGeometry(d);
      default:
        return treeGeometry(d);
    }
  };
  const shapes: PlantShapes = { near: shape('near'), far: shape('far'), shadow: shape('shadow') };
  /** Every square's mesh, for setFar. */
  const meshes: PlantMesh[] = [];
  let far = false;
  const tint = woods.tint;
  const heightAtScale1 = desert ? CACTUS_HEIGHT : GEOMETRY_HEIGHT;
  const slim = desert ? 0.7 : 1;
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const dummy = new THREE.Object3D();
  const base = new THREE.Color(tint);
  // Fallen trees go darker, like dead wood; fallen cacti dry out to a pale khaki; toppled crystal dulls.
  const fallen = woods.plant === 'monolith' ? base.clone().multiplyScalar(0.6) : new THREE.Color(desert ? 0xa89a62 : 0xe8c49a);
  // Trees a wildfire brought down lie charred on the burnt ground (see game/wildfire.ts).
  const charred = new THREE.Color(0x2e2925);
  const burnt = groundCode('burnt');
  const downColour = (k: number) => {
    const [i, j] = field.cellAt(trees[k].x, trees[k].z);
    return field.ground[j * field.config.cols + i] === burnt ? charred : fallen;
  };
  const jungle = woods.plant === 'jungle';
  const jungleTints = JUNGLE_TINTS.map((c) => new THREE.Color(c));
  /** A standing tree's colour: the biome's, a little lighter or darker, and in the jungle a good deal more mixed. */
  const standing = () => {
    if (!jungle) return base.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.07, 0.03));
    const toward = jungleTints[Math.floor(rng.range(0, jungleTints.length)) % jungleTints.length];
    return base.clone().lerp(toward, rng.range(0.4, 1)).offsetHSL(rng.range(-0.03, 0.03), 0, rng.range(-0.14, 0.05));
  };
  /** Per tree: the mesh its plants are in, and their instances there. */
  const drawn = new Map<number, { mesh: THREE.InstancedMesh; plants: Plant[]; instances: number[] }>();
  const { minX, minZ } = field.bounds;
  const tileOf = (k: number) => Math.floor((trees[k].z - minZ) / TILE) * 1000 + Math.floor((trees[k].x - minX) / TILE);

  const place = (mesh: THREE.InstancedMesh, p: Plant, i: number) => {
    const t = trees[p.tree];
    const scale = (TREE_HEIGHT / heightAtScale1) * t.size * p.scale * (p.grow ?? 1);
    // On the ground as it is now (a god power may have moved it since the tree was planted).
    const foot = field.heightAt(t.x, t.z);
    if (t.fell === null) {
      const y = p.dx === 0 && p.dz === 0 ? foot : field.heightAt(t.x + p.dx, t.z + p.dz);
      dummy.position.set(t.x + p.dx, y - 0.05, t.z + p.dz);
      dummy.rotation.set(0, p.spin, 0);
    } else {
      // Lying along the ground, foot at the stump, top pointing the way it fell, pressed
      // further into the ground the more it's been driven over (see Woods.trample).
      // Laid along the slope: tipped up or down to meet the ground where its top lies.
      const reach = heightAtScale1 * scale * 0.8;
      const tip = field.heightAt(t.x + p.dx + Math.cos(t.fell) * reach, t.z + p.dz + Math.sin(t.fell) * reach);
      const pitch = Math.atan2(tip - foot, reach);
      dummy.position.set(t.x + p.dx, foot + 0.15 - t.sunk * SINK_DEPTH * t.size, t.z + p.dz);
      dummy.rotation.set(0, -t.fell, -Math.PI / 2 + 0.06 + pitch - t.sunk * 0.04, 'YXZ');
    }
    // Trodden down, a fallen forest keeps its trunks, pressed part way into the ground and a
    // little flatter, so it still reads as a forest that was knocked flat. Every third trunk (and
    // a desert clump's smaller cacti) wears away, so the rest read as fallen trees, not a pile.
    const gone = t.fell !== null && ((p.tree % 3 === 0 && t.sunk >= 0.6) || (p.scale < 1 && t.sunk >= 0.5));
    if (gone) dummy.scale.set(0, 0, 0);
    // Big cacti grow tall rather than fat: scaled up evenly they'd be barrels.
    else if (t.fell === null) dummy.scale.set(scale * slim, scale, scale * slim);
    // Lying down, its height runs along the ground and its girth stands up.
    else dummy.scale.set(scale * slim * (1 - t.sunk * 0.35), scale * (1 - t.sunk * 0.12), scale * slim * (1 - t.sunk * 0.2));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  /** Draw some trees as more instanced meshes, a square at a time (all of them at first; then each batch planted mid-battle). */
  const addChunk = (indices: number[]) => {
    const tiles = new Map<number, number[]>();
    for (const k of indices) {
      const key = tileOf(k);
      let list = tiles.get(key);
      if (!list) tiles.set(key, (list = []));
      list.push(k);
    }
    for (const list of tiles.values()) addTile(list);
  };
  const addTile = (indices: number[]) => {
    if (indices.length === 0) return;
    const plants = desert
      ? cactusClumps(indices, rng)
      : indices.map((k) => ({ tree: k, dx: 0, dz: 0, scale: 1, spin: rng.range(0, Math.PI * 2), grow: jungle ? rng.range(JUNGLE_GROW[0], JUNGLE_GROW[1]) : rng.range(1 - GROW_VARY, 1 + GROW_VARY) }));
    const lod = new PlantMesh(shapes, material, plants.length);
    lod.setFar(far);
    const mesh = lod.mesh;
    plants.forEach((p, i) => {
      place(mesh, p, i);
      mesh.setColorAt(i, trees[p.tree].fell === null ? standing() : downColour(p.tree));
      let entry = drawn.get(p.tree);
      if (!entry) drawn.set(p.tree, (entry = { mesh, plants: [], instances: [] }));
      entry.plants.push(p);
      entry.instances.push(i);
    });
    // Its bounds are worked out once; trees planted later live in meshes of their own.
    lod.computeBounds(TILE_SLACK);
    meshes.push(lod);
    group.add(...lod.objects);
  };
  const redraw = (k: number, colour: boolean) => {
    const entry = drawn.get(k);
    if (!entry) return;
    // Just this tree's instances go up to the GPU, not the whole forest's.
    entry.plants.forEach((p, n) => {
      const i = entry.instances[n];
      place(entry.mesh, p, i);
      markRange(entry.mesh.instanceMatrix, i * 16, 16);
      if (colour && entry.mesh.instanceColor) {
        entry.mesh.setColorAt(i, downColour(k));
        markRange(entry.mesh.instanceColor, i * 3, 3);
      }
    });
  };
  addChunk(trees.map((_, k) => k));

  const stopFell = field.woods.onFell((k) => redraw(k, true));
  const stopTrod = field.woods.onTrod((k) => redraw(k, false));
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
  group.userData.setFar = (on: boolean) => {
    if (on === far) return;
    far = on;
    for (const m of meshes) m.setFar(on);
  };
  group.userData.dispose = () => {
    stopFell();
    stopTrod();
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
