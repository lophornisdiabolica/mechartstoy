import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Building, Collider, Mover, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { generateBattlefield } from '../src/world/battlefield';
import { NavGrid } from '../src/world/navGrid';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** A quiet game with no spawning, for movement scenarios. */
function quietGame(seed = 4): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

/** A unit with its AI removed, so the test controls where it goes. */
function puppet(game: Game, unit: keyof typeof UNIT_DEFS, x: number, z: number): number {
  const e = spawnUnit(game.world, game.ctx, UNIT_DEFS[unit], 0, x, z);
  game.world.remove(e, Ai);
  return e;
}

function goTo(game: Game, e: number, x: number, z: number): void {
  const m = game.world.req(e, Mover);
  m.targetX = x;
  m.targetZ = z;
}

describe('NavGrid', () => {
  it('finds routes that never cross water and reach the goal', () => {
    for (let seed = 0; seed < 8; seed++) {
      const field = generateBattlefield(new Rng(seed));
      const nav = new NavGrid(field);
      const a = field.baseSites[0];
      const b = field.baseSites[1];
      const path = nav.findPath({ x: a.x, z: a.z }, { x: b.x, z: b.z });
      expect(path).not.toBeNull();
      let prev = { x: a.x, z: a.z };
      for (const p of path!) {
        expect(nav.lineClear(prev, p)).toBe(true);
        prev = p;
      }
      const end = path![path!.length - 1];
      expect(Math.hypot(end.x - b.x, end.z - b.z)).toBeLessThan(2);
    }
  });

  it('routes around obstacles and updates when they are removed', () => {
    const field = generateBattlefield(new Rng(4));
    const nav = new NavGrid(field);
    const s = field.baseSites[0];
    const from = { x: s.x - 8, z: s.z };
    const to = { x: s.x + 8, z: s.z };
    expect(nav.lineClear(from, to)).toBe(true);
    nav.markObstacle(s.x, s.z, 4, 1);
    const v = nav.version;
    expect(nav.lineClear(from, to)).toBe(false);
    const path = nav.findPath(from, to)!;
    expect(path.length).toBeGreaterThan(1);
    nav.markObstacle(s.x, s.z, 4, -1);
    expect(nav.version).toBeGreaterThan(v);
    expect(nav.lineClear(from, to)).toBe(true);
  });
});

