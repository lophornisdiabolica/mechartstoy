import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Mover, Transform } from '../src/game/components';
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

