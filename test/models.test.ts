import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createModel, modelKeys } from '../src/render/models';
import '../src/render/models/buildings';
import '../src/render/models/god';
import '../src/render/models/projectiles';
import '../src/render/models/units';

/** Sprite models need a canvas, which tests don't have. */
const SKIP = new Set(['trooper', 'atTrooper', 'mortar', 'flameTrooper', 'cryoTrooper', 'droneOperator', 'engineer', 'civilian:0', 'civilian:1', 'civilian:2', 'militia']);
const EPS = 1e-4;

const AXES = ['x', 'y', 'z'] as const;

/** A triangle of a model in model space, with its plane. */
interface Tri {
  mesh: number;
  name: string;
  points: THREE.Vector3[];
  normal: THREE.Vector3;
  /** Distance of the plane from the origin along the normal. */
  d: number;
}

/**
 * Every triangle of every mesh in a model, in model space, whatever shape
 * it is or however it is turned. (An earlier version looked only at boxes
 * and upright cylinders, so it missed the Airstrip's hangar roof: a
 * cylinder on its side whose end caps sat flush with the hangar walls.)
 */
function triangles(root: THREE.Object3D): Tri[] {
  root.updateMatrixWorld(true);
  const out: Tri[] = [];
  let index = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const n = index++;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    const count = idx ? idx.count : pos.count;
    const at = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    const box = new THREE.Box3().setFromObject(mesh);
    const name = `${geo.type}@${box.min.toArray().map((v) => v.toFixed(2))}`;
    for (let i = 0; i + 2 < count; i += 3) {
      const points = [at(i), at(i + 1), at(i + 2)];
      const normal = new THREE.Vector3().subVectors(points[1], points[0]).cross(new THREE.Vector3().subVectors(points[2], points[0]));
      if (normal.length() < 1e-8) continue;
      normal.normalize();
      out.push({ mesh: n, name, points, normal, d: normal.dot(points[0]) });
    }
  });
  return out;
}

/** Area of the overlap of two convex polygons in 2D (Sutherland-Hodgman clipping). */
function overlapArea(a: THREE.Vector2[], b: THREE.Vector2[]): number {
  const signed = (p: THREE.Vector2[]) => p.reduce((s, v, i) => s + v.cross(p[(i + 1) % p.length]), 0) / 2;
  const ccw = (p: THREE.Vector2[]) => (signed(p) < 0 ? [...p].reverse() : p);
  let poly = ccw(a);
  const clip = ccw(b);
  for (let i = 0; i < clip.length && poly.length; i++) {
    const c0 = clip[i];
    const c1 = clip[(i + 1) % clip.length];
    const edge = new THREE.Vector2().subVectors(c1, c0);
    const side = (p: THREE.Vector2) => edge.cross(new THREE.Vector2().subVectors(p, c0));
    const next: THREE.Vector2[] = [];
    poly.forEach((p, j) => {
      const q = poly[(j + 1) % poly.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if (sp >= 0 !== sq >= 0) next.push(p.clone().lerp(q, sp / (sp - sq)));
    });
    poly = next;
  }
  return poly.length < 3 ? 0 : Math.abs(signed(poly));
}

/**
 * Faces of two parts that lie in the same plane, point the same way and
 * overlap: the renderer can't tell which is in front, so they flicker.
 */
function coplanarFaces(model: THREE.Object3D): string[] {
  const tris = triangles(model);
  // Bucket by plane so only triangles that could be coplanar get compared.
  const buckets = new Map<string, Tri[]>();
  for (const t of tris) {
    // Faces pointing straight down face the ground, away from the camera, so they never show.
    if (t.normal.y < -1 + EPS) continue;
    // Normals only (not distances), so rounding can't split a coplanar pair into two buckets.
    const key = [t.normal.x, t.normal.y, t.normal.z].map((v) => Math.round(v * 100)).join(',');
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(t);
  }
  const found = new Set<string>();
  for (const list of buckets.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.mesh === b.mesh || a.normal.dot(b.normal) < 1 - EPS || Math.abs(a.d - b.d) > EPS) continue;
        // Flatten onto the plane by dropping the normal's biggest axis.
        const n = a.normal;
        const drop = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? 0 : 2) : Math.abs(n.y) > Math.abs(n.z) ? 1 : 2;
        const flat = (t: Tri) => t.points.map((p) => {
          const v = p.toArray().filter((_, k) => k !== drop);
          return new THREE.Vector2(v[0], v[1]);
        });
        if (overlapArea(flat(a), flat(b)) > 1e-5) {
          const facing = AXES[drop];
          found.add(`${a.name} and ${b.name} share a face (facing ${n.toArray().map((v) => v.toFixed(2))}, mostly ${facing})`);
        }
      }
    }
  }
  return [...found];
}

describe('models', () => {
  it('have no coplanar overlapping faces (z-fighting)', () => {
    const problems: string[] = [];
    for (const key of modelKeys()) {
      if (SKIP.has(key)) continue;
      // Some models are randomised, so build each a few times for both factions and civilians.
      for (let n = 0; n < 6; n++) {
        for (const faction of [-1, 0, 1]) {
          for (const p of coplanarFaces(createModel(key, faction))) problems.push(`${key}: ${p}`);
        }
      }
    }
    expect([...new Set(problems)]).toEqual([]);
  });
});
