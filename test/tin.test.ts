import { describe, expect, it } from 'vitest';
import { Ai, Tilt } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

describe('Tin Soldiers: on a slope', () => {
  it('toy soldiers on foot stand upright where a clockwork tank lies along the ground', () => {
    const game = new Game(11, { populate: false, autoSpawn: true });
    const { field } = game;
    // The steepest open spot on a coarse scan of the map.
    let best = { x: 0, z: 0, slope: 0 };
    for (let x = field.bounds.minX + 10; x < field.bounds.maxX - 10; x += 4) {
      for (let z = field.bounds.minZ + 10; z < field.bounds.maxZ - 10; z += 4) {
        if (field.isWater(x, z) || field.isWater(x + 3, z) || field.isWater(x, z + 3)) continue;
        const slope = Math.hypot(field.heightAt(x + 1.5, z) - field.heightAt(x - 1.5, z), field.heightAt(x, z + 1.5) - field.heightAt(x, z - 1.5)) / 3;
        if (slope > best.slope && slope < 0.6) best = { x, z, slope };
      }
    }
    expect(best.slope).toBeGreaterThan(0.1);
    const soldier = spawnUnit(game.world, game.ctx, UNIT_DEFS.tinSoldier, 0, best.x, best.z);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.clockworkTank, 0, best.x + 3, best.z);
    for (const e of [soldier, tank]) game.world.remove(e, Ai);
    for (let i = 0; i < 60; i++) game.step(1 / 30);
    const lean = (e: number) => Math.abs(game.world.req(e, Tilt).pitch) + Math.abs(game.world.req(e, Tilt).roll);
    expect(lean(soldier)).toBe(0);
    expect(lean(tank)).toBeGreaterThan(0.02);
  });
});
