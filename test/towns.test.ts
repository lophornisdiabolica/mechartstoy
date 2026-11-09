import { describe, expect, it } from 'vitest';
import { Armed, Building, Faction, Health, militiaOf, NEUTRAL, Townsfolk, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { BUILD_EVERY, MILITIA_AT } from '../src/game/towns';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** A battle with a town and nobody fighting: no opening armies or production. */
function quietTown(townLife = true): Game {
  const s = defaultSettings();
  s.map.townLife = townLife;
  s.map.towns = 1;
  s.armies.startingArmy = 0;
  return new Game(3, { settings: s, autoSpawn: false });
}

function folk(game: Game, town = 0): number[] {
  return [...game.world.query(Townsfolk)].filter((e) => game.world.req(e, Townsfolk).town === town);
}

function townBuildings(game: Game): number[] {
  return [...game.world.query(Building, Faction)].filter((e) => game.world.req(e, Faction).id === NEUTRAL);
}

describe('townsfolk', () => {
  it('a town has a few people and an engineer, who walk about it', () => {
    const game = quietTown();
    run(game, 1);
    const people = folk(game);
    const roles = people.map((e) => game.world.req(e, Townsfolk).role);
    expect(roles.filter((r) => r === 'engineer').length).toBe(1);
    expect(roles.filter((r) => r === 'civilian').length).toBeGreaterThanOrEqual(3);
    const site = game.field.townSites[0];
    const start = people.map((e) => ({ ...game.world.req(e, Transform) }));
    run(game, 20);
    const moved = people.filter((e, k) => Math.hypot(game.world.req(e, Transform).x - start[k].x, game.world.req(e, Transform).z - start[k].z) > 1).length;
    expect(moved).toBeGreaterThan(0);
    for (const e of people) {
      const t = game.world.req(e, Transform);
      expect(Math.hypot(t.x - site.x, t.z - site.z)).toBeLessThan(site.radius * 1.4);
    }
  }, 60000);

  it('none with the setting off', () => {
    const game = quietTown(false);
    run(game, 2);
    expect(folk(game).length).toBe(0);
  });

  it('the town engineer puts up a new building every few minutes', () => {
    const game = quietTown();
    run(game, 1);
    const before = townBuildings(game).length;
    run(game, BUILD_EVERY * 2 + 40);
    expect(townBuildings(game).length).toBeGreaterThanOrEqual(before + 2);
  }, 120000);

  it('a side that razes enough of the town faces its militia, and only that side', () => {
    const game = quietTown();
    const { world, ctx } = game;
    run(game, 1);
    const site = game.field.townSites[0];
    const houses = townBuildings(game)
      .map((e) => ({ e, t: world.req(e, Transform) }))
      .sort((a, b) => Math.hypot(a.t.x - site.x, a.t.z - site.z) - Math.hypot(b.t.x - site.x, b.t.z - site.z));
    for (const { e } of houses.slice(0, MILITIA_AT)) {
      const h = world.req(e, Health);
      h.lastHit = { faction: 1, source: 'tank' };
      h.hp = 0;
    }
    run(game, 1);
    const militia = folk(game).filter((e) => world.req(e, Townsfolk).role === 'militia');
    expect(militia.length).toBeGreaterThanOrEqual(3);
    expect(world.req(militia[0], Faction).id).toBe(militiaOf(0));
    expect(world.has(militia[0], Armed)).toBe(true);
    expect(ctx.sides.hostile(militiaOf(0), 1)).toBe(true);
    expect(ctx.sides.hostile(1, militiaOf(0))).toBe(true);
    expect(ctx.sides.hostile(militiaOf(0), 0)).toBe(false);
    // They shoot side 1's units that come close, and leave side 0's alone.
    run(game, 6);
    const guard = world.req(militia[0], Transform);
    const red = spawnUnit(world, ctx, UNIT_DEFS.trooper, 1, guard.x + 5, guard.z);
    const blue = spawnUnit(world, ctx, UNIT_DEFS.trooper, 0, guard.x - 5, guard.z);
    const redHp = world.req(red, Health).max;
    const blueHp = world.req(blue, Health).max;
    run(game, 6);
    expect(!world.isAlive(red) || world.req(red, Health).hp < redHp).toBe(true);
    expect(world.req(blue, Health).hp).toBe(blueHp);
  }, 60000);

  it("doesn't count townsfolk as kills", () => {
    const game = quietTown();
    run(game, 1);
    const victim = folk(game)[0];
    const h = game.world.req(victim, Health);
    h.lastHit = { faction: 0, source: 'tank' };
    h.hp = 0;
    run(game, 0.5);
    expect(game.world.isAlive(victim)).toBe(false);
    expect(game.stats.sides[0].kills).toBe(0);
  });
});
