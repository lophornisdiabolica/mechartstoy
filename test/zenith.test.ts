import { describe, expect, it } from 'vitest';
import { Ai, Armed } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { BUILDING_DEFS } from '../src/game/buildings';

const DT = 1 / 30;

/** Trigger pulls by the Lance Platform in 30 s at a tank 16 away, with or without one of its own buildings in between. */
function lanceShots(cover: boolean): number {
  const game = new Game(11, { populate: false, autoSpawn: false });
  const base = game.field.baseSites[0];
  const lance = spawnUnit(game.world, game.ctx, UNIT_DEFS.lancePlatform, 0, base.x, base.z);
  game.world.remove(lance, Ai);
  const tank = spawnUnit(game.world, game.ctx, { ...UNIT_DEFS.tank, hp: 1e6 }, 1, base.x + 16, base.z);
  game.world.remove(tank, Ai);
  game.world.req(tank, Armed).cooldown = Infinity;
  if (cover) spawnBuilding(game.world, game.ctx, BUILDING_DEFS.barracksBlock, 0, base.x + 8, base.z, 0);
  let shots = 0;
  let last = -Infinity;
  for (let i = 0; i < 30 / DT; i++) {
    game.step(DT);
    const fired = game.world.req(lance, Armed).firedAt;
    if (fired !== last) {
      shots++;
      last = fired;
    }
  }
  return shots;
}

describe('Zenith: orbital calls', () => {
  it('the Lance Platform calls its strikes down whatever its dish is pointing at, and over cover', () => {
    expect(lanceShots(false)).toBeGreaterThanOrEqual(3);
    expect(lanceShots(true)).toBeGreaterThanOrEqual(3);
  });
});
