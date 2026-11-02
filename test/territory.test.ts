import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Armed, Health, Mover, Transform, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { newSquad, spawnBuilding, spawnUnit } from '../src/game/spawn';
import { applyDamage, damageThrough } from '../src/game/systems/projectiles';
import { hitWorth } from '../src/game/systems/targeting';
import { inTerritory, recordSquad, REFILL_INTERVAL, REST_TIME } from '../src/game/territory';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/**
 * An empty Eternal map where territory and production run. Each side gets a
 * mech bay that can't build anything (no super units allowed), so no side
 * counts as having lost its production and no reinforcement waves come.
 */
function emptyGame(seed = 4): Game {
  const s = defaultSettings();
  s.armies.caps.super = 0;
  const game = new Game(seed, { settings: s, populate: false });
  for (const site of game.field.baseSites) {
    const a = Math.atan2(-site.z, -site.x);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, site.faction, site.x - Math.cos(a) * site.radius * 0.7, site.z - Math.sin(a) * site.radius * 0.7, 0);
  }
  return game;
}

/** A point well outside every side's territory: the middle of the map, away from outposts. */
function noMansLand(game: Game): { x: number; z: number } {
  for (let x = -20; x <= 20; x += 2) {
    for (let z = -20; z <= 20; z += 2) {
      if (!game.field.isWater(x, z) && !inTerritory(game.ctx, 0, x, z) && !inTerritory(game.ctx, 1, x, z)) return { x, z };
    }
  }
  throw new Error('no neutral ground');
}

describe('flat armour', () => {
  it('takes armour off each hit, down to a tenth of the hit', () => {
    expect(damageThrough(40, 6)).toBe(34);
    expect(damageThrough(4, 6)).toBeCloseTo(0.4);
    expect(damageThrough(4, 0)).toBe(4);
  });

  it('rifles barely scratch a tank, AT rockets get through its armour but not a Titan’s', () => {
    const game = emptyGame();
    const site = game.field.baseSites[1];
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, site.x, site.z);
    const titan = spawnUnit(game.world, game.ctx, UNIT_DEFS.titan, 1, site.x + 6, site.z);
    const taken = (e: number, amount: number) => {
      const h = game.world.req(e, Health);
      const before = h.hp;
      applyDamage(game.world, game.ctx, e, amount);
      return before - h.hp;
    };
    const rifle = UNIT_DEFS.trooper.weapon.damage;
    const rocket = UNIT_DEFS.atTrooper.weapon.damage;
    expect(taken(tank, rifle)).toBeLessThan(rifle * 0.2);
    expect(taken(tank, rocket)).toBeGreaterThan(rocket * 0.8);
    expect(taken(titan, rocket)).toBeLessThan(rocket * 0.5);
  });

  it('each weapon prefers what it can hurt: rifles infantry, rockets vehicles', () => {
    const game = emptyGame();
    const site = game.field.baseSites[1];
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, site.x, site.z);
    const soldier = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, site.x + 2, site.z);
    const rifleman = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, site.x - 6, site.z);
    const at = spawnUnit(game.world, game.ctx, UNIT_DEFS.atTrooper, 0, site.x - 6, site.z + 1);
    const rifle = game.world.req(rifleman, Armed);
    const launcher = game.world.req(at, Armed);
    expect(hitWorth(game.world, rifle, soldier)).toBeGreaterThan(hitWorth(game.world, rifle, tank));
    expect(hitWorth(game.world, launcher, tank)).toBeGreaterThan(hitWorth(game.world, launcher, soldier));
    // The AT soldier picks the tank over a soldier who's a little closer.
    game.world.req(at, Transform).x = site.x + 8;
    run(game, 0.6);
    expect(launcher.target).toBe(tank);
  });
});

describe('territory', () => {
  it('a side’s base and held outposts are its territory, shared with allies', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    expect(inTerritory(game.ctx, 0, base.x, base.z)).toBe(true);
    expect(inTerritory(game.ctx, 1, base.x, base.z)).toBe(false);
    const o = game.ctx.outposts[0];
    expect(inTerritory(game.ctx, 0, o.x, o.z)).toBe(false);
    o.owner = 0;
    expect(inTerritory(game.ctx, 0, o.x, o.z)).toBe(true);
  });

  it('units heal while resting in territory, not while fighting or away from it', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const away = noMansLand(game);
    const home = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x, base.z);
    const out = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, away.x, away.z);
    for (const e of [home, out]) {
      game.world.remove(e, Ai);
      game.world.req(e, Health).hp = 100;
      // Just hurt: the rest starts now.
      applyDamage(game.world, game.ctx, e, 0.001);
    }
    run(game, REST_TIME * 0.8);
    expect(game.world.req(home, Health).hp).toBeLessThan(100);
    run(game, REST_TIME);
    expect(game.world.req(home, Health).hp).toBeGreaterThan(105);
    expect(game.world.req(out, Health).hp).toBeLessThan(100);
  });

  it('a resting infantry squad gets its missing soldiers back, beside it', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const squad = newSquad(game.ctx);
    recordSquad(game.ctx, squad, 0, ['trooper', 'trooper', 'atTrooper']);
    const kept = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, base.x, base.z, squad);
    game.world.req(kept, Mover).speed = 0;
    applyDamage(game.world, game.ctx, kept, 0.001);
    const arrivals: { id: string; d: number }[] = [];
    game.events.on('spawned', (e) => {
      const t = game.world.req(e.entity, Transform);
      const k = game.world.req(kept, Transform);
      arrivals.push({ id: e.def.id, d: Math.hypot(t.x - k.x, t.z - k.z) });
    });
    // Nothing until it has rested, then one soldier per interval.
    run(game, REST_TIME + REFILL_INTERVAL - 1);
    expect(arrivals.length).toBe(0);
    run(game, REFILL_INTERVAL * 2);
    expect(arrivals.map((a) => a.id).sort()).toEqual(['atTrooper', 'trooper']);
    for (const a of arrivals) expect(a.d).toBeLessThan(4);
    // Back to full strength: no more.
    run(game, REFILL_INTERVAL * 2);
    expect(arrivals.length).toBe(2);
  });

  it('a squad away from territory is not refilled', () => {
    const game = emptyGame();
    const away = noMansLand(game);
    const squad = newSquad(game.ctx);
    recordSquad(game.ctx, squad, 0, ['trooper', 'trooper']);
    const kept = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, away.x, away.z, squad);
    game.world.req(kept, Mover).speed = 0;
    run(game, REST_TIME + REFILL_INTERVAL * 3);
    expect(game.ctx.rosters.has(squad)).toBe(true);
    expect([...game.world.query(Unit)].length).toBe(1);
  });

  it('barracks squads have an AT soldier with the riflemen', () => {
    const game = emptyGame();
    const site = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.barracks, 0, site.x, site.z, 0);
    const spawned: string[] = [];
    game.events.on('spawned', (e) => spawned.push(e.def.id));
    run(game, BUILDING_DEFS.barracks.production.interval * 1.2);
    expect(spawned.filter((id) => id === 'atTrooper').length).toBe(1);
    expect(spawned.filter((id) => id === 'trooper').length).toBe(4);
  });
});
