import { describe, expect, it } from 'vitest';
import { Health, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { buildOutpost, capture } from '../src/game/outposts';
import { drawbridgeOf } from '../src/game/bridges';
import { Rng } from '../src/core/rng';
import { BattleSettings, defaultFaction, defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { distanceToSegment } from '../src/world/battlefield';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    each?.();
  }
}

function settings(change: (s: BattleSettings) => void = () => {}): BattleSettings {
  const s = defaultSettings();
  s.map.water = 0.8;
  s.map.hills = 1.3;
  s.factions = [defaultFaction(0), defaultFaction(1)];
  change(s);
  return s;
}

/** A map bridge with a good stretch of water under it. */
function mapBridge(game: Game): number {
  return game.field.bridges.findIndex((b) => b.builtBy === undefined && game.field.deckAt((b.ax + b.bx) / 2, (b.az + b.bz) / 2) !== null && game.field.isWater((b.ax + b.bx) / 2, (b.az + b.bz) / 2));
}

const middle = (game: Game, k: number) => {
  const b = game.field.bridges[k];
  return { x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2, y: b.level };
};

describe('falling bridges', () => {
  it('are off by default, and the setting goes in the link', () => {
    expect(defaultSettings().map.bridgesFall ?? false).toBe(false);
    expect(settingsToParams(defaultSettings()).has('bfall')).toBe(false);
    expect(settingsFromParams(settingsToParams(settings((s) => (s.map.bridgesFall = true)))).map.bridgesFall).toBe(true);
    const game = new Game(2, { settings: settings(), populate: false, autoSpawn: false });
    const k = mapBridge(game);
    expect(k).toBeGreaterThanOrEqual(0);
    const m = middle(game, k);
    for (let n = 0; n < 200; n++) game.ctx.bridges.blast(game.world, game.ctx, m.x, m.y, m.z, 400, 3, { faction: 1, unit: 'howitzer' } as never);
    expect(game.field.bridges[k].gone).toBeFalsy();
    expect(game.ctx.bridges.health(k)).toBe(1);
  });

  it('with Bridges fall on, heavy fire brings a bridge down for good, and what was on it goes in the water', () => {
    const game = new Game(2, { settings: settings((s) => (s.map.bridgesFall = true)), populate: false, autoSpawn: false });
    const k = mapBridge(game);
    const m = middle(game, k);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, m.x, m.z);
    const fell: { x: number; z: number }[] = [];
    game.events.on('bridgeFell', (e) => fell.push(e));
    run(game, 0.2);
    // A few shots wear it, and don't bring it down.
    for (let n = 0; n < 5; n++) game.ctx.bridges.blast(game.world, game.ctx, m.x, m.y, m.z, 60, 2, { faction: 1, unit: 'howitzer' } as never);
    expect(game.ctx.bridges.health(k)).toBeLessThan(1);
    expect(game.ctx.bridges.health(k)).toBeGreaterThan(0.7);
    expect(game.field.bridges[k].gone).toBeFalsy();
    // A shot well off it does nothing.
    const before = game.ctx.bridges.health(k);
    game.ctx.bridges.blast(game.world, game.ctx, m.x + 30, m.y, m.z + 30, 400, 2, { faction: 1, unit: 'howitzer' } as never);
    expect(game.ctx.bridges.health(k)).toBe(before);
    // Heavy fire does.
    for (let n = 0; n < 200 && !game.field.bridges[k].gone; n++) game.ctx.bridges.blast(game.world, game.ctx, m.x, m.y, m.z, 120, 2, { faction: 1, unit: 'howitzer' } as never);
    expect(game.field.bridges[k].gone).toBe(true);
    expect(game.ctx.bridges.fallen.has(k)).toBe(true);
    expect(fell.length).toBe(1);
    expect(game.field.deckAt(m.x, m.z)).toBeNull();
    expect(game.world.req(tank, Health).hp).toBe(0);
    // Its wreck sinks out of sight.
    run(game, 8);
    expect(game.world.isAlive(tank)).toBe(false);
    // It stays down.
    run(game, 5);
    expect(game.field.bridges[k].gone).toBe(true);
  });

  it('real shots bursting on it wear it down', () => {
    const game = new Game(2, { settings: settings((s) => (s.map.bridgesFall = true)), populate: false, autoSpawn: false });
    const k = mapBridge(game);
    const b = game.field.bridges[k];
    const m = middle(game, k);
    // Tanks on the deck, and guns on the far bank shelling them.
    for (let n = 0; n < 3; n++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, m.x + (b.bx - b.ax) * 0.1 * (n - 1), m.z + (b.bz - b.az) * 0.1 * (n - 1));
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
    const ux = (b.bx - b.ax) / len;
    const uz = (b.bz - b.az) / len;
    for (let n = 0; n < 3; n++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, b.bx + ux * 10 - uz * (n - 1) * 3, b.bz + uz * 10 + ux * (n - 1) * 3);
    run(game, 15);
    expect(game.ctx.bridges.health(k)).toBeLessThan(1);
  });

  it("the sides' engineers bridge the crossing again", () => {
    const game = new Game(2, { settings: settings((s) => (s.map.bridgesFall = true)) });
    const k = mapBridge(game);
    const m = middle(game, k);
    game.ctx.bridges.collapse(game.world, game.ctx, k, null);
    // (On this map it's the only way across: without it the way round is a long one, or none.)
    let rebuilt = false;
    run(game, 120, () => {
      if (!rebuilt && game.field.bridges.some((b) => b.builtBy !== undefined && !b.gone && distanceToSegment(m.x, m.z, b.ax, b.az, b.bx, b.bz) < 10)) rebuilt = true;
    });
    expect(rebuilt).toBe(true);
  }, 120_000);
});

