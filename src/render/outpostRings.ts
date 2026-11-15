import * as THREE from 'three';
import { Game } from '../game/game';
import { CAPTURE_RADIUS } from '../game/outposts';
import { Battlefield } from '../world/battlefield';
import { factionColors } from './models';
import { meshHeightAt } from './terrainMesh';

const SEGMENTS = 64;
const WIDTH = 0.45;

/** Bucket size for RoadTops' triangles. */
const BUCKET = 1;

/**
 * The tops of the road strips round one outpost, for looking up the height a
 * road is drawn at. It used to cast a ray down onto every road mesh for each
 * of a ring's ~1,200 samples, but a city has hundreds of roads and its long
 * avenues pass every bounding check, so one ring took seconds to rebuild
 * (and a Legion trench near an outpost rebuilds it). This keeps only the
 * triangles near the outpost, bucketed on the ground plane.
 */
export class RoadTops {
  private readonly tris: number[] = [];
  private readonly buckets = new Map<number, number[]>();

  constructor(surfaces: THREE.Object3D[], x: number, z: number, reach: number) {
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (const root of surfaces) {
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const pos = mesh.isMesh ? (mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
        if (!pos) return;
        const index = mesh.geometry.getIndex();
        const count = index ? index.count : pos.count;
        for (let t = 0; t + 2 < count; t += 3) {
          for (let c = 0; c < 3; c++) v[c].fromBufferAttribute(pos, index ? index.getX(t + c) : t + c).applyMatrix4(mesh.matrixWorld);
          const x0 = Math.min(v[0].x, v[1].x, v[2].x);
          const x1 = Math.max(v[0].x, v[1].x, v[2].x);
          const z0 = Math.min(v[0].z, v[1].z, v[2].z);
          const z1 = Math.max(v[0].z, v[1].z, v[2].z);
          if (x1 < x - reach || x0 > x + reach || z1 < z - reach || z0 > z + reach) continue;
          const k = this.tris.length;
          for (const p of v) this.tris.push(p.x, p.y, p.z);
          for (let bj = Math.floor(z0 / BUCKET); bj <= Math.floor(z1 / BUCKET); bj++) {
            for (let bi = Math.floor(x0 / BUCKET); bi <= Math.floor(x1 / BUCKET); bi++) {
              const key = bj * 100003 + bi;
              let list = this.buckets.get(key);
              if (!list) this.buckets.set(key, (list = []));
              list.push(k);
            }
          }
        }
      });
    }
  }

  /** The highest road top drawn straight above or below (x, z), or -Infinity where there's none. */
  at(x: number, z: number): number {
    const list = this.buckets.get(Math.floor(z / BUCKET) * 100003 + Math.floor(x / BUCKET));
    let best = -Infinity;
    if (!list) return best;
    const t = this.tris;
    for (const k of list) {
      const ax = t[k], ay = t[k + 1], az = t[k + 2];
      const bx = t[k + 3], by = t[k + 4], bz = t[k + 5];
      const cx = t[k + 6], cy = t[k + 7], cz = t[k + 8];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      best = Math.max(best, l1 * ay + l2 * by + l3 * cy);
    }
    return best;
  }
}

/**
 * The height of whatever is drawn at (x, z): the ground (or water) or a road on it,
 * whichever is higher. Roads stand up to a few tenths above the ground and
 * the ground mesh's triangles don't quite follow surfaceAt, so a ring at a
 * fixed height over surfaceAt dipped in and out of them and flickered.
 */
function drawnHeight(field: Battlefield, roads: RoadTops, x: number, z: number): number {
  return Math.max(meshHeightAt(field, x, z), field.surfaceAt(x, z), roads.at(x, z));
}

/**
 * A flat ring round (x, z) that sits over the ground and roads, built as one
 * quad per segment so a draw range can show part of it. Each corner takes the
 * highest point from it to halfway to its neighbours, so the straight edges
 * between corners don't cut through a bump or a road's crown.
 */
