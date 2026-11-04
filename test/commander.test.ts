import { describe, expect, it } from 'vitest';
import { PICTURE_INTERVAL } from '../src/game/commander/commander';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

describe('commander picture', () => {
  it('knows every base, outpost and town, and finds them while the map loads', () => {
    const game = new Game(7);
    const kinds = (k: string) => game.ctx.commander.places.filter((p) => p.kind === k).length;
    expect(kinds('base')).toBe(game.field.baseSites.length);
    expect(kinds('outpost')).toBe(game.field.outpostSites.length);
    expect(kinds('town')).toBe(game.field.townSites.length);
    for (const p of game.ctx.commander.places) expect(game.field.contains(p.x, p.z)).toBe(true);
  });

  it('counts each side’s army and what it faces', () => {
    const s = defaultSettings();
    s.map.outposts = 0;
    const game = new Game(3, { settings: s, populate: false, autoSpawn: false });
    const b = game.field.baseSites[0];
    for (let i = 0; i < 4; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + i * 3, b.z);
    spawnUnit(game.world, game.ctx, UNIT_DEFS.flakTank, 1, game.field.baseSites[1].x, game.field.baseSites[1].z);
    run(game, PICTURE_INTERVAL + DT);
    const [red, blue] = game.ctx.commander.sides;
    expect(red.mix.vehicle).toBe(4);
    expect(red.ground).toBeGreaterThan(0);
    expect(red.air).toBe(0);
    expect(red.enemyMix.antiAir).toBe(1);
    expect(blue.antiAir).toBeGreaterThan(0);
    expect(Math.abs(red.armyX! - b.x)).toBeLessThan(12);
    const strength = game.ctx.commander.strength;
    expect(strength.near(strength.ground, 0, b.x, b.z, 12)).toBeGreaterThan(0);
    expect(strength.near(strength.ground, 1, b.x, b.z, 12)).toBe(0);
  });

  it('states today’s team plan: mass at the rally point, then push the enemy base', () => {
    const game = new Game(11);
    run(game, PICTURE_INTERVAL + DT);
    const goals = game.ctx.commander.sides[0].goals;
    const push = goals.find((g) => g.kind === 'push');
    expect(push?.target).toBe(1);
    expect(push && Math.hypot(push.x - game.field.baseSites[1].x, push.z - game.field.baseSites[1].z)).toBe(0);
    expect(goals.every((g) => g.score >= 0 && g.score <= 1)).toBe(true);
  });
});

describe('task forces', () => {
  /** Two armies of tanks at home, two empty outposts, nothing built. */
  function setup(share: number): Game {
    const s = defaultSettings();
    s.map.outposts = 2;
    s.armies.taskForces = share;
    const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
    for (const f of [0, 1]) {
      const b = game.field.baseSites[f];
      for (let i = 0; i < 8; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, f, b.x + (i % 4) * 3 - 4, b.z + Math.floor(i / 4) * 3);
    }
    return game;
  }

  it('sends a few squads to take an outpost between attacks, and they take it', () => {
    const game = setup(0.4);
    run(game, PICTURE_INTERVAL * 2);
    const forces = game.ctx.commander.taskForces.forces;
    expect(forces.length).toBeGreaterThan(0);
    for (const tf of forces) {
      // Within its share of the army, and short of the whole army.
      expect(tf.squads.length).toBeGreaterThan(0);
      expect(tf.squads.length).toBeLessThan(8);
    }
    expect(game.ctx.commander.sides[forces[0].side].goals.some((g) => g.kind === 'take' && g.force === forces[0].id)).toBe(true);
    run(game, 90);
    expect(game.ctx.outposts.some((o) => o.owner >= 0)).toBe(true);
  });

  it('sends none when off, or when the player has planted a rally flag', () => {
    const off = setup(0);
    run(off, 10);
    expect(off.ctx.commander.taskForces.forces).toEqual([]);
    const flagged = setup(0.4);
    for (const f of [0, 1]) flagged.setRally(f, flagged.field.baseSites[f]);
    run(flagged, 10);
    expect(flagged.ctx.commander.taskForces.forces).toEqual([]);
  });
});

describe('jobs that suit the unit', () => {
  function empty(): Game {
    const s = defaultSettings();
    s.map.outposts = 2;
    s.armies.taskForces = 0;
    return new Game(5, { settings: s, populate: false, autoSpawn: false });
  }

  it('sends flak to cover an outpost of its side that enemy aircraft are over', () => {
    const game = empty();
    const o = game.ctx.outposts[0];
    o.owner = 0;
    const b = game.field.baseSites[0];
    const flak = [0, 1].map((i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.flakTank, 0, b.x + i * 3, b.z));
    for (let i = 0; i < 3; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.gunship, 1, o.x + i * 2, o.z + 3);
    run(game, PICTURE_INTERVAL + DT);
    const jobs = flak.map((e) => game.ctx.commander.roles.jobFor(e));
    expect(jobs.some((j) => j?.kind === 'cover' && Math.hypot(j.x - o.x, j.z - o.z) < 1)).toBe(true);
    expect(game.ctx.commander.sides[0].jobs.cover).toBeGreaterThan(0);
  });

  it('keeps vehicles round the super unit on an attack', () => {
    const game = empty();
    game.ctx.offensive.attacking = () => true;
    const b = game.field.baseSites[0];
    const titan = spawnUnit(game.world, game.ctx, UNIT_DEFS.titan, 0, b.x, b.z);
    const tanks = [0, 1, 2, 3, 4].map((i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + 4 + i * 3, b.z));
    run(game, PICTURE_INTERVAL + DT);
    const escorts = tanks.filter((e) => game.ctx.commander.roles.jobFor(e)?.lead === titan);
    expect(escorts.length).toBe(3);
  });

  it('gives no jobs under a rally flag', () => {
    const game = empty();
    game.ctx.offensive.attacking = () => true;
    game.setRally(0, game.field.baseSites[0]);
    const b = game.field.baseSites[0];
    spawnUnit(game.world, game.ctx, UNIT_DEFS.titan, 0, b.x, b.z);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + 4, b.z);
    run(game, PICTURE_INTERVAL + DT);
    expect(game.ctx.commander.roles.jobFor(tank)).toBeUndefined();
  });
});
