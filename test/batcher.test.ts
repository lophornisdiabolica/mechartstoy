import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Batcher } from '../src/render/batcher';
import { box, createModel, cylinder, modelKeys } from '../src/render/models';
import '../src/render/models/buildings';
import '../src/render/models/projectiles';
import '../src/render/models/units';

/** Sprite models need a canvas, which tests don't have. */
const SKIP = new Set(['trooper', 'atTrooper', 'mortar', 'flameTrooper', 'engineer', 'civilian:0', 'civilian:1', 'civilian:2', 'militia']);

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => (o as THREE.Mesh).isMesh && out.push(o as THREE.Mesh));
  return out;
}

describe('batcher', () => {
  it('draws a box of any size and colour as one scaled, coloured unit box', () => {
    const b = new Batcher();
    const a = box(2, 0.5, 1, 0xff0000, 3, 1, -2);
    const c = box(0.3, 0.3, 0.3, 0x00ff00);
    a.updateMatrixWorld();
    c.updateMatrixWorld();
    b.begin();
    b.addMesh(a);
    b.addMesh(c);
    b.end();
    expect(b.batches).toBe(1);
    const batch = b.root.children[0] as THREE.InstancedMesh;
    expect(batch.count).toBe(2);
    // The unit box's corner (0.5, 0.5, 0.5) lands on the original box's corner.
    const m = new THREE.Matrix4();
    batch.getMatrixAt(0, m);
    expect(new THREE.Vector3(0.5, 0.5, 0.5).applyMatrix4(m).toArray()).toEqual([4, 1.25, -1.5]);
    const color = new THREE.Color();
    batch.getColorAt(0, color);
    expect(color.equals((a.material as THREE.MeshStandardMaterial).color)).toBe(true);
  });

  it('draws every model with far fewer batches than meshes', () => {
    const b = new Batcher();
    const keys = modelKeys().filter((k) => !SKIP.has(k));
    let meshes = 0;
    b.begin();
    for (const key of keys) {
      for (const faction of [0, 1, 2]) {
        const model = createModel(key, faction);
        model.updateMatrixWorld(true);
        for (const m of meshesOf(model)) {
          b.addMesh(m);
          meshes++;
        }
      }
    }
    b.end();
    const drawn = b.root.children.reduce((n, c) => n + (c as THREE.InstancedMesh).count, 0);
    expect(drawn).toBe(meshes);
    expect(b.batches).toBeLessThan(meshes / 10);
  });

  it('keeps shadow casters and non-casters apart, and frees batches that stay empty', () => {
    const b = new Batcher();
    const lit = cylinder(0.2, 0.2, 1, 6, 0x888888);
    const unlit = cylinder(0.2, 0.2, 1, 6, 0x888888);
    lit.castShadow = true;
    lit.updateMatrixWorld();
    unlit.updateMatrixWorld();
    b.begin();
    b.addMesh(lit);
    b.addMesh(unlit);
    b.end();
    expect(b.batches).toBe(2);
    expect(b.root.children.map((c) => c.castShadow).sort()).toEqual([false, true]);
    for (let i = 0; i < 200; i++) {
      b.begin();
      b.end();
    }
    expect(b.root.children.length).toBe(0);
  });

  it('grows a batch past its first size', () => {
    const b = new Batcher();
    const parts = Array.from({ length: 100 }, (_, i) => box(1, 1, 1, 0x123456, i, 0, 0));
    for (const p of parts) p.updateMatrixWorld();
    b.begin();
    for (const p of parts) b.addMesh(p);
    b.end();
    const batch = b.root.children[0] as THREE.InstancedMesh;
    expect(batch.count).toBe(100);
    const m = new THREE.Matrix4();
    batch.getMatrixAt(99, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(99);
  });
});
