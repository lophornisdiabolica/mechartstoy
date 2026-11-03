import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { basePlaces, battlefieldConfig, defaultSettings, seating } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { Transform } from '../src/game/components';
import { UNIT_DEFS } from '../src/game/units';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';
import { generateBattlefield } from '../src/world/battlefield';
import { Rng } from '../src/core/rng';
import { NavGrid } from '../src/world/navGrid';
import { layoutTown } from '../src/world/settlements';

const DT = 1 / 30;

function emptyGame(seed: number, change: (s: ReturnType<typeof defaultSettings>) => void = () => {}): Game {
  const s = defaultSettings();
  change(s);
  return new Game(seed, { settings: s, populate: false, autoSpawn: false });
}

/** Spots near a base that a boat could be on. */
function waterNear(game: Game, site: { x: number; z: number; radius: number }): { x: number; z: number }[] {
  const naval = game.ctx.navs.for('naval');
  const out: { x: number; z: number }[] = [];
  for (let r = site.radius; r <= site.radius + 14; r += 1.5) {
    for (let a = 0; a < 32; a++) {
      const x = site.x + Math.cos((a / 32) * Math.PI * 2) * r;
      const z = site.z + Math.sin((a / 32) * Math.PI * 2) * r;
      if (naval.terrainAllowsAt(x, z)) out.push({ x, z });
    }
  }
  return out;
}

/** Whether boats near one base can sail to near the other. */
function joinedByWater(game: Game, a: { x: number; z: number; radius: number }, b: { x: number; z: number; radius: number }): boolean {
  const naval = game.ctx.navs.for('naval');
  const near = waterNear(game, b);
  return waterNear(game, a).some((p) => near.some((q) => naval.connected(p, q)));
}

