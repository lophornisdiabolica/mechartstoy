import { describe, expect, it } from 'vitest';
import { Building, Guard, OutpostPart, Transform } from '../src/game/components';
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
    // Only the beacon, standing in the middle as the hill's post.
    expect(parts.length).toBe(1);
    const t = game.world.req(parts[0], Transform);
    expect(game.world.req(parts[0], Building).def.id).toBe('hillBeacon');
    expect(D.hypot(t.x - game.ctx.outposts[game.ctx.hill!.outpost].x, t.z - game.ctx.outposts[game.ctx.hill!.outpost].z)).toBeLessThan(0.01);
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
    // (The other side's starting army may be on its way to the hill: give it time to turn back.)
    run(game, 6);
    const start = teamHeld(game.ctx, 0);
    run(game, 20);
    expect(teamHeld(game.ctx, 0) - start).toBeGreaterThan(19);
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
  it('keeps a challenger from staying home for an attack that is only the holder walking round the hill', () => {
    const game = new Game(4, { settings: hillSettings() });
    for (let k = 0; k < 120; k++) {
      run(game, 1);
      for (const [, plan] of game.ctx.offensive.plansState) expect(plan.state).not.toBe('defending');
    }
  });

  it('throws everything at the hill once an enemy is nearly there', () => {
    const game = bareGame();
    const hill = hillOf(game.ctx)!;
    const calls: number[] = [];
    game.events.on('hillAllIn', (e) => calls.push(e.faction));
    capture(game.world, game.ctx, hill, 0);
    run(game, 2);
    expect(game.ctx.offensive.allIn(1)).toBe(false);
    // Ten seconds from winning: too little for anyone to get there, so the other team goes now.
    game.ctx.hill!.held[0] = game.settings.armies.hillHold - 10;
    run(game, 2);
    expect(game.ctx.offensive.allIn(1)).toBe(true);
    expect(game.ctx.offensive.attacking(1, game.world.time)).toBe(true);
    expect(game.ctx.offensive.allIn(0)).toBe(false);
    run(game, 3);
    expect(calls).toEqual([1]);
  });
});

describe('patrols', () => {
  it('walk round an outpost without stopping and starting', () => {
    const s = defaultSettings();
    s.mode = 'conquest';
    s.map.outposts = 4;
    const game = new Game(5, { settings: s });
    run(game, 30);
    const guards = [...game.world.query(Guard, Transform)];
    expect(guards.length).toBeGreaterThan(0);
    let ticks = 0;
    let still = 0;
    const last = new Map(guards.map((e) => [e, { ...game.world.req(e, Transform) }]));
    for (let i = 0; i < 20 / DT; i++) {
      game.step(DT);
      for (const e of guards) {
        if (!game.world.isAlive(e)) continue;
        const t = game.world.req(e, Transform);
        const p = last.get(e)!;
        ticks++;
        if (D.hypot(t.x - p.x, t.z - p.z) < 1e-4) still++;
        last.set(e, { ...t });
      }
    }
    expect(still / ticks).toBeLessThan(0.05);
  });
});