function groundRing(field: Battlefield, surfaces: THREE.Object3D[], x: number, z: number, radius: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const roads = new RoadTops(surfaces, x, z, radius + WIDTH);
  const at = (a: number, r: number) => drawnHeight(field, roads, x + Math.cos(a) * r, z + Math.sin(a) * r);
  const step = (Math.PI * 2) / SEGMENTS;
  for (let i = 0; i <= SEGMENTS; i++) {
    // Clockwise from the top, as seen from above, like a clock filling up.
    const a = -Math.PI / 2 + i * step;
    for (const r of [radius - WIDTH, radius]) {
      let y = -Infinity;
      for (const da of [-step / 2, 0, step / 2]) for (const dr of [-WIDTH / 2, 0, WIDTH / 2]) y = Math.max(y, at(a + da, r + dr));
      pos.push(x + Math.cos(a) * r, y + lift, z + Math.sin(a) * r);
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const k = i * 2;
    index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/**
 * The capture ring round each outpost: a faint ring in the holder's colour,
 * and an arc in the capturing side's colour that fills as they take it.
 * Purely visual.
 */
export class OutpostRings {
  readonly root = new THREE.Group();
  private readonly rings: { owner: THREE.Mesh; progress: THREE.Mesh; shown: { owner: number; claimant: number } }[];

  private readonly stop: () => void;

  /** `terrain` is the drawn ground and roads (see buildTerrain), whose roads the rings sit on. */
  constructor(private readonly game: Game, terrain: THREE.Object3D) {
    this.root.name = 'outpost-rings';
    const roads = terrain.getObjectByName('roads');
    const surfaces = roads ? [roads] : [];
    const ownerRing = (o: { x: number; z: number }) => groundRing(game.field, surfaces, o.x, o.z, CAPTURE_RADIUS, 0.08);
    const progressRing = (o: { x: number; z: number }) => groundRing(game.field, surfaces, o.x, o.z, CAPTURE_RADIUS + WIDTH * 1.2, 0.1);
    this.rings = game.ctx.outposts.map((o) => {
      // Pulled toward the camera a little too, like the roads, for what's left of a near tie.
      const material = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      const owner = new THREE.Mesh(ownerRing(o), material());
      (owner.material as THREE.MeshBasicMaterial).opacity = 0.45;
      const progress = new THREE.Mesh(progressRing(o), material());
      (progress.material as THREE.MeshBasicMaterial).opacity = 0.9;
      for (const m of [owner, progress]) {
        m.renderOrder = 2;
        m.userData.noShadow = true;
        this.root.add(m);
      }
      return { owner, progress, shown: { owner: NaN, claimant: NaN } };
    });
    // Craters and god powers move the ground and the roads on it, so rings near a change are rebuilt to sit on the new surface.
    // (The terrain listens first, so its roads are already redrawn by now.)
    this.stop = game.field.onChange((area) => {
      const reach = CAPTURE_RADIUS + WIDTH * 3;
      game.ctx.outposts.forEach((o, i) => {
        const [i0, j0] = game.field.cellAt(o.x - reach, o.z - reach);
        const [i1, j1] = game.field.cellAt(o.x + reach, o.z + reach);
        if (area.i1 < i0 || area.i0 > i1 || area.j1 < j0 || area.j0 > j1) return;
        const ring = this.rings[i];
        const range = ring.progress.geometry.drawRange.count;
        ring.owner.geometry.dispose();
        ring.owner.geometry = ownerRing(o);
        ring.progress.geometry.dispose();
        ring.progress.geometry = progressRing(o);
        ring.progress.geometry.setDrawRange(0, range);
      });
    });
  }

  dispose(): void {
    this.stop();
  }

  update(): void {
    this.game.ctx.outposts.forEach((o, i) => {
      const ring = this.rings[i];
      if (ring.shown.owner !== o.owner) {
        (ring.owner.material as THREE.MeshBasicMaterial).color.setHex(factionColors(o.owner).primary);
        ring.shown.owner = o.owner;
      }
      if (o.claimant >= 0 && ring.shown.claimant !== o.claimant) {
        (ring.progress.material as THREE.MeshBasicMaterial).color.setHex(factionColors(o.claimant).primary);
        ring.shown.claimant = o.claimant;
      }
      ring.progress.visible = o.progress > 0 && o.claimant >= 0;
      ring.progress.geometry.setDrawRange(0, Math.ceil(o.progress * SEGMENTS) * 6);
    });
  }
}
