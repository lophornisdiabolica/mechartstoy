import { describe, expect, it } from 'vitest';
import { Armed, Health } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { blastCrater, CRATER_FLOOR } from '../src/game/craters';
import { Crossings, WIDEN_AFTER } from '../src/game/commander/crossings';

const DT = 1 / 30;
/** How far from an enemy camp a crossing is chosen, at least. */
const DANGER_CLEAR = 20;

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
    expect(field.heightAt(10, 5)).toBeLessThan(before - 0.4);
    // The rim stands a little proud of the ground round it.
    const r = 1.6 + UNIT_DEFS.titan.radius * 0.45;
    let rim = -Infinity;
    for (let d = r; d <= r * 1.6; d += 0.1) rim = Math.max(rim, field.heightAt(10 + d, 5), field.heightAt(10, 5 + d));
    expect(rim).toBeGreaterThan(before);
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

  it('on low ground they flood, but only into ponds', () => {
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

  it("leaves the map's own deep water alone, but not deep water the battle made", () => {
    const own = flatGame();
    moat(own, 1.2);
    // As if the map had been made with it: a river, not a hole.
    own.field.markMade();
    const [a, b] = own.field.baseSites;
    expect(new Crossings().gap(own.ctx, a, b)).toBeNull();

    const made = flatGame();
    moat(made, 3);
    expect(new Crossings().gap(made.ctx, a, b)).not.toBeNull();
  });

  it('a side crosses where its enemy is not', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    moat(game, 0.3);
    // An enemy army camped on the far bank, north of the middle.
    for (let k = 0; k < 12; k++) spawnUnit(world, ctx, UNIT_DEFS.tank, 1, 6 + (k % 3) * 2, 20 + Math.floor(k / 3) * 2);
    spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, field.baseSites[0].x + 10, field.baseSites[0].z);
    const eng = ctx.commander.engineers;
    eng.update(world, ctx);
    const plain = eng.crossings.gap(ctx, field.baseSites[0], field.baseSites[1])!;
    const gap = (eng as unknown as { crossingAt: { gap: { points: { z: number }[] } }[] }).crossingAt[0].gap;
    const mid = (g: { points: { z: number }[] }) => g.points.reduce((s, p) => s + p.z, 0) / g.points.length;
    expect(Math.abs(mid(gap) - 23)).toBeGreaterThan(Math.abs(mid(plain) - 23) + 10);
    expect(Math.abs(mid(gap) - 23)).toBeGreaterThan(DANGER_CLEAR);
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

describe('deep crossings', () => {
  it('engineers fill in a deep trench cut right across the map, bit by bit', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    // As the god powers' Lower Land leaves it: three metres under the water, too wide to bridge.
    moat(game, 3, 8);
    const home = field.baseSites[0];
    for (const dz of [-1, 0, 1]) spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x + 20, home.z + dz);
    const eng = ctx.commander.engineers;
    const across = () => eng.crossings.gap(ctx, field.baseSites[0], field.baseSites[1]);
    expect(across()).not.toBeNull();
    let t = 0;
    for (; t < 1500 && across(); t += 10) run(game, 10);
    expect(across()).toBeNull();
  }, 300000);

  it("engineers at a crossing and the other side's engineers don't shoot each other", () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    moat(game, 0.3, 4.5);
    const home = field.baseSites[0];
    const ours = spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x + 20, home.z);
    const eng = ctx.commander.engineers;
    eng.update(world, ctx);
    expect(eng.onCrossing(ours)).toBe(true);
    const theirs = spawnUnit(world, ctx, UNIT_DEFS.engineer, 1, home.x + 24, home.z);
    run(game, 2);
    expect(world.req(theirs, Armed).target).not.toBe(ours);
    expect(world.req(ours, Armed).target).not.toBe(theirs);
  });
});

