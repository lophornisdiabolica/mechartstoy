import { describe, expect, it } from 'vitest';
import { Ai, Armed, Transform } from '../src/game/components';
import { BUILDING_DEFS } from '../src/game/buildings';
import { FROZEN } from '../src/game/frost';
import { Game } from '../src/game/game';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

describe("Verdant's tangle", () => {
  it('a glasshouse vine grows tangle under an enemy, and it drags them', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.glasshouse, 0, base.x, base.z, 0, false);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    game.world.remove(tank, Ai);
    game.world.req(tank, Armed).cooldown = Infinity;
    let tangled = false;
    for (let i = 0; i < 20 / DT && !tangled; i++) {
      game.step(DT);
      const t = game.world.req(tank, Transform);
      tangled = game.ctx.tangle.at(t.x, t.z) > FROZEN;
    }
    expect(tangled).toBe(true);
    const t = game.world.req(tank, Transform);
    // Slower in it than on frost, and it never touches the vine's own side.
    expect(game.ctx.tangle.paceAt(game.ctx, t.x, t.z, 1)).toBeLessThan(0.5);
    expect(game.ctx.tangle.paceAt(game.ctx, t.x, t.z, 0)).toBe(1);
  });

  it('withers away in a few seconds', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    game.ctx.tangle.add(base.x, base.z, 1.1, 5, 0);
    expect(game.ctx.tangle.at(base.x, base.z)).toBeGreaterThan(FROZEN);
    for (let i = 0; i < 12 / DT; i++) game.step(DT);
    expect(game.ctx.tangle.at(base.x, base.z)).toBeLessThan(FROZEN);
  });
});
