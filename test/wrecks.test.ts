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
    for (const key of ['strider', 'titan', 'juggernaut', 'inferno', 'spider']) {
      const heights = new Set<number>();
      for (let seed = 0; seed < 12; seed++) {
        const body = wreck(key, seed).children[0];
        heights.add(Math.round(body.position.y * 20));
      }
      expect(heights.size, key).toBeGreaterThan(2);
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
});