describe('drawbridge outpost', () => {
  const drawbridgeGame = () => {
    const game = new Game(2, {
      settings: settings((s) => {
        s.map.outpostKinds = ['drawbridge', 'supply'];
        s.map.outposts = 3;
      }),
      populate: false,
      autoSpawn: false,
    });
    const rng = new Rng(1);
    for (const o of game.ctx.outposts) buildOutpost(game.world, game.ctx, o, rng);
    const o = game.ctx.outposts.find((o) => o.kind.id === 'drawbridge')!;
    return { game, o, k: drawbridgeOf(game.ctx, o) };
  };

  it('is dealt to an outpost by a map bridge', () => {
    for (const seed of [1, 2, 4, 7]) {
      const s = settings((s) => {
        s.map.outpostKinds = ['drawbridge', 'supply'];
        s.map.outposts = 3;
      });
      const game = new Game(seed, { settings: s, populate: false, autoSpawn: false });
      const draws = game.ctx.outposts.filter((o) => o.kind.id === 'drawbridge');
      expect(draws.length).toBe(1);
      expect(drawbridgeOf(game.ctx, draws[0])).toBeGreaterThanOrEqual(0);
    }
    // Without the kind, the outposts are where they always were.
    const plain = (kinds: BattleSettings['map']['outpostKinds']) =>
      new Game(2, { settings: settings((s) => ((s.map.outpostKinds = kinds), (s.map.outposts = 3))), populate: false, autoSpawn: false }).ctx.outposts.map((o) => [o.x, o.z]);
    expect(plain(['supply'])).toEqual(plain(['supply', 'fuel']));
  });

  it("its holder raises the bridge when enemies come, and lowers it once they've gone", () => {
    const { game, o, k } = drawbridgeGame();
    expect(k).toBeGreaterThanOrEqual(0);
    const b = game.field.bridges[k];
    const m = middle(game, k);
    const ups: boolean[] = [];
    game.events.on('drawbridge', (e) => ups.push(e.up));
    capture(game.world, game.ctx, o, 0);
    // An enemy at the far end.
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
    const far = Math.hypot(b.ax - o.x, b.az - o.z) > Math.hypot(b.bx - o.x, b.bz - o.z) ? { x: b.ax, z: b.az, s: -1 } : { x: b.bx, z: b.bz, s: 1 };
    const enemy = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, far.x + (far.s * (b.bx - b.ax) * 6) / len, far.z + (far.s * (b.bz - b.az) * 6) / len);
    run(game, 2);
    expect(game.field.bridges[k].gone).toBe(true);
    expect(game.field.deckAt(m.x, m.z)).toBeNull();
    expect(ups).toEqual([true]);
    // It goes, and the bridge comes down again.
    game.world.req(enemy, Health).hp = 0;
    run(game, 3);
    expect(game.field.bridges[k].gone).toBeFalsy();
    expect(game.field.deckAt(m.x, m.z)).not.toBeNull();
    expect(ups).toEqual([true, false]);
  });

  it("isn't raised under a unit on it, and its garrison leaves it down", () => {
    const { game, o, k } = drawbridgeGame();
    const b = game.field.bridges[k];
    const m = middle(game, k);
    // Held by its garrison: down, enemies or not.
    const enemy = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, b.ax, b.az);
    run(game, 3);
    expect(game.field.bridges[k].gone).toBeFalsy();
    // Held by side 0, with one of its own on the deck: down while it's there.
    capture(game.world, game.ctx, o, 0);
    const own = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, m.x, m.z);
    game.world.req(own, Transform);
    run(game, 1.5);
    expect(game.field.bridges[k].gone).toBeFalsy();
    void enemy;
  });
});
