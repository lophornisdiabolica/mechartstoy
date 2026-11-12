import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createModel, getRig, modelKeys } from '../src/render/models';
import '../src/render/models/buildings';
import '../src/render/models/projectiles';
import '../src/render/models/units';
import { breakModel, stepCollapse } from '../src/render/wrecks';

/** Unit models that leave wrecks (sprites need a canvas, which tests don't have). */
const UNITS = ['strider', 'titan', 'tank', 'howitzer', 'lancer', 'mgTruck', 'buggy', 'rocketTruck', 'landTrain', 'lightTank', 'carrier', 'siegeCrawler', 'flakTank', 'scout', 'gunship', 'bomber', 'jet', 'drone', 'flakWalker', 'airship', 'railgun', 'fortress', 'spider', 'siegeSpider', 'warhound', 'juggernaut', 'skimmer', 'missileBoat', 'amphib', 'hoverFortress', 'dreadnought', 'scorchBuggy', 'cinderWalker', 'inferno'];

/** Lowest point of a model's visible meshes, in its own space. */
function lowest(obj: THREE.Object3D): number {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  obj.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noShadow) return;
    m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  });
  return box.min.y;
}

/** A broken model, fallen all the way into its pose. */
function wreck(key: string, seed: number): THREE.Object3D {
  const obj = createModel(key, 0);
  const c = breakModel(obj, seed);
  stepCollapse(obj, c, 999);
  obj.updateMatrixWorld(true);
  return obj;
}

describe('wrecks', () => {
  it('covers every unit model', () => {
    for (const key of UNITS) expect(modelKeys()).toContain(key);
  });

  it('breaks every unit model and lets it come to rest', () => {
    for (const key of UNITS) {
      for (let seed = 0; seed < 12; seed++) {
        const obj = createModel(key, 0);
        const c = breakModel(obj, seed);
        expect(c.duration).toBeGreaterThan(0);
        expect(stepCollapse(obj, c, c.duration / 2)).toBe(true);
        expect(stepCollapse(obj, c, c.duration)).toBe(false);
      }
    }
  });

  it('breaks the same vehicle the same way every time', () => {
    const pose = (o: THREE.Object3D) => {
      const out: number[] = [];
      o.traverse((p) => out.push(...p.position.toArray(), ...p.quaternion.toArray(), p.visible ? 1 : 0));
      return out;
    };
    expect(pose(wreck('titan', 5))).toEqual(pose(wreck('titan', 5)));
  });

  it('gives walkers a few different ways to fall', () => {
    for (const key of ['strider', 'titan', 'juggernaut', 'inferno', 'warhound']) {
      // How low the body ends up and which way it's turned over.
      const poses = new Set<string>();
      for (let seed = 0; seed < 12; seed++) {
        const body = wreck(key, seed).children[0];
        poses.add([body.position.y * 10, body.quaternion.x * 4, body.quaternion.z * 4].map(Math.round).join());
      }
      expect(poses.size, key).toBeGreaterThan(3);
    }
  });

  it('brings walkers down onto the ground, not floating or buried', () => {
    for (const key of UNITS.filter((k) => getRig(createModel(k, 0))?.wreck)) {
      for (let seed = 0; seed < 12; seed++) {
        const obj = wreck(key, seed);
        expect(lowest(obj), `${key} #${seed}`).toBeCloseTo(-0.04, 2);
        // And well below standing height.
        const standing = createModel(key, 0).children[0].position.y;
        expect(obj.children[0].position.y, `${key} #${seed}`).toBeLessThan(standing * 0.9);
      }
    }
  });

  it('lets fallen walkers come to rest instead of balancing on a foot', () => {
    for (const key of UNITS.filter((k) => getRig(createModel(k, 0))?.wreck)) {
      for (let seed = 0; seed < 12; seed++) {
        const obj = wreck(key, seed);
        // Its weight (bulky parts count most) must be over what it rests on.
        const touching: THREE.Vector3[] = [];
        const weight = new THREE.Vector3();
        let mass = 0;
        obj.traverseVisible((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || m.userData.noShadow) return;
          m.geometry.computeBoundingBox();
          const b = m.geometry.boundingBox!;
          for (let i = 0; i < 8; i++) {
            const p = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld);
            if (p.y < 0.1) touching.push(p);
          }
          const size = b.getSize(new THREE.Vector3());
          const v = size.x * size.y * size.z;
          weight.addScaledVector(b.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld), v);
          mass += v;
        });
        weight.divideScalar(mass);
        const xs = touching.map((p) => p.x);
        const zs = touching.map((p) => p.z);
        const slack = 0.15;
        expect(weight.x, `${key} #${seed}`).toBeGreaterThan(Math.min(...xs) - slack);
        expect(weight.x, `${key} #${seed}`).toBeLessThan(Math.max(...xs) + slack);
        expect(weight.z, `${key} #${seed}`).toBeGreaterThan(Math.min(...zs) - slack);
        expect(weight.z, `${key} #${seed}`).toBeLessThan(Math.max(...zs) + slack);
      }
    }
  });

  it('lies along the slope it falls on', () => {
    const obj = createModel('tank', 0);
    obj.rotation.order = 'YXZ';
    // Ground rising toward +x (the tank's nose) at 1 in 4.
    const c = breakModel(obj, 3, (x) => x * 0.25);
    stepCollapse(obj, c, 999);
    expect(obj.rotation.z).toBeGreaterThan(Math.atan(0.25) - 0.17);
    expect(obj.rotation.z).toBeLessThan(Math.atan(0.25) + 0.17);
  });
});