describe('maps', () => {
  it('wet maps join the bases by water, and bridges keep them joined by land', () => {
    let joined = 0;
    let bridges = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const game = emptyGame(seed * 17, (s) => (s.map.water = 0.85));
      const [a, b] = game.field.baseSites;
      expect(game.ctx.nav.connected(a, b)).toBe(true);
      if (joinedByWater(game, a, b)) joined++;
      bridges += game.field.bridges.length;
    }
    // Every base gets water at this level, and it's all one network.
    expect(joined).toBe(8);
    expect(bridges).toBeGreaterThan(0);
  });

  it('waterways can be turned off', () => {
    let joined = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const game = emptyGame(seed * 17, (s) => ((s.map.water = 0.85), (s.map.waterways = false)));
      const [a, b] = game.field.baseSites;
      expect(game.ctx.nav.connected(a, b)).toBe(true);
      if (joinedByWater(game, a, b)) joined++;
    }
    expect(joined).toBeLessThan(8);
  });

  it('land units cross bridges on the deck and boats pass underneath', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = emptyGame(seed * 17, (s) => (s.map.water = 0.9));
      const bridge = game.field.bridges.find((b) => game.field.isWater((b.ax + b.bx) / 2, (b.az + b.bz) / 2));
      if (!bridge) continue;
      const mx = (bridge.ax + bridge.bx) / 2;
      const mz = (bridge.az + bridge.bz) / 2;
      const deck = game.field.deckAt(mx, mz)!;
      expect(deck).toBeGreaterThan(game.field.seaLevel + 1);
      expect(game.ctx.navs.for('tracked').terrainAllowsAt(mx, mz)).toBe(true);
      expect(game.ctx.navs.for('foot').terrainAllowsAt(mx, mz)).toBe(true);
      // A tank on the bridge stands on the deck; a boat under it floats on the water.
      const tank = spawnUnit(game.world, game.ctx, game.ctx.units.tank, 0, mx, mz);
      game.step(DT);
      expect(game.world.req(tank, Transform).y).toBeCloseTo(deck, 0);
      if (game.ctx.navs.for('naval').terrainAllowsAt(mx, mz)) {
        const boat = spawnUnit(game.world, game.ctx, game.ctx.units.missileBoat, 0, mx, mz);
        game.step(DT);
        expect(game.world.req(boat, Transform).y).toBeLessThan(deck - 0.5);
      }
      return;
    }
    throw new Error('no bridge over water in 20 wet maps');
  });

  it('the map can change mid-battle: routes and speeds follow the ground', () => {
    const game = emptyGame(5, (s) => ((s.map.water = 0), (s.map.towns = 0), (s.map.outposts = 0)));
    const field = game.field;
    const nav = game.ctx.navs.for('tracked');
    const legs = game.ctx.navs.for('walker');
    const at = { x: 0, z: 0 };
    const before = { tank: nav.costAt(at.x, at.z), walker: legs.costAt(at.x, at.z), version: nav.version };
    const changes: number[] = [];
    field.onChange((area) => changes.push(area.i1 - area.i0));
    expect(field.paint(at.x, at.z, 6, 'scrap')).toBeGreaterThan(10);
    expect(changes.length).toBe(1);
    expect(field.groundAt(at.x, at.z).id).toBe('scrap');
    // Scrap is a slog for tracks and easier for long legs; routes re-plan.
    expect(nav.costAt(at.x, at.z)).toBeCloseTo(before.tank * 3, 5);
    expect(legs.costAt(at.x, at.z)).toBeCloseTo(before.walker * 1.3, 5);
    expect(nav.version).toBeGreaterThan(before.version);
    // Painting it again changes nothing.
    expect(field.paint(at.x, at.z, 6, 'scrap')).toBe(0);

    // A tank crossing the scrap moves slower than on open ground.
    const crawl = (x: number) => {
      const tank = spawnUnit(game.world, game.ctx, game.ctx.units.tank, 0, x, 20);
      const t0 = game.world.req(tank, Transform).x;
      game.ctx.orders[0] = { stance: 'hold', rally: { x: x + 30, z: 20 } };
      for (let i = 0; i < 30; i++) game.step(DT);
      const moved = game.world.req(tank, Transform).x - t0;
      game.world.destroy(tank);
      return moved;
    };
    const open = crawl(-10);
    field.paint(-5, 20, 8, 'scrap');
    expect(crawl(-10)).toBeLessThan(open * 0.8);

    // Digging a moat round a spot cuts it off for land units.
    const inside = { x: 20, z: -10 };
    const outside = { x: -20, z: 10 };
    expect(nav.connected(inside, outside)).toBe(true);
    field.reshape(inside.x, inside.z, 9, (h, d) => (d > 6 ? field.seaLevel - 2 : h));
    expect(nav.connected(inside, outside)).toBe(false);
    expect(game.ctx.navs.for('hover').connected(inside, outside)).toBe(true);
  });

  it('biomes change the scenery, not the battle', () => {
    const kinds = (biome: 'temperate' | 'desert' | 'snow' | 'forest') => new Set(emptyGame(9, (s) => (s.map.biome = biome)).props.map((p) => p.kind));
    expect(kinds('temperate')).toEqual(new Set(['tree', 'rock']));
    expect(kinds('snow').has('snowPine')).toBe(true);
    expect(kinds('desert').has('cactus')).toBe(true);
    expect(kinds('forest').has('pine')).toBe(true);
    expect(emptyGame(9, (s) => (s.map.biome = 'forest')).props.length).toBeGreaterThan(emptyGame(9).props.length * 2);
    // Same seed, same ground under every biome.
    expect(Array.from(emptyGame(9, (s) => (s.map.biome = 'snow')).field.heights)).toEqual(Array.from(emptyGame(9).field.heights));
  });

  it('places several towns, sized as set, apart from each other, with paved main streets', () => {
    const game = emptyGame(4, (s) => ((s.map.size = 'large'), (s.map.towns = 3), (s.map.townSize = 'small'), (s.map.water = 0.3)));
    const towns = game.field.townSites;
    expect(towns.length).toBe(3);
    for (const t of towns) {
      expect(t.radius).toBe(8);
      expect(game.field.groundAt(t.x, t.z).id).toBe('road');
      for (const o of towns) if (o !== t) expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThan(t.radius + o.radius);
    }
    expect(emptyGame(4, (s) => (s.map.towns = 0)).field.townSites.length).toBe(0);
  });

  it('towns by the water get a harbour of warehouses', () => {
    let harbours = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const game = emptyGame(seed, (s) => (s.map.water = 0.8));
      for (const t of game.field.townSites) if (layoutTown(game.field, t, new Rng(seed)).some((p) => p.building === 'warehouse')) harbours++;
    }
    expect(harbours).toBeGreaterThan(0);
  });

  it('base layouts: allies apart, and teams in lines', () => {
    const s = defaultSettings();
    s.factions = [0, 0, 1, 1].map((team, i) => ({ ...defaultSettings().factions[0], name: `S${i}`, team }));
    expect(seating(s)).toEqual([0, 1, 2, 3]);
    s.map.layout = 'apart';
    expect(seating(s)).toEqual([0, 2, 1, 3]);
    s.map.layout = 'lines';
    const places = basePlaces(s, seating(s))!;
    expect(places.map((p) => Math.sign(p.x))).toEqual([-1, -1, 1, 1]);
    const field = generateBattlefield(new Rng(3), battlefieldConfig(s));
    const team = (f: number) => s.factions[f].team;
    for (const site of field.baseSites) expect(Math.sign(site.x)).toBe(team(site.faction) === 0 ? -1 : 1);
  });

  it('the shape stretches the map one way and squeezes the other', () => {
    const wide = battlefieldConfig({ ...defaultSettings(), map: { ...defaultSettings().map, shape: 1.6 } });
    const deep = battlefieldConfig({ ...defaultSettings(), map: { ...defaultSettings().map, shape: 0.7 } });
    expect(wide.cols / wide.rows).toBeGreaterThan(2);
    expect(deep.cols / deep.rows).toBeLessThan(1);
    const area = (c: { cols: number; rows: number }) => c.cols * c.rows;
    expect(area(wide) / area(deep)).toBeGreaterThan(0.85);
    expect(area(wide) / area(deep)).toBeLessThan(1.15);
  });

  it('map settings round-trip through the URL, and old town links still work', () => {
    const s = defaultSettings();
    s.map = { ...s.map, shape: 1.3, biome: 'desert', layout: 'apart', towns: 2, townSize: 'large', waterways: false };
    expect(settingsFromParams(settingsToParams(s)).map).toEqual(s.map);
    expect(settingsFromParams(new URLSearchParams('town=0')).map.towns).toBe(0);
    expect(settingsToParams(defaultSettings()).toString()).toBe('');
  });

  it('nav grids pick up ground kinds when built', () => {
    const game = emptyGame(2, (s) => ((s.map.water = 0), (s.map.towns = 0)));
    game.field.paint(10, 10, 4, 'thicket');
    const fresh = new NavGrid(game.field, 'tracked');
    expect(fresh.costAt(10, 10)).toBeGreaterThan(2);
    expect(new NavGrid(game.field, 'foot').costAt(10, 10)).toBeLessThan(1.5);
    expect(UNIT_DEFS.tank).toBeDefined();
  });
});
