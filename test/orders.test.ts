import { describe, expect, it } from 'vitest';
import { Faction, Transform, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function units(game: Game, faction: number): number[] {
  return [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === faction);
}

function meanX(game: Game, faction: number): number {
  const list = units(game, faction);
  return list.reduce((s, e) => s + game.world.req(e, Transform).x, 0) / list.length;
}

describe('player orders', () => {
  it('spawnUnitAt drops units on land and refuses water or off-map spots', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[0];
    expect(game.spawnUnitAt('tank', 0, site.x, site.z)).toBe(true);
    expect(units(game, 0).length).toBe(1);
    expect(game.spawnUnitAt('tank', 0, game.field.bounds.maxX + 5, 0)).toBe(false);
    // Find some water to test against.
    let water: { x: number; z: number } | null = null;
    for (let x = game.field.bounds.minX; x < game.field.bounds.maxX && !water; x += 1) {
      for (let z = game.field.bounds.minZ; z < game.field.bounds.maxZ && !water; z += 1) {
        if (game.field.isWater(x, z) && game.field.contains(x, z, 2)) water = { x, z };
      }
    }
    if (water) expect(game.spawnUnitAt('tank', 0, water.x, water.z)).toBe(false);
    expect(units(game, 0).length).toBe(1);
  });

  it('hold keeps units gathered at a custom rally point', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[0];
    for (let i = 0; i < 6; i++) game.spawnUnitAt('strider', 0, site.x + i, site.z);
    const rally = { x: site.x + 20, z: site.z };
    game.setStance(0, 'hold');
    game.setRally(0, rally);
    run(game, 25);
    for (const e of units(game, 0)) {
      const t = game.world.req(e, Transform);
      expect(Math.hypot(t.x - rally.x, t.z - rally.z)).toBeLessThan(9);
    }
  });

  it('attack sends units toward the enemy base regardless of the tide', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[0];
    const enemy = game.field.baseSites[1];
    for (let i = 0; i < 4; i++) game.spawnUnitAt('strider', 0, site.x + i, site.z);
    const start = meanX(game, 0);
    game.setStance(0, 'attack');
    run(game, 20);
    expect(Math.abs(meanX(game, 0) - enemy.x)).toBeLessThan(Math.abs(start - enemy.x) - 30);
  });

  it('every unit type can be dropped', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[1];
    for (const id of Object.keys(UNIT_DEFS) as (keyof typeof UNIT_DEFS)[]) {
      expect(game.spawnUnitAt(id, 1, site.x, site.z)).toBe(true);
    }
  });
});
