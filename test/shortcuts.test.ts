import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { MAX_WET } from '../src/game/commander/shortcuts';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** Seed 16's wet medium map: narrow water where a bridge makes the way to the enemy and an outpost much shorter. */
function wetGame(shortcuts = true): Game {
  const s = defaultSettings();
  s.map.water = 1;
  s.factions[0].doctrine = 'armour';
  s.factions[1].doctrine = 'tidewater';
  s.armies.shortcuts = shortcuts;
  return new Game(16, { settings: s });
}

describe('shortcuts', () => {
  it('finds narrow water along the shores, all of it bridgeable', () => {
    const game = wetGame();
    const places = game.ctx.commander.engineers.shortcuts.places(game.ctx);
    expect(places.length).toBeGreaterThan(20);
    for (const p of places) {
      expect(p.wet).toBeLessThanOrEqual(MAX_WET);
      expect(game.field.isWater(p.ax, p.az)).toBe(false);
      expect(game.field.isWater(p.bx, p.bz)).toBe(false);
    }
  });

  it("a land army's engineers bridge where it shortens the way; Tidewater doesn't", () => {
    const game = wetGame();
    const built: number[] = [];
    game.ctx.events.on('span', (e) => {
      if (!e.down) built.push(e.faction);
    });
    const eng = game.ctx.commander.engineers;
    let most = 0;
    for (let t = 0; t < 200 && most === 0; t += 5) {
      run(game, 5);
      most = Math.max(most, eng.shortcutsOf(0));
    }
    expect(most).toBe(1);
    expect(built).toContain(0);
    expect(eng.shortcutsOf(1)).toBe(0);
    // The bridge is land on the route grid: units can cross it.
    const span = game.field.bridges.find((b) => b.builtBy === 0 && !b.gone)!;
    expect(game.ctx.navs.land.terrainAllowsAt((span.ax + span.bx) / 2, (span.az + span.bz) / 2)).toBe(true);
  }, 120000);

  it('builds none with the setting off', () => {
    const game = wetGame(false);
    run(game, 200);
    expect(game.ctx.commander.engineers.shortcutsOf(0)).toBe(0);
  }, 120000);
});

describe("boats' danger to land squads", () => {
  it('counts in full, where the same strength of tanks only counts past their usual share', () => {
    const s = defaultSettings();
    s.map.outposts = 0;
    const game = new Game(3, { settings: s, populate: false, autoSpawn: false });
    const { world, ctx } = game;
    const b = game.field.baseSites[1];
    for (let i = 0; i < 4; i++) spawnUnit(world, ctx, UNIT_DEFS.missileBoat, 1, b.x, b.z + i * 3);
    for (let i = 0; i < 4; i++) spawnUnit(world, ctx, UNIT_DEFS.tank, 1, b.x + 30, b.z + i * 3);
    const map = ctx.commander.threats;
    map.update(world);
    const share = map.usualShare(ctx, 0, 'vehicle');
    const byBoats = map.excess(ctx, 0, 'vehicle', share, b.x, b.z + 4);
    expect(map.boats(ctx, 0, b.x, b.z + 4)).toBeGreaterThan(0);
    expect(byBoats).toBeCloseTo(map.boats(ctx, 0, b.x, b.z + 4), 3);
    // Aircraft don't mind boats any more than the rest.
    expect(map.excess(ctx, 0, 'air', map.usualShare(ctx, 0, 'air'), b.x, b.z + 4)).toBeLessThan(byBoats);
  });
});
