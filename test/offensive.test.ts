import { describe, expect, it } from 'vitest';
import { Health } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { isAttacking } from '../src/game/tide';
import { UNIT_DEFS } from '../src/game/units';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** An empty battlefield (no buildings, no production), both sides told to hold so armies stay put. */
function emptyGame(seed = 3): Game {
  const s = defaultSettings();
  s.map.outposts = 0;
  const game = new Game(seed, { settings: s, populate: false, autoSpawn: false });
  game.setStance(0, 'hold');
  game.setStance(1, 'hold');
  return game;
}

/** `n` tanks at a side's base. */
function army(game: Game, faction: number, n: number): number[] {
  const b = game.field.baseSites[faction];
  return Array.from({ length: n }, (_, i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, faction, b.x + (i % 8) * 2.5 - 9, b.z + Math.floor(i / 8) * 2.5 - 7));
}

describe('readiness', () => {
  it('is the default, and a side masses until it has an army before attacking', () => {
    const game = emptyGame();
    const { offensive } = game.ctx;
    expect(game.settings.armies.attackTiming).toBe('readiness');
    army(game, 0, 15);
    run(game, 3);
    expect(offensive.attacking(0, game.world.time)).toBe(false);
    expect(offensive.plan(0).state).toBe('massing');
    expect(offensive.plan(0).ready).toBeLessThan(0.5);
    army(game, 0, 35);
    run(game, 2);
    expect(offensive.attacking(0, game.world.time)).toBe(true);
    expect(offensive.plan(0).target).toBe(1);
  });

  it('waits while the enemy base is as strong, but grows impatient', () => {
    const game = emptyGame();
    const { offensive } = game.ctx;
    army(game, 0, 45);
    army(game, 1, 45);
    run(game, 5);
    expect(offensive.attacking(0, game.world.time) || offensive.attacking(1, game.world.time)).toBe(false);
    expect(offensive.margin(0)).toBeGreaterThan(offensive.margin(200));
    run(game, 150);
    const attackers = [0, 1].filter((f) => offensive.attacking(f, game.world.time));
    expect(attackers.length).toBe(1);
    // The side being attacked stays home to meet it.
    expect(offensive.plan(1 - attackers[0]).state).toBe('defending');
  });

  it('falls back once the attack is spent, and regroups before the next', () => {
    const game = emptyGame();
    const { offensive } = game.ctx;
    const tanks = army(game, 0, 50);
    run(game, 2);
    expect(offensive.attacking(0, game.world.time)).toBe(true);
    const attack = offensive.attack(0, game.world.time);
    // Lose most of the army; units built since don't count.
    for (const e of tanks.slice(0, 32)) game.world.req(e, Health).hp = 0;
    army(game, 0, 30);
    run(game, 2);
    expect(offensive.plan(0).state).toBe('regrouping');
    expect(offensive.attack(0, game.world.time)).toBe(attack + 1);
    run(game, 20);
    expect(offensive.attacking(0, game.world.time)).toBe(false);
    run(game, 40);
    expect(offensive.attacking(0, game.world.time)).toBe(true);
  });

  it('on the tide setting, attacks follow the tide clock', () => {
    const s = defaultSettings();
    s.armies.attackTiming = 'tide';
    const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
    const { offensive, sides, tide } = game.ctx;
    for (const t of [0, 20, 40, 70, 100, 130]) {
      expect(offensive.attacking(0, t)).toBe(isAttacking(t, sides.phase[0], tide));
      expect(offensive.attacking(1, t)).toBe(isAttacking(t, sides.phase[1], tide));
    }
  });

  it('attack timing round-trips through the link', () => {
    const s = defaultSettings();
    expect(settingsToParams(s).get('attacks')).toBeNull();
    s.armies.attackTiming = 'tide';
    const p = settingsToParams(s);
    expect(p.get('attacks')).toBe('tide');
    expect(settingsFromParams(new URLSearchParams(p.toString())).armies.attackTiming).toBe('tide');
    expect(settingsFromParams(new URLSearchParams('attacks=junk')).armies.attackTiming).toBe('readiness');
  });
});
