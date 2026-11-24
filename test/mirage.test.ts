import { describe, expect, it } from 'vitest';
import { Ai, Armed, Decoy, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS, UnitDef } from '../src/game/units';

const DT = 1 / 30;

function emptyGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: true });
}

function dummy(game: Game, def: UnitDef, faction: number, x: number, z: number): number {
  const e = spawnUnit(game.world, game.ctx, def, faction, x, z);
  game.world.remove(e, Ai);
  game.world.req(e, Armed).cooldown = Infinity;
  return e;
}

function holograms(game: Game): { x: number; z: number }[] {
  return [...game.world.query(Decoy, Transform)].map((e) => game.world.req(e, Transform));
}

describe('Mirage: projectors', () => {
  it('a projector truck with no enemy in sight throws up nothing', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    dummy(game, UNIT_DEFS.projectorTruck, 0, base.x, base.z);
    for (let i = 0; i < 30 / DT; i++) game.step(DT);
    expect(holograms(game).length).toBe(0);
  });

  it('once it sees an enemy, its holograms go up between it and the enemy', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    dummy(game, UNIT_DEFS.projectorTruck, 0, base.x, base.z);
    dummy(game, { ...UNIT_DEFS.tank, hp: 100000 }, 1, base.x + 14, base.z);
    let seen: { x: number; z: number }[] = [];
    for (let i = 0; i < 16 / DT && !seen.length; i++) {
      game.step(DT);
      seen = holograms(game).map(({ x, z }) => ({ x, z }));
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const h of seen) expect(h.x).toBeGreaterThan(base.x + 2);
  });
});
