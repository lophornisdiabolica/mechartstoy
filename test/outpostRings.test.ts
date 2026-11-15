import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { RoadTops } from '../src/render/outpostRings';
import { buildTerrain } from '../src/render/terrainMesh';

describe('outpost rings', () => {
  it('find the road tops a ray straight down would, quickly, even in a city', () => {
    const s = defaultSettings();
    s.map.city = 'sprawl';
    s.map.size = 'large';
    s.armies.startingArmy = 0;
    const game = new Game(3, { settings: s, autoSpawn: false });
    const roads = buildTerrain(game.field, new Rng(1)).getObjectByName('roads')!;
    roads.updateMatrixWorld(true);
    const caster = new THREE.Raycaster();
    const rng = new Rng(2);
    let onRoad = 0;
    for (const o of game.ctx.outposts) {
      const tops = new RoadTops([roads], o.x, o.z, 6);
      for (let n = 0; n < 60; n++) {
        const x = o.x + (rng.next() * 2 - 1) * 5;
        const z = o.z + (rng.next() * 2 - 1) * 5;
        caster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
        const hit = caster.intersectObjects([roads], true)[0];
        const top = tops.at(x, z);
        if (hit) {
          onRoad++;
          expect(top).toBeCloseTo(hit.point.y, 3);
        } else expect(top).toBe(-Infinity);
      }
    }
    expect(onRoad).toBeGreaterThan(20);
    // A ring's worth of lookups (two rings of 65 x 2 x 9 samples) takes well under a frame.
    const o = game.ctx.outposts[0];
    const t0 = performance.now();
    for (let ring = 0; ring < 2; ring++) {
      const tops = new RoadTops([roads], o.x, o.z, 6);
      for (let n = 0; n < 1170; n++) tops.at(o.x + Math.cos(n) * 4.5, o.z + Math.sin(n) * 4.5);
    }
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
