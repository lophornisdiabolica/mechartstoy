import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createModel, modelKeys } from '../src/render/models';
import '../src/render/models/buildings';
import '../src/render/models/projectiles';
import '../src/render/models/units';

/** Sprite models need a canvas, which tests don't have. */
const SKIP = new Set(['trooper']);
const EPS = 1e-4;

interface Part {
  name: string;
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Which axes have flat faces on both sides (boxes: all; cylinders: y only). */
  flat: boolean[];
}

/** Axis-aligned bounds of each box and cylinder in a model, in model space. Rotated parts are skipped. */
function parts(root: THREE.Object3D): Part[] {
  root.updateMatrixWorld(true);
  const out: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const type = mesh.geometry.type;
    if (type !== 'BoxGeometry' && type !== 'CylinderGeometry') return;
    // Only axis-aligned parts: every basis vector must map onto an axis.
    const e = mesh.matrixWorld.elements;
    const columns = [e.slice(0, 3), e.slice(4, 7), e.slice(8, 11)];
    if (!columns.every((c) => c.filter((v) => Math.abs(v) > EPS).length === 1)) return;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    // A cylinder's caps are flat only if it stands upright.
    const upright = Math.abs(e[5]) > EPS;
    const flat = type === 'BoxGeometry' ? [true, true, true] : [false, upright, false];
    out.push({ name: `${type}@${box.min.toArray().map((v) => v.toFixed(2))}`, min: box.min, max: box.max, flat });
  });
  return out;
}

const AXES = ['x', 'y', 'z'] as const;

/**
 * Faces of two parts that lie in the same plane, point the same way and
 * overlap: the renderer can't tell which is in front, so they flicker.
 */
function coplanarFaces(model: THREE.Object3D): string[] {
  const list = parts(model);
  const found: string[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      AXES.forEach((axis, k) => {
        if (!a.flat[k] || !b.flat[k]) return;
        const others = AXES.filter((_, n) => n !== k);
        // The face rectangles must overlap with real area.
        const overlap = others.every((o) => Math.min(a.max[o], b.max[o]) - Math.max(a.min[o], b.min[o]) > EPS);
        if (!overlap) return;
        for (const side of ['min', 'max'] as const) {
          // Shared bottoms face the ground, away from the camera, so they never show.
          if (axis === 'y' && side === 'min') continue;
          if (Math.abs(a[side][axis] - b[side][axis]) < EPS) found.push(`${a.name} and ${b.name} share their ${side} ${axis} face`);
        }
      });
    }
  }
  return found;
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
