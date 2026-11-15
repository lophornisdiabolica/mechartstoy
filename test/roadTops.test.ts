import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { RoadTops } from '../src/render/roadTops';
import { buildTerrain } from '../src/render/terrainMesh';

/** Compare the road tops with a ray straight down onto the drawn roads, at points round (x, z); returns how many were on a road. */
function compare(tops: RoadTops, roads: THREE.Object3D, rng: Rng, x: number, z: number, reach: number, n: number): number {
  roads.updateMatrixWorld(true);
  const caster = new THREE.Raycaster();
  let onRoad = 0;
  for (let k = 0; k < n; k++) {
    const px = x + (rng.next() * 2 - 1) * reach;
    const pz = z + (rng.next() * 2 - 1) * reach;
    caster.set(new THREE.Vector3(px, 1000, pz), new THREE.Vector3(0, -1, 0));
    const hit = caster.intersectObjects([roads], true)[0];
    const top = tops.at(px, pz);
    if (hit) {
      onRoad++;
      expect(top).toBeCloseTo(hit.point.y, 3);
    } else expect(top).toBe(-Infinity);
  }
  return onRoad;
}

describe('road tops', () => {
  it('find the drawn road under a point, as a ray straight down would, and follow roads redrawn when the ground moves', () => {
    const s = defaultSettings();
    s.map.city = 'sprawl';
    s.map.size = 'large';
    s.armies.startingArmy = 0;
    const game = new Game(3, { settings: s, autoSpawn: false });
    const terrain = buildTerrain(game.field, new Rng(1));
    const roads = terrain.getObjectByName('roads')!;
    const tops = terrain.userData.roadTops as RoadTops;
    const rng = new Rng(2);
    let onRoad = 0;
    for (const o of game.ctx.outposts) onRoad += compare(tops, roads, rng, o.x, o.z, 6, 40);
    onRoad += compare(tops, roads, rng, 0, 0, game.field.width / 2, 300);
    expect(onRoad).toBeGreaterThan(60);
    // Raise a bump under a road: it's redrawn higher, and the tops follow.
    const road = game.field.roads.find((r) => r.kind !== 'alley')!;
    const [a, b] = road.points;
    const at = { x: a.x + (b.x - a.x) * 0.3, z: a.z + (b.z - a.z) * 0.3 };
    const before = tops.at(at.x, at.z);
    expect(before).toBeGreaterThan(-Infinity);
    game.field.reshape(at.x, at.z, 3, (h, d) => h + 0.8 * (1 - d / 3));
    compare(tops, roads, rng, at.x, at.z, 3, 60);
    expect(tops.at(at.x, at.z)).toBeGreaterThan(before + 0.4);
    // Quick enough to look up every unit, every frame.
    const t0 = performance.now();
    for (let k = 0; k < 20000; k++) tops.at((rng.next() - 0.5) * game.field.width, (rng.next() - 0.5) * game.field.depth);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
