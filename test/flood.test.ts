import { describe, expect, it } from 'vitest';
import { Building, Faction, Health, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { capture } from '../src/game/outposts';
import { BattleSettings, battlefieldConfig, defaultFaction, defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { floodEscape } from '../src/game/flood';
import { raiseRelics } from '../src/game/traits';
import { RELIC } from '../src/game/components';
import { generateBattlefield } from '../src/world/battlefield';
import { Rng } from '../src/core/rng';

const DT = 1 / 30;

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    each?.();
  }
}

function settings(): BattleSettings {
  const s = defaultSettings();
  s.map.water = 0.6;
  s.map.traits = ['dam'];
  s.factions = [defaultFaction(0), defaultFaction(1)];
  return s;
}

/** A game whose map has a dam and its sluice house. */
function damGame(): Game {
  for (let seed = 1; ; seed++) {
    const game = new Game(seed, { settings: settings(), populate: false, autoSpawn: false });
    if (!game.ctx.flood || !game.ctx.outposts.some((o) => o.kind.sluices)) continue;
    raiseRelics(game.world, game.ctx);
    return game;
  }
}

/** The valley's deepest-flooding spot well away from the dam, and its middle. */
function valleySpot(game: Game, far = 0.6): { x: number; z: number } {
  const p = game.field.traits.flood!;
  const stride = game.field.config.cols + 1;
  const n = Math.floor(p.verts.length * far);
  const k = p.verts[n];
  return { x: game.field.vertexX(k % stride), z: game.field.vertexZ(Math.floor(k / stride)) };
}

function dams(game: Game): number[] {
  return [...game.world.query(Building, Faction)].filter((e) => game.world.req(e, Faction).id === RELIC && game.world.req(e, Building).def.id === 'dam');
}

describe('dam trait', () => {
  it('holds the water back from a low valley by the water, with a sluice house above it', () => {
    let laid = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const field = generateBattlefield(new Rng(seed), battlefieldConfig(settings()));
      const p = field.traits.flood;
      if (!p) continue;
      laid++;
      // Dry now, and under the sea once it's flooded.
      for (let n = 0; n < p.verts.length; n++) {
        expect(field.heights[p.verts[n]]).toBeGreaterThanOrEqual(field.seaLevel);
        expect(p.to[n]).toBeLessThan(field.seaLevel);
        if (n > 0) expect(p.dist[n]).toBeGreaterThanOrEqual(p.dist[n - 1]);
      }
      expect(field.traits.relics.filter((r) => r.building === 'dam').length).toBe(3);
      for (const b of field.baseSites) expect(Math.hypot(b.x - p.x, b.z - p.z)).toBeGreaterThan(b.radius);
    }
    expect(laid).toBeGreaterThan(3);
    expect(generateBattlefield(new Rng(1), battlefieldConfig(defaultSettings())).traits.flood).toBeNull();
  });

  it('shot to pieces, the dam breaks and the valley floods from the dam outward, for good', () => {
    const game = damGame();
    const flood = game.ctx.flood!;
    const near = valleySpot(game, 0.1);
    const far = valleySpot(game, 0.95);
    const floods: number[] = [];
    game.events.on('flood', (e) => floods.push(e.faction));
    run(game, 5);
    expect(flood.state).toBe('held');
    expect(game.field.isWater(far.x, far.z)).toBe(false);
    game.world.req(dams(game)[0], Health).hp = 0;
    run(game, 1);
    expect(floods).toEqual([-1]);
    expect(flood.state).toBe('flooding');
    run(game, 25);
    expect(game.field.isWater(near.x, near.z)).toBe(true);
    // Routes keep off where it's coming.
    run(game, 100);
    expect(flood.state).toBe('flooded');
    expect(game.field.isWater(far.x, far.z)).toBe(true);
    expect(game.ctx.navs.land.terrainAllowsAt(far.x, far.z)).toBe(false);
  }, 30_000);

  it("a unit in the water's way gets out of the valley, and one held there drowns", () => {
    const game = damGame();
    const flood = game.ctx.flood!;
    const spot = valleySpot(game, 0.7);
    // (Nobody's garrison about to shoot at it.)
    for (const o of game.ctx.outposts) capture(game.world, game.ctx, o, 0);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, spot.x, spot.z);
    const held = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, spot.x + 0.5, spot.z);
    expect(floodEscape(game.ctx, 'tracked', spot.x, spot.z)).toBeNull();
    game.world.req(dams(game)[0], Health).hp = 0;
    run(game, 1);
    const ht = game.world.req(held, Transform);
    run(game, 100, () => {
      if (game.world.get(held, Health)) {
        ht.x = spot.x + 0.5;
        ht.z = spot.z;
      }
    });
    expect(flood.state).toBe('flooded');
    expect(game.world.get(tank, Health)?.hp ?? 0).toBeGreaterThan(0);
    expect(game.world.get(held, Health)?.hp ?? 0).toBe(0);
  }, 30_000);

  it("the sluice house's holder opens the sluices on enemies in the valley, and not on its own", () => {
    const game = damGame();
    const flood = game.ctx.flood!;
    const house = game.ctx.outposts.find((o) => o.kind.sluices)!;
    const spot = valleySpot(game, 0.5);
    const floods: number[] = [];
    game.events.on('flood', (e) => floods.push(e.faction));
    // Its own in the valley: it holds.
    capture(game.world, game.ctx, house, 0);
    for (let n = 0; n < 6; n++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, spot.x + (n % 3) - 1, spot.z + Math.floor(n / 3));
    run(game, 3);
    expect(flood.state).toBe('held');
    // Enemies in it and hardly any of its own: it opens them.
    capture(game.world, game.ctx, house, 1);
    run(game, 3);
    expect(floods).toEqual([1]);
    expect(flood.state).toBe('flooding');
  });
});
