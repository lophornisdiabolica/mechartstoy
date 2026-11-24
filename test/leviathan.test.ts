import { describe, expect, it } from 'vitest';
import { Ai, FallingBack, Health, Projectile, Renderable, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import * as D from '../src/core/dmath';

const DT = 1 / 30;

function lonely(seed = 11) {
  return new Game(seed, { populate: false, autoSpawn: true });
}

describe('the Leviathan', () => {
  it('grows no faster than its cap a minute, however much it eats', () => {
    const game = lonely();
    const base = game.field.baseSites[0];
    const beast = spawnUnit(game.world, game.ctx, UNIT_DEFS.leviathan, 0, base.x, base.z);
    game.world.remove(beast, Ai);
    for (let i = 0; i < 6; i++) game.ctx.wreckage.add(base.x, base.z, 4, 10);
    for (let i = 0; i < 60 / DT; i++) game.step(DT);
    const grows = UNIT_DEFS.leviathan.grows;
    const scale = game.world.req(beast, Renderable).scale;
    expect(scale).toBeGreaterThan(grows.from);
    expect(scale).toBeLessThanOrEqual(grows.from + grows.perMinute + 1e-6);
  });

  it('falls back home when beaten, mends there, and goes back out', () => {
    const game = lonely();
    const base = game.field.baseSites[0];
    const other = game.field.baseSites[1];
    // Out on the field, a third of the way to the enemy.
    const x = base.x + (other.x - base.x) * 0.35;
    const z = base.z + (other.z - base.z) * 0.35;
    const beast = spawnUnit(game.world, game.ctx, UNIT_DEFS.leviathan, 0, x, z);
    game.step(DT);
    const h = game.world.req(beast, Health);
    h.hp = h.max * 0.2;
    const from = D.hypot(x - base.x, z - base.z);
    let fell = false;
    let closest = Infinity;
    let mended = false;
    for (let i = 0; i < 240 / DT && !mended; i++) {
      game.step(DT);
      if (game.world.has(beast, FallingBack)) fell = true;
      const t = game.world.req(beast, Transform);
      closest = Math.min(closest, D.hypot(t.x - base.x, t.z - base.z));
      mended = fell && !game.world.has(beast, FallingBack);
    }
    expect(fell).toBe(true);
    expect(closest).toBeLessThan(Math.min(from, 10));
    expect(mended).toBe(true);
    expect(h.hp / h.max).toBeGreaterThanOrEqual(0.89);
  });

  it('throws a ring of spines all round when enemies crowd it', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    const beast = spawnUnit(game.world, game.ctx, UNIT_DEFS.leviathan, 0, base.x, base.z);
    game.world.remove(beast, Ai);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 4, base.z);
    game.world.remove(tank, Ai);
    let most = 0;
    for (let i = 0; i < 12 / DT; i++) {
      game.step(DT);
      let spines = 0;
      for (const p of game.world.query(Projectile)) if (game.world.req(p, Projectile).kind === 'spine') spines++;
      most = Math.max(most, spines);
    }
    expect(most).toBe(UNIT_DEFS.leviathan.mounts[1].weapon.nova);
  });
});