/** Raise a wall of steep ground right across the map between the bases, `height` tall and `half` wide on top, with a gap `pass` wide through it at z = 0 (none if 0). */
function ridge(game: Game, height: number, half = 1.5, pass = 0): void {
  const f = game.field;
  for (let z = f.bounds.minZ; z <= f.bounds.maxZ; z += 0.5) {
    if (pass > 0 && Math.abs(z) < pass / 2 + half) continue;
    f.reshape(0, z, half + 1.5, (h, d) => Math.max(h, d <= half ? height : height * (1 - (d - half) / 1.5)));
  }
}

/** Cut a chasm right across the map, `depth` deep and `half` wide, its walls sheer, with the map lifted first so its floor is dry. */
function chasm(game: Game, depth: number, half: number): void {
  const f = game.field;
  const lift = depth + 1;
  for (let k = 0; k < f.heights.length; k++) f.heights[k] += lift;
  f.changed({ i0: 0, j0: 0, i1: f.config.cols - 1, j1: f.config.rows - 1 });
  for (let z = f.bounds.minZ; z <= f.bounds.maxZ; z += 0.5) f.reshape(0, z, half, () => lift - depth);
}

describe('steep crossings', () => {
  it('a wall of steep ground right across the way is a dry gap, and engineers grade a ramp through it', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    ridge(game, 4);
    const [a, b] = field.baseSites;
    const gap = new Crossings().gap(ctx, a, b);
    expect(gap).not.toBeNull();
    expect(gap!.dry).toBe(true);
    expect(gap!.water).toBe(false);
    for (const dz of [-1, 0, 1]) spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, a.x + 20, a.z + dz);
    const eng = ctx.commander.engineers;
    const across = () => eng.crossings.gap(ctx, a, b);
    for (let t = 0; t < 900 && across(); t += 10) run(game, 10);
    expect(across()).toBeNull();
    expect(ctx.navs.land.connected(a, b)).toBe(true);
    expect(eng.works.some((w) => w.kind === 'grade' && w.side === 0)).toBe(true);
    // A ramp, not a hole: nothing graded went under the sea.
    for (let z = field.bounds.minZ + 2; z < field.bounds.maxZ - 2; z += 1) expect(field.heightAt(0, z)).toBeGreaterThanOrEqual(field.seaLevel);
  }, 300000);

  it('engineers bridge a dry chasm from rim to rim, and the bridge stays up', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    chasm(game, 4, 3);
    const [a, b] = field.baseSites;
    const gap = new Crossings().gap(ctx, a, b);
    expect(gap?.dry).toBe(true);
    for (const dz of [-1, 1]) spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, a.x + 20, a.z + dz);
    const eng = ctx.commander.engineers;
    for (let t = 0; t < 300 && eng.crossings.gap(ctx, a, b); t += 5) run(game, 5);
    expect(eng.crossings.gap(ctx, a, b)).toBeNull();
    const span = field.bridges.find((br) => br.builtBy === 0 && !br.gone);
    expect(span).toBeDefined();
    // Level with the rims, high over the chasm's floor.
    expect(span!.level).toBeGreaterThan(4.5);
    // Nothing was graded: the bridge did it.
    expect(eng.works.some((w) => w.kind === 'grade')).toBe(false);
    // Past an ordinary engineers' bridge's lifetime, it's still there.
    run(game, 700);
    expect(field.bridges.some((br) => br.builtBy === 0 && !br.gone)).toBe(true);
  }, 300000);

  it('a pass too narrow for the biggest units is only widened late in a battle', () => {
    const game = flatGame();
    const { ctx, field } = game;
    ridge(game, 4, 1.5, 6);
    const [a, b] = field.baseSites;
    const crossings = new Crossings();
    // There's a way, just a tight one: left alone early on...
    expect(game.ctx.navs.land.connected(a, b)).toBe(true);
    expect(crossings.gap(ctx, a, b)).toBeNull();
    // ...and widened once the battle has gone on long enough.
    const late = crossings.gap(ctx, a, b, undefined, true);
    expect(late?.narrow).toBe(true);
    expect(late?.dry).toBe(true);
    expect(Math.abs(late!.points[0].z)).toBeLessThan(3);
    expect(WIDEN_AFTER).toBeGreaterThan(600);
  });
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
