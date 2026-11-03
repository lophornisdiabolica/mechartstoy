import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Armed, Building, Faction, Health, Transform, Unit } from '../src/game/components';
import { DOCTRINES } from '../src/game/doctrines';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { applyDamage } from '../src/game/systems/projectiles';
import { UNIT_DEFS } from '../src/game/units';
import { layoutBase } from '../src/world/settlements';
import { Rng } from '../src/core/rng';
import { BOAT_BERTHS, berthFree, countBoats, countByCategory } from '../src/game/caps';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** An empty map with production off (see territory.test.ts). */
function emptyGame(seed = 4, water?: number): Game {
  const s = defaultSettings();
  s.armies.caps.super = 0;
  if (water !== undefined) s.map.water = water;
  const game = new Game(seed, { settings: s, populate: false });
  for (const site of game.field.baseSites) {
    const a = Math.atan2(-site.z, -site.x);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, site.faction, site.x - Math.cos(a) * site.radius * 0.7, site.z - Math.sin(a) * site.radius * 0.7, 0);
  }
  return game;
}

/** A game with sides 0 and 1 on these doctrines and their bases built. */
function battle(seed: number, water: number, doctrines: [string, string]): Game {
  const s = defaultSettings();
  s.map.water = water;
  s.factions.forEach((f, i) => (f.doctrine = doctrines[i] as typeof f.doctrine));
  return new Game(seed, { settings: s });
}

function buildingsOf(game: Game, faction: number): string[] {
  return [...game.world.query(Building, Faction)].filter((e) => game.world.req(e, Faction).id === faction).map((e) => game.world.req(e, Building).def.id);
}

describe('Bastion', () => {
  it('a sensor mast lets a howitzer fire past its own sight', () => {
    const game = emptyGame();
    const site = game.field.baseSites[0];
    const dir = Math.sign(-site.x);
    const gun = spawnUnit(game.world, game.ctx, UNIT_DEFS.howitzer, 0, site.x, site.z);
    const range = UNIT_DEFS.howitzer.weapon.range;
    expect(UNIT_DEFS.howitzer.sight).toBeLessThan(range - 2);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, site.x + dir * (range - 2), site.z);
    for (const e of [gun, tank]) game.world.remove(e, Ai);
    run(game, 1);
    expect(game.world.req(gun, Armed).target).toBeNull();
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.sensorMast, 0, site.x + dir * 4, site.z + 4, 0);
    run(game, 1);
    expect(game.world.req(gun, Armed).target).toBe(tank);
  });

  it('builds two more guard towers than other doctrines', () => {
    const game = emptyGame();
    const site = game.field.baseSites[0];
    const towers = (d: keyof typeof DOCTRINES) => layoutBase(game.field, site, new Rng(1), DOCTRINES[d]).filter((p) => p.building === 'tower').length;
    expect(towers('bastion')).toBe(towers('armour') + 2);
  });
});

describe('Firestorm', () => {
  it('a fuel depot blows up when destroyed, hurting both sides round it', () => {
    const game = emptyGame();
    const site = game.field.baseSites[1];
    const depot = spawnBuilding(game.world, game.ctx, BUILDING_DEFS.fuelDepot, 1, site.x, site.z, 0);
    const own = spawnUnit(game.world, game.ctx, UNIT_DEFS.lightTank, 1, site.x + 4, site.z);
    const enemy = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, site.x, site.z + 4);
    const far = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, site.x, site.z + 14);
    for (const e of [own, enemy, far]) game.world.remove(e, Ai);
    run(game, 0.1);
    applyDamage(game.world, game.ctx, depot, 1e6, { source: 'tank', faction: 0 });
    run(game, 0.1);
    expect(game.world.req(own, Health).hp).toBeLessThan(UNIT_DEFS.lightTank.hp);
    expect(game.world.req(enemy, Health).hp).toBeLessThan(UNIT_DEFS.tank.hp);
    expect(game.world.req(far, Health).hp).toBe(UNIT_DEFS.tank.hp);
  });
});

describe('Tidewater', () => {
  it('builds a dock on the coast and launches boats onto the water', () => {
    const game = battle(4, 1, ['tidewater', 'armour']);
    expect(buildingsOf(game, 0)).toContain('dock');
    run(game, 90);
    const boats = [...game.world.query(Unit, Transform)].filter((e) => game.world.req(e, Unit).def.id === 'missileBoat');
    expect(boats.length).toBeGreaterThan(0);
    for (const e of boats) {
      const t = game.world.req(e, Transform);
      expect(game.field.isWater(t.x, t.z)).toBe(true);
    }
  }, 60000);

  it('boats take berths rather than vehicle cap', () => {
    const game = emptyGame(4, 1);
    const f = game.field;
    const water: { x: number; z: number }[] = [];
    for (let x = f.bounds.minX + 2; x < f.bounds.maxX - 2 && water.length < BOAT_BERTHS; x += 3) {
      for (let z = f.bounds.minZ + 2; z < f.bounds.maxZ - 2 && water.length < BOAT_BERTHS; z += 3) {
        if (game.ctx.navs.for('naval').fitsAt(x, z, 1.5)) water.push({ x, z });
      }
    }
    for (const w of water) spawnUnit(game.world, game.ctx, UNIT_DEFS.missileBoat, 0, w.x, w.z);
    expect(countByCategory(game.world, 2)[0].vehicle).toBe(0);
    const boats = countBoats(game.world, 2);
    expect(boats[0]).toBe(BOAT_BERTHS);
    expect(berthFree(game.ctx, boats, 0)).toBe(false);
    expect(berthFree(game.ctx, boats, 1)).toBe(true);
  });

  it('builds a hover pad instead when its base has no coast', () => {
    const game = battle(4, 0, ['tidewater', 'armour']);
    expect(buildingsOf(game, 0)).toContain('hoverPad');
    expect(buildingsOf(game, 0)).not.toContain('dock');
  });

  it('boats sent inland head for the nearest water they can reach', () => {
    const game = emptyGame(4, 1);
    const grid = game.ctx.navs.for('naval');
    const f = game.field;
    let from: { x: number; z: number } | null = null;
    for (let x = f.bounds.minX + 2; x < f.bounds.maxX - 2 && !from; x += 2) {
      for (let z = f.bounds.minZ + 2; z < f.bounds.maxZ - 2 && !from; z += 2) if (grid.fitsAt(x, z, 1.2)) from = { x, z };
    }
    expect(from).not.toBeNull();
    const base = f.baseSites[1];
    const path = grid.findPath(from!, base, 1.2)!;
    const end = path[path.length - 1];
    expect(grid.terrainAllowsAt(end.x, end.z)).toBe(true);
  });
});
