import * as THREE from 'three';

/** Bucket size on the ground plane, in world units. */
const BUCKET = 1;
/** Rows of buckets apart in a key (more than any map is wide, in buckets). */
const ROW = 100003;

/**
 * How high the drawn roads stand at any point (see terrainMesh buildRoad).
 * Road strips are lifted over bumps in the ground and banked up on slopes,
 * so on a hump they can stand well over the sim's ground height: units are
 * drawn standing on them (see EntityView), and outpost rings lie over them.
 * The roads' triangles are bucketed on the ground plane, by road, so a road
 * redrawn after the ground moves is swapped in alone.
 */
export class RoadTops {
  /** Each road's triangles, as 9 numbers each (three corners' x, y, z). */
  private readonly tris = new Map<number, Float32Array>();
  /** Per bucket: pairs of (road id, triangle offset). */
  private readonly buckets = new Map<number, number[]>();
  /** Per road: the buckets it's in. */
  private readonly keys = new Map<number, number[]>();

  /**
   * Index a road's meshes under `id` (replacing any it had). Only triangles
   * within `near` of a point (x0..x1, z0..z1) are kept, if given.
   */
  add(id: number, root: THREE.Object3D, near?: { x0: number; z0: number; x1: number; z1: number }): void {
    this.remove(id);
    const out: number[] = [];
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const pos = mesh.isMesh ? (mesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined) : undefined;
      if (!pos) return;
      const index = mesh.geometry.getIndex();
      const count = index ? index.count : pos.count;
      for (let t = 0; t + 2 < count; t += 3) {
        for (let c = 0; c < 3; c++) v[c].fromBufferAttribute(pos, index ? index.getX(t + c) : t + c).applyMatrix4(mesh.matrixWorld);
        if (near) {
          if (Math.max(v[0].x, v[1].x, v[2].x) < near.x0 || Math.min(v[0].x, v[1].x, v[2].x) > near.x1) continue;
          if (Math.max(v[0].z, v[1].z, v[2].z) < near.z0 || Math.min(v[0].z, v[1].z, v[2].z) > near.z1) continue;
        }
        for (const p of v) out.push(p.x, p.y, p.z);
      }
    });
    this.index(id, out);
  }

  /** Index a road's triangles under `id` (replacing any it had), given as lists of corners (x, y, z, three to a triangle). */
  addTriangles(id: number, positions: ArrayLike<number>[]): void {
    this.remove(id);
    const out: number[] = [];
    for (const list of positions) for (let k = 0; k < list.length; k++) out.push(list[k]);
    this.index(id, out);
  }

  private index(id: number, out: number[]): void {
    if (out.length === 0) return;
    const tris = Float32Array.from(out);
    this.tris.set(id, tris);
    const keys: number[] = [];
    for (let k = 0; k < tris.length; k += 9) {
      const i0 = Math.floor(Math.min(tris[k], tris[k + 3], tris[k + 6]) / BUCKET);
      const i1 = Math.floor(Math.max(tris[k], tris[k + 3], tris[k + 6]) / BUCKET);
      const j0 = Math.floor(Math.min(tris[k + 2], tris[k + 5], tris[k + 8]) / BUCKET);
      const j1 = Math.floor(Math.max(tris[k + 2], tris[k + 5], tris[k + 8]) / BUCKET);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const key = j * ROW + i;
          let list = this.buckets.get(key);
          if (!list) this.buckets.set(key, (list = []));
          if (list.length === 0 || list[list.length - 2] !== id) keys.push(key);
          list.push(id, k);
        }
      }
    }
    this.keys.set(id, keys);
  }

  /** Forget a road. */
  remove(id: number): void {
    const keys = this.keys.get(id);
    if (!keys) return;
    for (const key of keys) {
      const list = this.buckets.get(key);
      if (!list) continue;
      let n = 0;
      for (let q = 0; q < list.length; q += 2) {
        if (list[q] === id) continue;
        list[n++] = list[q];
        list[n++] = list[q + 1];
      }
      list.length = n;
      if (n === 0) this.buckets.delete(key);
    }
    this.keys.delete(id);
    this.tris.delete(id);
  }

  /** The highest road top drawn straight above or below (x, z), or -Infinity where there's none. */
  at(x: number, z: number): number {
    const list = this.buckets.get(Math.floor(z / BUCKET) * ROW + Math.floor(x / BUCKET));
    let best = -Infinity;
    if (!list) return best;
    for (let q = 0; q < list.length; q += 2) {
      const t = this.tris.get(list[q])!;
      const k = list[q + 1];
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
