import { describe, expect, it } from 'vitest';
import { Ai, Armed, Arsenal, Health, Mover, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import * as D from '../src/core/dmath';

const DT = 1 / 30;

describe('weapons that point different ways (UnitDef.alternates)', () => {
  it('the Leviathan wheels round between its fire breath and its tail whip', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    const beast = spawnUnit(game.world, game.ctx, UNIT_DEFS.leviathan, 0, base.x, base.z);
    game.world.req(beast, Mover).speed = 0;
    // A sturdy enemy close behind it, that doesn't move or shoot back.
    const t = game.world.req(beast, Transform);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, t.x - D.cos(t.heading) * 4, t.z + D.sin(t.heading) * 4);
    game.world.remove(tank, Ai);
    // Pinned where it is, so the whip's knock doesn't throw it out of reach.
    game.world.remove(tank, Mover);
    game.world.req(tank, Armed).cooldown = Infinity;
    game.world.req(tank, Health).hp = game.world.req(tank, Health).max = 1e6;
    const whip = game.world.req(beast, Armed);
    const breath = game.world.req(beast, Arsenal).arms[0];
    const order: string[] = [];
    let whipAt = whip.firedAt;
    let breathAt = breath.firedAt;
    for (let i = 0; i < 30 / DT; i++) {
      game.step(DT);
      if (whip.firedAt !== whipAt) order.push('whip');
      if (breath.firedAt !== breathAt) order.push('breath');
      whipAt = whip.firedAt;
      breathAt = breath.firedAt;
    }
    const whips = order.filter((o) => o === 'whip').length;
    const breaths = order.filter((o) => o === 'breath').length;
    expect(whips).toBeGreaterThanOrEqual(3);
    expect(breaths).toBeGreaterThanOrEqual(3);
    // They take turns (the whip reloads faster, so it may lash twice between breaths, never more).
    let swaps = 0;
    for (let i = 1; i < order.length; i++) if (order[i] !== order[i - 1]) swaps++;
    expect(swaps / (order.length - 1)).toBeGreaterThan(0.5);
    expect(order.join(' ')).not.toContain('whip whip whip');
    expect(order.join(' ')).not.toContain('breath breath');
  });
});
