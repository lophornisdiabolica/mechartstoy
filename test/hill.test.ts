import { describe, expect, it } from 'vitest';
import { OutpostPart } from '../src/game/components';
import { Game } from '../src/game/game';
import { hillOf, hillUrgency, teamHeld } from '../src/game/hill';
import { capture } from '../src/game/outposts';
import { BattleSettings, defaultFaction, defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import * as D from '../src/core/dmath';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function hillSettings(sides = 2): BattleSettings {
  const s = defaultSettings();
  s.mode = 'hill';
  s.armies.hillHold = 60;
  s.factions = Array.from({ length: sides }, (_, i) => defaultFaction(i));
  return s;
}

/** Bases and the hill, but no armies or production, to test the clock in isolation. */
function bareGame(seed = 3, sides = 2): Game {
  return new Game(seed, { settings: hillSettings(sides), autoSpawn: false });
}

describe('king of the hill', () => {
  it('puts the hill first, about as far from every base', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const sides of [2, 3, 4]) {
        const game = new Game(seed, { settings: hillSettings(sides), populate: false, autoSpawn: false });
        const hill = hillOf(game.ctx)!;
        expect(hill.kind.id).toBe('hill');
        expect(game.ctx.hill!.outpost).toBe(0);
        const d = game.field.baseSites.map((b) => D.hypot(b.x - hill.x, b.z - hill.z));
        expect(Math.max(...d) - Math.min(...d), `seed ${seed}, ${sides} sides: ${d.map(Math.round)}`).toBeLessThan(Math.min(...d) * 0.25);
      }
    }
  });

  it('is bare ground round a beacon: no towers or guards', () => {
    const game = bareGame();
    const parts = [...game.world.query(OutpostPart)].filter((e) => game.world.req(e, OutpostPart).outpost === game.ctx.hill!.outpost);
    expect(parts.map((e) => game.ctx.buildings && game.world.get(e, OutpostPart) && e).length).toBe(2); // the post and the beacon
  });

  it('other modes have no hill', () => {
    const s = defaultSettings();
    s.mode = 'conquest';
    const game = new Game(3, { settings: s, populate: false, autoSpawn: false });
    expect(game.ctx.hill).toBeNull();
    expect(game.ctx.outposts.some((o) => o.kind.id === 'hill')).toBe(false);
  });

  it('runs the holder’s clock, stops it while enemies are near, and ends the battle once held long enough', () => {
    const game = bareGame();
    const hill = hillOf(game.ctx)!;
    run(game, 5);
    expect(teamHeld(game.ctx, 0)).toBe(0);
    capture(game.world, game.ctx, hill, 0);
    game.setStance(0, 'hold');
    game.setStance(1, 'hold');
    run(game, 20);
    expect(teamHeld(game.ctx, 0)).toBeGreaterThan(19);
    expect(hillUrgency(game.ctx, 1)).toBeGreaterThan(0.3);
    expect(hillUrgency(game.ctx, 0)).toBe(0);
    // An enemy tank at the edge of the ring stops the clock.
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, hill.x + 12, hill.z);
    run(game, 1);
    const paused = teamHeld(game.ctx, 0);
    run(game, 5);
    expect(game.ctx.hill!.contested).toBe(true);
    expect(teamHeld(game.ctx, 0)).toBeCloseTo(paused, 0);
    game.world.destroy(tank);
    run(game, 45);
    expect(game.ctx.outcome?.team).toBe(game.ctx.sides.teams[0]);
    expect(game.ctx.outcome?.winners).toEqual([0]);
  });
});
