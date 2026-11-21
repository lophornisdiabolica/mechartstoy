import { describe, expect, it } from 'vitest';
import { Ai, Armed, Building, Faction, Health } from '../src/game/components';
import { countByCategory } from '../src/game/caps';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function emptyGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

describe('Sabre: blade mechs', () => {
  it('duelists take half a vehicle slot each', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    for (let i = 0; i < 4; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.duelist, 0, base.x + i * 2, base.z);
    spawnUnit(game.world, game.ctx, UNIT_DEFS.reaver, 0, base.x, base.z + 5);
    expect(countByCategory(game.world, game.ctx.sides.count)[0].vehicle).toBe(4 * 0.5 + 1.5);
  });

  it('shoots what it cannot reach with the gun on its head, and cuts what it can', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, UNIT_DEFS.duelist, 0, base.x, base.z);
    // Held in place, as if across a river from its target.
    game.world.remove(e, Ai);
    const far = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 7, base.z);
    game.world.remove(far, Ai);
    game.world.req(far, Armed).cooldown = Infinity;
    let shots = 0;
    let blows = 0;
    game.events.on('fired', (f) => f.entity === e && shots++);
    game.events.on('struck', (s) => s.entity === e && blows++);
    run(game, 4);
    expect(shots).toBeGreaterThan(0);
    expect(blows).toBe(0);
    expect(game.world.req(far, Health).hp).toBeLessThan(UNIT_DEFS.tank.hp);
  });

  it('closes to contact and lands blows when it can move', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, UNIT_DEFS.duelist, 0, base.x, base.z);
    const target = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 9, base.z);
    game.world.remove(target, Ai);
    game.world.req(target, Armed).cooldown = Infinity;
    let blows = 0;
    game.events.on('struck', (s) => s.entity === e && blows++);
    run(game, 8);
    expect(blows).toBeGreaterThan(0);
  });

  it('builds a duel hall in its base', () => {
    const s = defaultSettings();
    s.factions[0].doctrine = 'sabre';
    const game = new Game(4, { settings: s });
    run(game, 15);
    const hall = [...game.world.query(Building, Faction)].find((b) => game.world.req(b, Faction).id === 0 && game.world.req(b, Building).def.id === 'duelHall');
    expect(hall).toBeDefined();
  }, 30000);
});
