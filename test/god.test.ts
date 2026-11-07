import { describe, expect, it } from 'vitest';
import { Building, Faction, GOD, Health, NEUTRAL, Projectile, Renderable, Transform, Unit } from '../src/game/components';
import { Game, SIM_HZ } from '../src/game/game';
import { BRUSH_RADIUS, STRIKES } from '../src/game/god';
import { defaultSettings } from '../src/game/settings';
import { groundCode } from '../src/world/ground';
import { settingsFromParams } from '../src/ui/settingsUrl';
import { hashSeed } from '../src/core/rng';
import { Frame, SimHost, SimView } from '../src/sim/mirror';

const DT = 1 / SIM_HZ;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds * SIM_HZ; i++) game.step(DT);
}

function unitsOf(game: Game, faction: number): number[] {
  return [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === faction);
}

/** A dry, gentle spot away from the bases (between them, off the middle line). */
function openGround(game: Game): { x: number; z: number } {
  const f = game.field;
  const [a, b] = f.baseSites;
  for (let s = 0.5; s < 0.9; s += 0.02) {
    for (const off of [0, 8, -8, 16, -16]) {
      const x = a.x + (b.x - a.x) * s;
      const z = a.z + (b.z - a.z) * s + off;
      if (!f.isWater(x, z) && f.slopeAt(x, z) < 0.3 && f.heightAt(x, z) > f.seaLevel + 1 && !f.nearBridge(x, z, 4)) return { x, z };
    }
  }
  throw new Error('no open ground');
}

/** A game with no AI armies or production, so only what the test does happens. */
function quiet(seed = 4): Game {
  const s = defaultSettings();
  s.map.towns = 0;
  return new Game(seed, { settings: s, populate: false, autoSpawn: false });
}

