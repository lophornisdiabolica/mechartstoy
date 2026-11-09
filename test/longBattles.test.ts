import { describe, expect, it } from 'vitest';
import { Health } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { blastCrater, CRATER_FLOOR } from '../src/game/craters';
import { Crossings } from '../src/game/commander/crossings';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** A flat, dry, empty map. */
function flatGame(seed = 4): Game {
  const s = defaultSettings();
  s.map.hills = 0;
  s.map.water = 0;
  s.map.towns = 0;
  s.map.outposts = 0;
  s.map.forest = 0;
  s.armies.taskForces = 0;
  return new Game(seed, { settings: s, populate: false });
}

/** Flood a band right across the map between the bases, `depth` under the water. */
function moat(game: Game, depth: number, half = 2.5): void {
  const f = game.field;
  for (let z = f.bounds.minZ; z <= f.bounds.maxZ; z += 1) f.reshape(0, z, half, () => f.seaLevel - depth);
}

describe('craters', () => {
  it('a super unit blowing up leaves a crater with a rim, and churned earth', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    field.reshape(10, 5, 9, () => field.seaLevel + 2);
    const before = field.heightAt(10, 5);
    const titan = spawnUnit(world, ctx, UNIT_DEFS.titan, 0, 10, 5);
    let craters = 0;
    ctx.events.on('crater', () => craters++);
    world.req(titan, Health).hp = 0;
    run(game, 0.2);
    expect(craters).toBe(1);
    expect(field.heightAt(10, 5)).toBeLessThan(before - 0.5);
    // The rim stands a little proud of the ground round it.
    const rim = 2.2 + UNIT_DEFS.titan.radius * 0.6 + 0.4;
    expect(field.heightAt(10 + rim, 5)).toBeGreaterThan(before);
    expect(field.groundAt(10, 5).id).toBe('earth');
  });

  it('an ordinary tank leaves none, and none at all with the setting off', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    const before = field.heightAt(10, 5);
    const tank = spawnUnit(world, ctx, UNIT_DEFS.tank, 0, 10, 5);
    world.req(tank, Health).hp = 0;
    run(game, 0.2);
    expect(field.heightAt(10, 5)).toBe(before);

    const s = defaultSettings();
    s.map.craters = false;
    const off = new Game(4, { settings: s, populate: false });
    const h = off.field.heightAt(-5, 3);
    const titan = spawnUnit(off.world, off.ctx, UNIT_DEFS.titan, 0, -5, 3);
    off.world.req(titan, Health).hp = 0;
    run(off, 0.2);
    expect(off.field.heightAt(-5, 3)).toBe(h);
  });

  it('on low ground they flood, but never deeper than engineers can fill', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    field.reshape(0, 0, 8, () => field.seaLevel + 0.2);
    for (let n = 0; n < 6; n++) blastCrater(world, ctx, 0, 0, 3.4, 0.7);
    expect(field.isWater(0, 0)).toBe(true);
    expect(field.heightAt(0, 0)).toBeGreaterThanOrEqual(field.seaLevel - CRATER_FLOOR - 1e-4);
  });
});

describe('crossings', () => {
  it('finds no gap on fresh maps, and one where shallow water cuts the way', () => {
    for (const water of [0, 0.5, 1]) {
      for (const seed of [1, 2, 3]) {
        const s = defaultSettings();
        s.map.water = water;
        const game = new Game(seed, { settings: s, populate: false });
        const [a, b] = game.field.baseSites;
        expect(new Crossings().gap(game.ctx, a, b)).toBeNull();
      }
    }
    const game = flatGame();
    moat(game, 0.3);
    const [a, b] = game.field.baseSites;
    const gap = new Crossings().gap(game.ctx, a, b);
    expect(gap).not.toBeNull();
    expect(gap!.water).toBe(true);
    // The open ground either side of it, home side first.
    expect(gap!.before.x).toBeLessThan(0);
    expect(gap!.after.x).toBeGreaterThan(0);
  });

  it('leaves water too deep to fill alone', () => {
    const game = flatGame();
    moat(game, 1.2);
    const [a, b] = game.field.baseSites;
    expect(new Crossings().gap(game.ctx, a, b)).toBeNull();
  });

  it("any side's engineers bridge the gap and fill it in until there's a way across again", () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    moat(game, 0.3, 4.5);
    const home = field.baseSites[0];
    for (const dz of [-1, 1]) spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x + 20, home.z + dz);
    const eng = ctx.commander.engineers;
    expect(eng.crossings.gap(ctx, field.baseSites[0], field.baseSites[1])).not.toBeNull();
    let bridged = false;
    for (let t = 0; t < 400 && eng.crossings.gap(ctx, field.baseSites[0], field.baseSites[1]); t += 5) {
      run(game, 5);
      bridged ||= eng.spansOf(0) > 0;
    }
    expect(bridged).toBe(true);
    expect(eng.crossings.gap(ctx, field.baseSites[0], field.baseSites[1])).toBeNull();
    expect(eng.works.some((w) => w.kind === 'fill' && w.side === 0)).toBe(true);
  }, 120000);
});

describe('repairs', () => {
  it('an engineer with nothing to build repairs a damaged tank out of the fighting', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    const home = field.baseSites[0];
    spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x, home.z);
    const tank = spawnUnit(world, ctx, UNIT_DEFS.tank, 0, home.x + 6, home.z + 3);
    const h = world.req(tank, Health);
    h.hp = h.max * 0.5;
    h.hurtAt = -100;
    let sparks = 0;
    ctx.events.on('repair', () => sparks++);
    run(game, 40);
    expect(h.hp).toBeGreaterThan(h.max * 0.6);
    expect(sparks).toBeGreaterThan(0);
  }, 60000);

  it("doesn't repair one that was just hit", () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    const home = field.baseSites[0];
    spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x, home.z);
    const tank = spawnUnit(world, ctx, UNIT_DEFS.tank, 0, home.x + 6, home.z + 3);
    const h = world.req(tank, Health);
    h.hp = h.max * 0.5;
    for (let t = 0; t < 20; t += 1) {
      h.hurtAt = world.time;
      run(game, 1);
    }
    expect(h.hp).toBe(h.max * 0.5);
  }, 60000);
});