describe('unit movement', () => {
  it('walks around a building in the way instead of pushing into it', () => {
    const game = quietGame();
    const s = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.factory, 1, s.x, s.z, 0);
    const tank = puppet(game, 'tank', s.x - 8, s.z);
    goTo(game, tank, s.x + 8, s.z);
    run(game, 15);
    const t = game.world.req(tank, Transform);
    expect(Math.hypot(t.x - (s.x + 8), t.z - s.z)).toBeLessThan(1.5);
  });

  it('units walking head-on into each other get past', () => {
    const game = quietGame();
    const s = game.field.baseSites[0];
    const a = puppet(game, 'strider', s.x - 6, s.z);
    const b = puppet(game, 'strider', s.x + 6, s.z);
    goTo(game, a, s.x + 6, s.z);
    goTo(game, b, s.x - 6, s.z);
    run(game, 15);
    expect(game.world.req(a, Transform).x).toBeGreaterThan(s.x + 4);
    expect(game.world.req(b, Transform).x).toBeLessThan(s.x - 4);
  });

  it('a squad gets through a gap between buildings', () => {
    const game = quietGame();
    const s = game.field.baseSites[0];
    // A wall of houses with one gap in the middle.
    for (const dz of [-9, -6, -3, 3, 6, 9]) spawnBuilding(game.world, game.ctx, BUILDING_DEFS.house, 1, s.x, s.z + dz, 0);
    const squad = [-2, -1, 0, 1, 2].map((dz) => puppet(game, 'trooper', s.x - 6, s.z + dz * 2));
    for (const e of squad) goTo(game, e, s.x + 7, s.z);
    run(game, 30);
    for (const e of squad) expect(game.world.req(e, Transform).x).toBeGreaterThan(s.x + 3);
  });

  it('a big unit goes around a gap it does not fit through', () => {
    const game = quietGame();
    const s = game.field.baseSites[0];
    // A wall of houses with a gap troopers fit through but a Titan doesn't.
    for (const dz of [-8.2, -5.4, -2.6, 2.6, 5.4, 8.2]) spawnBuilding(game.world, game.ctx, BUILDING_DEFS.house, 1, s.x, s.z + dz, 0);
    const titan = puppet(game, 'titan', s.x - 7, s.z);
    const trooper = puppet(game, 'trooper', s.x - 7, s.z + 1);
    goTo(game, titan, s.x + 7, s.z);
    goTo(game, trooper, s.x + 7, s.z + 1);
    run(game, 40);
    expect(game.world.req(trooper, Transform).x).toBeGreaterThan(s.x + 4);
    expect(game.world.req(titan, Transform).x).toBeGreaterThan(s.x + 4);
  });

  it('wide units only fit through wide gaps', () => {
    const game = quietGame();
    const s = game.field.baseSites[0];
    for (const dz of [-2.6, 2.6]) spawnBuilding(game.world, game.ctx, BUILDING_DEFS.house, 1, s.x, s.z + dz, 0);
    run(game, 0.1);
    const a = { x: s.x - 5, z: s.z };
    const b = { x: s.x + 5, z: s.z };
    expect(game.ctx.nav.lineClear(a, b, UNIT_DEFS.trooper.radius)).toBe(true);
    expect(game.ctx.nav.lineClear(a, b, UNIT_DEFS.titan.radius)).toBe(false);
    // The Titan's route goes around the houses rather than between them.
    const path = game.ctx.nav.findPath(a, b, UNIT_DEFS.titan.radius)!;
    let prev = a;
    for (const p of path) {
      expect(game.ctx.nav.lineClear(prev, p, UNIT_DEFS.titan.radius)).toBe(true);
      prev = p;
    }
  });

  it('new units roll out where they fit, not wedged between buildings', () => {
    const game = new Game(4, { populate: false });
    const s = game.field.baseSites[0];
    // Super units need an outpost held.
    if (game.ctx.outposts.length > 0) game.ctx.outposts[0].owner = 0;
    // A mech bay with houses crowding its door.
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, 0, s.x, s.z, 0);
    for (const dz of [-2.4, 2.4]) spawnBuilding(game.world, game.ctx, BUILDING_DEFS.house, 0, s.x + 4.4, s.z + dz, 0);
    let titan = -1;
    game.events.on('spawned', (e) => {
      if (e.def.id === 'titan') titan = e.entity;
    });
    run(game, BUILDING_DEFS.mechbay.production.interval * 1.2);
    expect(titan).toBeGreaterThanOrEqual(0);
    const t = game.world.req(titan, Transform);
    // Clear of every building by its own radius.
    for (const e of game.world.query(Building, Transform, Collider)) {
      const bt = game.world.req(e, Transform);
      expect(Math.hypot(bt.x - t.x, bt.z - t.z)).toBeGreaterThan(game.world.req(e, Collider).radius + UNIT_DEFS.titan.radius - 0.2);
    }
  });

  it('idle units turn to face the enemy while holding', () => {
    const game = quietGame();
    const s = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, s.x + 20, s.z);
    game.setStance(0, 'hold');
    game.setRally(0, { x: s.x + 20, z: s.z });
    game.world.req(e, Transform).heading = Math.PI; // facing home
    run(game, 10);
    const enemy = game.field.baseSites[1];
    const t = game.world.req(e, Transform);
    const want = Math.atan2(-(enemy.z - t.z), enemy.x - t.x);
    expect(Math.abs(Math.atan2(Math.sin(t.heading - want), Math.cos(t.heading - want)))).toBeLessThan(0.3);
  });
});