describe('god powers', () => {
  it('drops as many units as asked, round the point, whatever the caps', () => {
    const s = defaultSettings();
    s.armies.caps.super = 1;
    const game = new Game(4, { settings: s, populate: false, autoSpawn: false });
    const site = game.field.baseSites[0];
    expect(game.spawnUnitAt('titan', 0, site.x, site.z, 12)).toBe(true);
    const titans = unitsOf(game, 0);
    expect(titans.length).toBe(12);
    // A ring, not a pile.
    const spots = new Set(titans.map((e) => `${Math.round(game.world.req(e, Transform).x)},${Math.round(game.world.req(e, Transform).z)}`));
    expect(spots.size).toBe(12);
  });

  it('an airstrike flies a bomber over the line and its bombs hurt every side', () => {
    const game = quiet();
    const p = openGround(game);
    for (let i = 0; i < 4; i++) {
      game.spawnUnitAt('trooper', 0, p.x - 2 + i, p.z);
      game.spawnUnitAt('trooper', 1, p.x - 2 + i, p.z + 1);
    }
    const before = [...game.world.query(Unit)].length;
    expect(game.usePower({ kind: 'airstrike', strike: 'light', ax: p.x - 8, az: p.z, bx: p.x + 8, bz: p.z })).toBe(true);
    const planes = () => [...game.world.query(Renderable)].filter((e) => game.world.req(e, Renderable).model === 'god:bomber').length;
    expect(planes()).toBe(1);
    let bombs = 0;
    for (let i = 0; i < 8 * SIM_HZ; i++) {
      game.step(DT);
      for (const e of game.world.query(Projectile)) if (game.world.req(e, Projectile).faction === GOD) bombs = Math.max(bombs, 1);
    }
    expect(bombs).toBe(1);
    expect(planes()).toBe(0);
    expect(unitsOf(game, 0).length).toBeLessThan(4);
    expect(unitsOf(game, 1).length).toBeLessThan(4);
    expect([...game.world.query(Unit)].length).toBeLessThan(before);
  });

  it('the big one leaves a crater', () => {
    const game = quiet();
    const p = openGround(game);
    const h0 = game.field.heightAt(p.x, p.z);
    game.usePower({ kind: 'airstrike', strike: 'big', ax: p.x, az: p.z, bx: p.x, bz: p.z });
    run(game, 6);
    expect(game.field.heightAt(p.x, p.z)).toBeLessThan(h0 - STRIKES.big.crater * 0.5);
  });

  it('a quake heaves the ground, cracks buildings and shakes units', () => {
    const s = defaultSettings();
    const game = new Game(4, { settings: s, autoSpawn: false });
    const site = game.field.baseSites[0];
    const heights = Array.from(game.field.heights);
    const hp = () => [...game.world.query(Building, Health, Transform)].filter((e) => Math.hypot(game.world.req(e, Transform).x - site.x, game.world.req(e, Transform).z - site.z) < 12).reduce((sum, e) => sum + game.world.req(e, Health).hp, 0);
    const before = hp();
    expect(game.usePower({ kind: 'quake', quake: 'quake', x: site.x, z: site.z })).toBe(true);
    run(game, 7);
    const moved = heights.filter((h, k) => h !== game.field.heights[k]).length;
    expect(moved).toBeGreaterThan(50);
    expect(hp()).toBeLessThan(before);
    // Buildings sit on the ground as it is now.
    for (const e of game.world.query(Building, Transform)) {
      const t = game.world.req(e, Transform);
      expect(t.y).toBeCloseTo(game.field.heightAt(t.x, t.z), 5);
    }
  });

  it('the land brush raises, lowers and flattens', () => {
    const game = quiet();
    const p = openGround(game);
    const h0 = game.field.heightAt(p.x, p.z);
    for (let i = 0; i < 6; i++) game.usePower({ kind: 'terrain', brush: 'raise', size: 'medium', x: p.x, z: p.z, level: 0 });
    const raised = game.field.heightAt(p.x, p.z);
    expect(raised).toBeGreaterThan(h0 + 2);
    for (let i = 0; i < 3; i++) game.usePower({ kind: 'terrain', brush: 'lower', size: 'medium', x: p.x, z: p.z, level: 0 });
    expect(game.field.heightAt(p.x, p.z)).toBeLessThan(raised);
    for (let i = 0; i < 20; i++) game.usePower({ kind: 'terrain', brush: 'flatten', size: 'large', x: p.x, z: p.z, level: h0 });
    expect(game.field.heightAt(p.x, p.z)).toBeCloseTo(h0, 1);
  });

  it('plants dense forest and fells it again', () => {
    const game = quiet();
    const p = openGround(game);
    const trees = game.field.woods.trees.length;
    expect(game.usePower({ kind: 'forest', brush: 'plant', size: 'small', x: p.x, z: p.z })).toBe(true);
    expect(game.field.woods.trees.length).toBeGreaterThan(trees + 5);
    expect(game.field.groundAt(p.x, p.z).id).toBe('thicket');
    expect(game.field.woods.hasTreesAt(p.x, p.z)).toBe(true);
    expect(game.usePower({ kind: 'forest', brush: 'clear', size: 'medium', x: p.x, z: p.z })).toBe(true);
    expect(game.field.woods.hasTreesAt(p.x, p.z)).toBe(false);
    // Cleared forest goes back to open ground (see woods.ts).
    const [i, j] = game.field.cellAt(p.x, p.z);
    expect(game.field.ground[j * game.field.config.cols + i]).toBe(groundCode('plain'));
    expect(BRUSH_RADIUS.small).toBeLessThan(BRUSH_RADIUS.medium);
  });

  it('bridges go across water, and not over dry land', () => {
    const game = quiet();
    const f = game.field;
    const p = openGround(game);
    expect(game.usePower({ kind: 'bridge', ax: p.x - 5, az: p.z, bx: p.x + 5, bz: p.z })).toBe(false);
    // Find a short crossing: water with dry land a few cells either side.
    let found: { ax: number; az: number; bx: number; bz: number } | null = null;
    for (let x = f.bounds.minX + 6; x < f.bounds.maxX - 6 && !found; x += 1.5) {
      for (let z = f.bounds.minZ + 6; z < f.bounds.maxZ - 6 && !found; z += 1.5) {
        if (!f.isWater(x, z)) continue;
        for (const half of [5, 8, 12]) {
          if (!f.isWater(x - half, z) && !f.isWater(x + half, z) && f.contains(x - half, z, 3) && f.contains(x + half, z, 3)) {
            found = { ax: x - half, az: z, bx: x + half, bz: z };
            break;
          }
        }
      }
    }
    if (!found) return;
    const bridges = f.bridges.length;
    expect(game.usePower({ kind: 'bridge', ...found })).toBe(true);
    expect(f.bridges.length).toBe(bridges + 1);
  });

  it('walls belong to nobody and stand along the line', () => {
    const game = quiet();
    const p = openGround(game);
    expect(game.usePower({ kind: 'wall', ax: p.x - 6, az: p.z, bx: p.x + 6, bz: p.z })).toBe(true);
    const walls = [...game.world.query(Building, Faction)].filter((e) => game.world.req(e, Building).def.id === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(4);
    for (const e of walls) {
      expect(game.world.req(e, Faction).id).toBe(NEUTRAL);
      expect(Math.abs(game.world.req(e, Transform).z - p.z)).toBeLessThan(0.01);
    }
  });

  it('blessings heal or speed production, curses wither, and they wear off', () => {
    const game = quiet();
    const site = game.field.baseSites[0];
    game.spawnUnitAt('tank', 0, site.x, site.z);
    game.spawnUnitAt('tank', 1, game.field.baseSites[1].x, game.field.baseSites[1].z);
    const [mine] = unitsOf(game, 0);
    const [theirs] = unitsOf(game, 1);
    const h0 = game.world.req(mine, Health);
    h0.hp = h0.max * 0.3;
    game.usePower({ kind: 'bless', faction: 0, blessing: 'healing', strength: 'major' });
    game.usePower({ kind: 'bless', faction: 0, blessing: 'production', strength: 'minor' });
    game.usePower({ kind: 'bless', faction: 1, blessing: 'curse', strength: 'divine' });
    expect(game.ctx.god.production(0, game.world.time)).toBe(1.5);
    expect(game.ctx.god.production(1, game.world.time)).toBe(1);
    run(game, 10);
    expect(game.world.req(mine, Health).hp).toBeGreaterThan(h0.max * 0.7);
    const t = game.world.get(theirs, Health);
    expect(t === undefined || t.hp < t.max * 0.5).toBe(true);
    run(game, 115);
    expect(game.ctx.god.production(0, game.world.time)).toBe(1);
    expect(game.ctx.god.blessings.length).toBe(0);
  });
});

describe('god powers through the sim worker', () => {
  it('the page sees the planted trees, the moved ground and the blessings', () => {
    const settings = settingsFromParams(new URLSearchParams('seed=god-1&size=small'));
    const seed = hashSeed(settings.seed);
    const host = new SimHost(seed, structuredClone(settings));
    const view = new Game(seed, { settings: structuredClone(settings), view: true });
    const sim = new SimView(view);
    view.forward = (c) => host.command(c);
    const exchange = (ticks: number) => {
      host.step(ticks, false);
      const { frame } = host.frame();
      sim.apply(structuredClone(frame) as Frame);
      sim.pose(frame.time);
    };
    exchange(30);
    const p = openGround(view);
    expect(view.usePower({ kind: 'forest', brush: 'plant', size: 'small', x: p.x, z: p.z })).toBe(true);
    view.usePower({ kind: 'terrain', brush: 'raise', size: 'large', x: p.x + 12, z: p.z, level: 0 });
    view.usePower({ kind: 'quake', quake: 'tremor', x: p.x - 10, z: p.z });
    view.usePower({ kind: 'bless', faction: 1, blessing: 'healing', strength: 'minor' });
    view.usePower({ kind: 'airstrike', strike: 'heavy', ax: p.x - 10, az: p.z + 5, bx: p.x + 10, bz: p.z + 5 });
    for (let i = 0; i < 10; i++) exchange(15);
    const host_ = host.game;
    expect(view.field.woods.trees.map((t) => [t.x, t.z, t.fell])).toEqual(host_.field.woods.trees.map((t) => [t.x, t.z, t.fell]));
    expect(Array.from(view.field.heights)).toEqual(Array.from(host_.field.heights));
    expect(Array.from(view.field.ground)).toEqual(Array.from(host_.field.ground));
    expect(view.ctx.god.blessings).toEqual(host_.ctx.god.blessings);
    expect(view.ctx.god.blessings.length).toBe(1);
  }, 60000);
});
