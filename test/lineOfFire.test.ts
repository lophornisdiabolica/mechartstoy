import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Armed, NEUTRAL, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { aimPoint, clearShot, traceShot } from '../src/game/lineOfFire';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function quietGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

/** A unit that stays where it's put (no AI), but still aims and shoots. */
function puppet(game: Game, unit: keyof typeof UNIT_DEFS, faction: number, x: number, z: number): number {
  const e = spawnUnit(game.world, game.ctx, UNIT_DEFS[unit], faction, x, z);
  game.world.remove(e, Ai);
  return e;
}

/** A shooter, a target 12 to its east, and (optionally) a tall building halfway between, on a flat base pad. */
function range(game: Game, wall: boolean) {
  const base = game.field.baseSites[0];
  const shooter = puppet(game, 'tank', 0, base.x - 6, base.z);
  const target = puppet(game, 'tank', 1, base.x + 6, base.z);
  const building = wall ? spawnBuilding(game.world, game.ctx, BUILDING_DEFS.block, NEUTRAL, base.x, base.z, 0) : null;
  game.step(DT); // index everything
  return { base, shooter, target, building };
}

function muzzle(game: Game, e: number) {
  const t = game.world.req(e, Transform);
  return { x: t.x, y: t.y + game.world.req(e, Armed).weapon.muzzleHeight, z: t.z };
}

describe('line of fire', () => {
  it('stops shots at a building in the way', () => {
    const game = quietGame();
    const { shooter, target, building } = range(game, true);
    const trace = traceShot(game.world, game.ctx, muzzle(game, shooter), aimPoint(game.world, target), 20, shooter, 0, target);
    expect(trace.hit).toBe(building);
    expect(trace.stoppedBy).toBe('building');
    expect(clearShot(game.world, game.ctx, muzzle(game, shooter), target, shooter, 0)).toBe(false);
  });

  it('hits the target when nothing is in the way, and the ground past it on a miss', () => {
    const game = quietGame();
    const { shooter, target } = range(game, false);
    const from = muzzle(game, shooter);
    expect(traceShot(game.world, game.ctx, from, aimPoint(game.world, target), 20, shooter, 0, target).hit).toBe(target);
    // Aimed well wide of the target: carries on until it comes down.
    const tt = game.world.req(target, Transform);
    const miss = traceShot(game.world, game.ctx, from, { x: tt.x, y: tt.y + 0.5, z: tt.z + 6 }, 20, shooter, 0, target);
    expect(miss.hit).toBeNull();
    expect(miss.stoppedBy === 'ground' || miss.stoppedBy === 'nothing').toBe(true);
  });

  it('lets shots pass through allies but not enemies in the way', () => {
    const game = quietGame();
    const { base, shooter, target } = range(game, false);
    const ally = puppet(game, 'tank', 0, base.x, base.z);
    game.step(DT);
    const from = muzzle(game, shooter);
    expect(traceShot(game.world, game.ctx, from, aimPoint(game.world, target), 20, shooter, 0, target).hit).toBe(target);
    game.world.destroy(ally);
    const enemy = puppet(game, 'tank', 1, base.x, base.z);
    game.step(DT);
    expect(traceShot(game.world, game.ctx, muzzle(game, shooter), aimPoint(game.world, target), 20, shooter, 0, target).hit).toBe(enemy);
    // An enemy in the way still counts as a clear shot: it just takes the hit.
    expect(clearShot(game.world, game.ctx, muzzle(game, shooter), target, shooter, 0)).toBe(true);
  });

  it('holds fire at a target behind a building', () => {
    const game = quietGame();
    const { shooter } = range(game, true);
    let shots = 0;
    game.events.on('fired', (ev) => {
      if (ev.entity === shooter) shots++;
    });
    run(game, 10);
    expect(shots).toBe(0);
    expect(game.world.req(shooter, Armed).blocked).toBe(true);
  });

  it('goes round to a spot with a clear shot, then wins the fight', () => {
    const game = quietGame();
    const base = game.field.baseSites[0];
    const target = puppet(game, 'tank', 1, base.x + 6, base.z);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.block, NEUTRAL, base.x, base.z, 0);
    const shooter = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x - 6, base.z);
    // The target can't shoot back, so the only question is whether the shooter gets a line.
    game.world.req(target, Armed).weapon = { ...UNIT_DEFS.tank.weapon, range: 0 };
    run(game, 40);
    expect(game.world.isAlive(target) && game.world.has(target, Armed)).toBe(false);
    const t = game.world.req(shooter, Transform);
    expect(Math.abs(t.z - base.z)).toBeGreaterThan(1);
  });
});
