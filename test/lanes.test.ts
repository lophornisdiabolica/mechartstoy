import { describe, expect, it } from 'vitest';
import { Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { LANES, LaneId } from '../src/game/lanes';
import { defaultSettings } from '../src/game/settings';

const DT = 1 / 30;

describe('lanes', () => {
  it('waypoints are dry, roomy and reachable from both bases, even with lots of water', () => {
    for (let seed = 0; seed < 10; seed++) {
      for (const water of [0.5, 1]) {
        const s = defaultSettings();
        s.map.water = water;
        const game = new Game(seed * 7 + 1, { settings: s, populate: false, autoSpawn: false });
        const { lanes, nav, field } = game.ctx;
        for (const points of lanes.lanes(0, 1)) {
          for (const p of points) {
            expect(field.isWater(p.x, p.z)).toBe(false);
            for (const base of field.baseSites) expect(nav.connected(p, base)).toBe(true);
          }
        }
      }
    }
  });

  it('flank lanes swing wide of the centre lane', () => {
    const game = new Game(3, { populate: false, autoSpawn: false });
    const [centre, north, south] = game.ctx.lanes.lanes(0, 1);
    expect(north[1].z).toBeGreaterThan(centre[1].z + game.field.depth * 0.15);
    expect(south[1].z).toBeLessThan(centre[1].z - game.field.depth * 0.15);
  });

  it('waypoints come in order from each side', () => {
    const game = new Game(3, { populate: false, autoSpawn: false });
    const { lanes, field } = game.ctx;
    for (const faction of [0, 1]) {
      const home = field.baseSites[faction];
      let x = home.x;
      let z = home.z;
      const seen: number[] = [];
      for (let p = lanes.nextWaypoint(faction, 1 - faction, 1, x, z); p; p = lanes.nextWaypoint(faction, 1 - faction, 1, x, z)) {
        seen.push(p.x);
        x = p.x;
        z = p.z;
      }
      expect(seen.length).toBe(3);
      // Heading toward the enemy base the whole way.
      expect(seen.map((v) => Math.sign(v - home.x) * Math.sign(field.baseSites[1 - faction].x - home.x))).toEqual([1, 1, 1]);
    }
  });

  it('squads keep one lane per attack, and flanking 0 keeps everyone in the centre', () => {
    const game = new Game(5, { populate: false, autoSpawn: false });
    const { lanes } = game.ctx;
    const picks = new Set<LaneId>();
    for (let squad = 0; squad < 60; squad++) {
      const lane = lanes.laneFor(0, 2, squad, 0.6);
      expect(lanes.laneFor(0, 2, squad, 0.6)).toBe(lane);
      picks.add(lane);
      expect(lanes.laneFor(0, 2, squad, 0)).toBe(0);
    }
    expect(picks.size).toBe(LANES.length);
  });

  it('battles spread out across the map', () => {
    const game = new Game(21);
    const [a, b] = game.field.baseSites;
    let outer = 0;
    let shots = 0;
    game.events.on('fired', (e) => {
      if (!game.world.has(e.entity, Unit)) return;
      const t = (e.x - a.x) / (b.x - a.x);
      const centre = a.z + (b.z - a.z) * t;
      shots++;
      if (Math.abs(e.z - centre) > game.field.depth * 0.18) outer++;
    });
    while (game.world.time < 300) game.step(DT);
    // Before lanes, almost no fighting happened out on the flanks.
    expect(outer / shots).toBeGreaterThan(0.06);
  }, 60000);
});
