import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Armed, Building, Construction, Faction, Health, NEUTRAL, Rubble, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { generateBattlefield } from '../src/world/battlefield';
import { layoutBase, layoutTown } from '../src/world/settlements';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function buildings(game: Game, faction?: number): number[] {
  return [...game.world.query(Building, Faction)].filter((e) => faction === undefined || game.world.req(e, Faction).id === faction);
}

describe('settlement layouts', () => {
  it('places non-overlapping buildings on dry land for many seeds', () => {
    for (let seed = 0; seed < 15; seed++) {
      const field = generateBattlefield(new Rng(seed));
      const rng = new Rng(seed + 100);
      for (const placements of [...field.baseSites.map((s) => layoutBase(field, s, rng)), ...field.townSites.map((s) => layoutTown(field, s, rng))]) {
        expect(placements.length).toBeGreaterThan(5);
        for (const a of placements) {
          expect(field.isWater(a.x, a.z)).toBe(false);
          for (const b of placements) {
            if (a === b) continue;
            const minGap = BUILDING_DEFS[a.building].radius + BUILDING_DEFS[b.building].radius;
            expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(minGap);
          }
        }
      }
      expect(field.townSites.length).toBe(1);
    }
  });

  it('gives each base its production buildings and a neutral town', () => {
    const game = new Game(4);
    for (const f of [0, 1]) {
      const ids = buildings(game, f).map((e) => game.world.req(e, Building).def.id);
      expect(ids).toEqual(expect.arrayContaining(['hq', 'barracks', 'factory', 'mechbay', 'tower']));
    }
    expect(buildings(game, NEUTRAL).length).toBeGreaterThan(6);
  });
});

describe('buildings', () => {
  it('production buildings turn out units on a timer', () => {
    const game = new Game(4, { populate: false });
    const site = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.barracks, 0, site.x, site.z, 0);
    let spawned = 0;
    game.events.on('spawned', (e) => {
      if (e.def.id === 'trooper') spawned++;
    });
    run(game, BUILDING_DEFS.barracks.production.interval * 2.5);
    expect(spawned).toBeGreaterThanOrEqual(10);
  });

  it('a destroyed building turns to rubble and is rebuilt', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[1];
    const b = spawnBuilding(game.world, game.ctx, BUILDING_DEFS.factory, 1, site.x, site.z, Math.PI);
    const destroyed: string[] = [];
    game.events.on('buildingDestroyed', (e) => destroyed.push(e.def.id));
    game.world.req(b, Health).hp = 0;
    game.step(DT);
    expect(game.world.isAlive(b)).toBe(false);
    expect(destroyed).toEqual(['factory']);
    expect([...game.world.query(Rubble)].length).toBe(1);

    run(game, BUILDING_DEFS.factory.rebuildDelay + 1);
    const rebuilt = buildings(game, 1);
    expect(rebuilt.length).toBe(1);
    expect(game.world.has(rebuilt[0], Construction)).toBe(true);
    run(game, BUILDING_DEFS.factory.buildTime + 1);
    expect(game.world.has(rebuilt[0], Construction)).toBe(false);
    expect(game.world.req(rebuilt[0], Health).hp).toBeCloseTo(BUILDING_DEFS.factory.hp, 0);
  });

  it('rebuilding waits while enemies stand on the site', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[1];
    const b = spawnBuilding(game.world, game.ctx, BUILDING_DEFS.house, 1, site.x, site.z, 0);
    game.world.req(b, Health).hp = 0;
    game.step(DT);
    // An unarmed-in-practice squatter: freeze its weapon so it just stands there.
    const squatter = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, site.x + 3, site.z);
    game.world.remove(squatter, Armed);
    run(game, BUILDING_DEFS.house.rebuildDelay + 10);
    expect(buildings(game, 1).length).toBe(0);
    game.world.destroy(squatter);
    run(game, 10);
    expect(buildings(game, 1).length).toBe(1);
  });

  it('guard towers shoot approaching enemies', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.tower, 0, site.x, site.z, 0);
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, site.x + 12, site.z);
    run(game, 10);
    expect(game.world.isAlive(trooper)).toBe(false);
  });

  it('units never deliberately target the civilian town', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const town = game.field.townSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.house, NEUTRAL, town.x, town.z, 0);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, town.x + 6, town.z);
    run(game, 3);
    expect(game.world.req(tank, Armed).target).toBeNull();
  });

  it('the full game keeps cycling: buildings fall and get rebuilt, both sides keep fighting', () => {
    const game = new Game(6);
    let destroyed = 0;
    let rebuilt = 0;
    const kills = [0, 0];
    game.events.on('buildingDestroyed', () => destroyed++);
    game.events.on('constructionStarted', () => rebuilt++);
    game.events.on('unitDestroyed', (e) => kills[e.faction]++);
    let bothSides = 0;
    for (let s = 0; s < 20; s++) {
      run(game, 30);
      const alive = [0, 0];
      for (const e of game.world.query(Unit, Faction)) alive[game.world.req(e, Faction).id]++;
      if (alive[0] > 0 && alive[1] > 0) bothSides++;
    }
    expect(destroyed).toBeGreaterThan(3);
    expect(rebuilt).toBeGreaterThan(0);
    expect(kills[0]).toBeGreaterThan(50);
    expect(kills[1]).toBeGreaterThan(50);
    expect(bothSides).toBeGreaterThanOrEqual(18);
  }, 60000);
});
