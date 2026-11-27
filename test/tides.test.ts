import { describe, expect, it } from 'vitest';
import { Health, Mover, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { BattleSettings, battlefieldConfig, defaultFaction, defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { tideEscape } from '../src/game/tides';
import { generateBattlefield } from '../src/world/battlefield';
import { Rng } from '../src/core/rng';
import { rollTraits } from '../src/game/variety';

const DT = 1 / 30;

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    each?.();
  }
}

function settings(water = 0.6): BattleSettings {
  const s = defaultSettings();
  s.map.water = water;
  s.map.traits = ['tidal'];
  s.factions = [defaultFaction(0), defaultFaction(1)];
  return s;
}

/** The first of a few games whose map got a bar. */
function tidalGame(): Game {
  for (let seed = 1; ; seed++) {
    const game = new Game(seed, { settings: settings(), populate: false, autoSpawn: false });
    if (game.field.traits.flats.length > 0) return game;
  }
}

const middle = (f: { ax: number; az: number; bx: number; bz: number }) => ({ x: (f.ax + f.bx) / 2, z: (f.az + f.bz) / 2 });

describe('tidal flats trait', () => {
  it('lays a sand bar across narrow water, under the sea as the map is made, landing on dry ground', () => {
    let laid = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const field = generateBattlefield(new Rng(seed), battlefieldConfig(settings()));
      for (const f of field.traits.flats) {
        laid++;
        const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
        expect(len).toBeGreaterThan(5);
        expect(len).toBeLessThan(50);
        expect(field.isWater(middle(f).x, middle(f).z)).toBe(true);
        for (const end of [{ x: f.ax, z: f.az }, { x: f.bx, z: f.bz }]) expect(field.isWater(end.x, end.z)).toBe(false);
        // Deeper than a walker wades over its middle, and just dry at low tide.
        f.verts.forEach((_k, n) => {
          expect(f.low[n]).toBeGreaterThanOrEqual(field.seaLevel);
          expect(f.high[n]).toBeLessThanOrEqual(f.low[n]);
        });
        expect(field.seaLevel - Math.min(...f.high)).toBeGreaterThan(0.6);
      }
    }
    expect(laid).toBeGreaterThan(3);
    // A dry map gets none, and a map without the trait none.
    const dry = defaultSettings();
    dry.map.water = 0;
    dry.map.traits = ['tidal'];
    expect(generateBattlefield(new Rng(1), battlefieldConfig(dry)).traits.flats).toEqual([]);
    expect(generateBattlefield(new Rng(1), battlefieldConfig(defaultSettings())).traits.flats).toEqual([]);
    // Rolled map styles only deal it to wet maps.
    for (let n = 0; n < 200; n++) expect(rollTraits(new Rng(n), false)).not.toContain('tidal');
  });

  it('the tide goes out and uncovers it, a way across for land units and not for boats, and comes back in', () => {
    const game = tidalGame();
    const tide = game.ctx.tidal!;
    const f = game.field.traits.flats[0];
    const m = middle(f);
    const land = game.ctx.navs.land;
    const naval = game.ctx.navs.for('naval');
    const turns: string[] = [];
    game.events.on('tide', (e) => turns.push(e.phase));
    expect(tide.phase).toBe('high');
    expect(land.terrainAllowsAt(m.x, m.z)).toBe(false);
    expect(naval.terrainAllowsAt(m.x, m.z)).toBe(true);
    run(game, 75);
    expect(tide.phase).toBe('low');
    expect(game.field.isWater(m.x, m.z)).toBe(false);
    expect(land.terrainAllowsAt(m.x, m.z)).toBe(true);
    expect(naval.terrainAllowsAt(m.x, m.z)).toBe(false);
    // A path straight over it, while it's dry.
    const path = land.findPath({ x: f.ax, z: f.az }, { x: f.bx, z: f.bz });
    expect(path).not.toBeNull();
    expect(turns).toEqual(['ebbing']);
    run(game, 100);
    expect(tide.phase).toBe('high');
    expect(game.field.isWater(m.x, m.z)).toBe(true);
    expect(land.terrainAllowsAt(m.x, m.z)).toBe(false);
    expect(turns).toEqual(['ebbing', 'turning']);
  });

  it('warns everyone off before it turns, and drowns land units left on it', () => {
    const game = tidalGame();
    const tide = game.ctx.tidal!;
    const f = game.field.traits.flats[0];
    const m = middle(f);
    run(game, 75);
    expect(tide.phase).toBe('low');
    expect(tideEscape(game.ctx, 'tracked', m.x, m.z)).toBeNull();
    // Turning: a land unit on it is told off it, up the nearer shore; a hover isn't.
    while (tide.phase !== 'turning') game.step(DT);
    const out = tideEscape(game.ctx, 'tracked', m.x, m.z)!;
    expect(out).not.toBeNull();
    expect(game.field.isWater(out.x, out.z)).toBe(false);
    expect(tideEscape(game.ctx, 'hover', m.x, m.z)).toBeNull();
    // Routes go round it now.
    expect(game.ctx.navs.land.costAt(m.x, m.z)).toBeGreaterThan(20);
    // A tank that stays on it (held there) drowns when the sea comes over.
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, m.x, m.z);
    const t = game.world.req(tank, Transform);
    let hp = game.world.req(tank, Health).hp;
    for (let i = 0; i < 40 / DT && hp > 0; i++) {
      t.x = m.x;
      t.z = m.z;
      const mover = game.world.get(tank, Mover);
      if (mover) {
        mover.targetX = m.x;
        mover.targetZ = m.z;
      }
      game.step(DT);
      hp = game.world.get(tank, Health)?.hp ?? 0;
    }
    expect(hp).toBe(0);
    expect(['flooding', 'high']).toContain(tide.phase as string);
  });

  it('a land unit on it when the tide turns gets off in time', () => {
    const game = tidalGame();
    const tide = game.ctx.tidal!;
    const f = game.field.traits.flats[0];
    const m = middle(f);
    run(game, 75);
    while (tide.phase !== 'turning') game.step(DT);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, m.x, m.z);
    run(game, 40);
    expect(game.world.get(tank, Health)?.hp ?? 0).toBeGreaterThan(0);
    const t = game.world.req(tank, Transform);
    expect(tide.flatAt(t.x, t.z)).toBeNull();
  });
});
