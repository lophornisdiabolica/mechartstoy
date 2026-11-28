import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { basePlaces, battlefieldConfig, defaultFaction, defaultSettings, MAP_SIZES, MapSize, ROLLED_MAP_SIZES, seating } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { Transform } from '../src/game/components';
import { UNIT_DEFS } from '../src/game/units';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';
import { generateBattlefield } from '../src/world/battlefield';
import { hashSeed, Rng } from '../src/core/rng';
import { NavGrid } from '../src/world/navGrid';
import { layoutTown } from '../src/world/settlements';
import { TERRAIN_STYLE_IDS } from '../src/world/terrainStyles';
import { GIANT, MAP_TRAIT_IDS } from '../src/world/traits';
import { landReach, vertexAt } from '../src/world/waterways';
import { groundCode } from '../src/world/ground';
import { Building, Faction, Health, RELIC } from '../src/game/components';
import { MAP_OUTLINE_IDS } from '../src/world/outlines';
import { BIOME_IDS, BIOMES, BiomeId, TOWN_STYLE_IDS } from '../src/world/biomes';

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
    // The newer biomes bring their own scenery, and every biome has a town style of its own.
    const of = (biome: BiomeId) => new Set(emptyGame(9, (s) => (s.map.biome = biome)).props.map((p) => p.kind));
    expect(of('crystal').has('crystal')).toBe(true);
    expect(of('scrap').has('junk')).toBe(true);
    for (const b of BIOME_IDS) expect(TOWN_STYLE_IDS).toContain(BIOMES[b].town);
    expect(new Set(BIOME_IDS.map((b) => BIOMES[b].town)).size).toBeGreaterThanOrEqual(8);
    // A town style can be picked apart from the biome, and it's looks only.
    const s = defaultSettings();
    s.map.townStyle = 'yurt';
    expect(settingsFromParams(settingsToParams(s)).map.townStyle).toBe('yurt');
    expect(settingsFromParams(new URLSearchParams('townstyle=igloo')).map.townStyle).toBe('biome');
    expect(Array.from(emptyGame(9, (s) => (s.map.townStyle = 'dome')).field.heights)).toEqual(Array.from(emptyGame(9).field.heights));
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

  it('Huge and Vast maps need no extra sides, and more sides still grow a small map', () => {
    const sized = (size: MapSize, sides: number) => {
      const s = defaultSettings();
      s.map.size = size;
      s.factions = Array.from({ length: sides }, (_, i) => defaultFaction(i));
      return battlefieldConfig(s);
    };
    const area = (c: { cols: number; rows: number }) => c.cols * c.rows;
    const huge = sized('huge', 2);
    const vast = sized('vast', 2);
    expect([huge.cols, huge.rows]).toEqual([MAP_SIZES.huge.cols, MAP_SIZES.huge.rows]);
    expect([vast.cols, vast.rows]).toEqual([MAP_SIZES.vast.cols, MAP_SIZES.vast.rows]);
    // A 1v1 on Vast is about as big as eight sides make a map.
    expect(area(vast) / area(sized('medium', 8))).toBeGreaterThan(0.9);
    expect(area(sized('small', 8))).toBeGreaterThan(area(sized('small', 2)) * 4);
    expect(settingsFromParams(settingsToParams({ ...defaultSettings(), map: { ...defaultSettings().map, size: 'vast' } })).map.size).toBe('vast');
    expect(ROLLED_MAP_SIZES).not.toContain('huge');
    expect(ROLLED_MAP_SIZES).not.toContain('vast');
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

  it('cliffs wall off everything on the ground but spiders, and only on maps with high ground', () => {
    const game = emptyGame(11, (s) => ((s.map.cliffs = 1), (s.map.water = 0.2)));
    const f = game.field;
    const { cols, rows, cellSize } = f.config;
    const cells: { x: number; z: number }[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push({ x: f.bounds.minX + (i + 0.5) * cellSize, z: f.bounds.minZ + (j + 0.5) * cellSize });
    const faces = cells.filter((c) => f.cliffAt(c.x, c.z));
    expect(faces.length).toBeGreaterThan(30);
    for (const c of faces) {
      for (const cls of ['tracked', 'foot', 'walker', 'hover'] as const) expect(game.ctx.navs.for(cls).terrainAllowsAt(c.x, c.z)).toBe(false);
      expect(game.ctx.navs.for('climber').terrainAllowsAt(c.x, c.z)).toBe(true);
    }
    // A unit stuck on a cliff face can still step down off it.
    const face = faces.find((c) => !f.isWater(c.x, c.z))!;
    const tracked = game.ctx.navs.for('tracked');
    const off = cells.find((c) => Math.hypot(c.x - face.x, c.z - face.z) < 3 && tracked.terrainAllowsAt(c.x, c.z));
    expect(off && tracked.offCliff(face.x, face.z, off.x, off.z)).toBe(true);

    // Without mountains or cliffs, even the steepest hills (and the tallest) are only slow going.
    const hilly = emptyGame(11, (s) => ((s.map.hills = 3), (s.map.water = 0)));
    const g = hilly.field;
    expect(g.cliffs).toBe(false);
    expect(g.sheer.every((v) => v === 0)).toBe(true);
    let steepest = 0;
    for (const c of cells) {
      if (!g.contains(c.x, c.z)) continue;
      steepest = Math.max(steepest, g.slopeAt(c.x, c.z));
      expect(hilly.ctx.navs.for('tracked').terrainAllowsAt(c.x, c.z)).toBe(true);
    }
    expect(steepest).toBeGreaterThan(2);
  });

  it('mountains and mesas keep every base, town and outpost in reach, and mesa tops reachable', () => {
    const configs = [
      { hills: 1, mtn: 1, cliff: 1, water: 0.5, sides: 2 },
      { hills: 3, mtn: 1, cliff: 1, water: 1, sides: 2 },
      { hills: 2, mtn: 0.6, cliff: 0.6, water: 0.7, sides: 4 },
      { hills: 0.7, mtn: 0, cliff: 0.75, water: 0.05, sides: 6 },
    ];
    for (const c of configs) {
      for (let seed = 0; seed < 6; seed++) {
        const game = emptyGame(seed * 131 + 17, (s) => {
          s.map = { ...s.map, size: 'small', hills: c.hills, mountains: c.mtn, cliffs: c.cliff, water: c.water };
          s.factions = Array.from({ length: c.sides }, (_, i) => defaultFaction(i));
        });
        const f = game.field;
        expect(f.sheer.some((v) => v === 1)).toBe(true);
        for (const cls of ['tracked', 'foot', 'walker'] as const) {
          const nav = game.ctx.navs.for(cls);
          const home = f.baseSites[0];
          for (const p of [...f.baseSites, ...f.townSites, ...f.outpostSites]) expect(nav.connected(home, p)).toBe(true);
        }
        // Almost all the open ground can be driven to: only bits of crag (and, on the tallest hills, a few nooks) can't.
        if (c.hills > 1) continue;
        const nav = game.ctx.navs.for('tracked');
        const { cols, rows, cellSize } = f.config;
        let open = 0;
        let lost = 0;
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const p = { x: f.bounds.minX + (i + 0.5) * cellSize, z: f.bounds.minZ + (j + 0.5) * cellSize };
            if (nav.terrainBlocksCell(p.x, p.z)) continue;
            open++;
            if (!nav.connected(f.baseSites[0], p)) lost++;
          }
        }
        expect(lost / open).toBeLessThan(0.02);
      }
    }
  });

  it('maps without mountains or cliffs come out just as before', () => {
    // High ground is on its own random stream, so turning it off leaves the rest of the map alone.
    const plain = emptyGame(23).field;
    const off = emptyGame(23, (s) => ((s.map.mountains = 0), (s.map.cliffs = 0))).field;
    expect(Array.from(off.heights)).toEqual(Array.from(plain.heights));
    const s = defaultSettings();
    s.map = { ...s.map, hills: 2.6, mountains: 0.35, cliffs: 0.8 };
    const back = settingsFromParams(settingsToParams(s)).map;
    expect([back.hills, back.mountains, back.cliffs]).toEqual([2.6, 0.35, 0.8]);
  });

  it('every terrain style generates a playable map, with its own lie of the land', () => {
    const stats: Record<string, { water: number; sheer: number; bridges: number }> = {};
    for (const terrain of TERRAIN_STYLE_IDS) {
      let water = 0;
      let sheer = 0;
      let bridges = 0;
      for (let seed = 0; seed < 4; seed++) {
        const game = emptyGame(seed * 97 + 5, (s) => {
          s.map = { ...s.map, size: seed % 2 ? 'medium' : 'small', terrain, water: 0.4, towns: 2, outposts: 3 };
          s.factions = Array.from({ length: seed < 2 ? 2 : 4 }, (_, i) => defaultFaction(i));
        });
        const f = game.field;
        for (const cls of ['tracked', 'foot', 'walker'] as const) {
          const nav = game.ctx.navs.for(cls);
          for (const p of [...f.baseSites, ...f.outpostSites]) expect(nav.connected(f.baseSites[0], p)).toBe(true);
        }
        const { cols, rows, cellSize } = f.config;
        let wet = 0;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (f.isWater(f.bounds.minX + (i + 0.5) * cellSize, f.bounds.minZ + (j + 0.5) * cellSize)) wet++;
        water += wet / (cols * rows) / 4;
        sheer += f.sheer.reduce((a, v) => a + v, 0) / f.sheer.length / 4;
        bridges += f.bridges.length / 4;
      }
      stats[terrain] = { water, sheer, bridges };
    }
    // Rolling maps have no high ground; a ridge or a canyon is high ground down the middle.
    expect(stats.rolling.sheer).toBe(0);
    expect(stats.ridge.sheer).toBeGreaterThan(0.03);
    expect(stats.canyon.sheer).toBeGreaterThan(0.03);
    // A river gets bridged; islands and a coast are mostly sea; salt flats are dry.
    expect(stats.river.bridges).toBeGreaterThanOrEqual(1.5);
    expect(stats.islands.water).toBeGreaterThan(0.35);
    expect(stats.coast.water).toBeGreaterThan(stats.rolling.water + 0.1);
    expect(stats.flats.water).toBeLessThan(stats.rolling.water);
  });

  it('the rolling terrain style is the map as it always was', () => {
    const plain = emptyGame(29).field;
    expect(plain.config.terrain).toBe('rolling');
    const s = defaultSettings();
    s.map.terrain = 'canyon';
    expect(settingsFromParams(settingsToParams(s)).map.terrain).toBe('canyon');
    expect(settingsToParams(s).get('terrain')).toBe('canyon');
    expect(settingsFromParams(new URLSearchParams('terrain=volcano')).map.terrain).toBe('rolling');
  });

  it('every map outline keeps the bases, towns and outposts in reach, with sea where the outline says', () => {
    const sea: Record<string, number> = {};
    for (const outline of MAP_OUTLINE_IDS) {
      let wet = 0;
      for (let seed = 0; seed < 4; seed++) {
        const game = emptyGame(seed * 61 + 3, (s) => {
          s.map = { ...s.map, size: seed % 2 ? 'medium' : 'small', outline, water: 0.3, towns: 2, outposts: 3 };
          s.factions = Array.from({ length: seed < 2 ? 2 : 5 }, (_, i) => defaultFaction(i));
        });
        const f = game.field;
        for (const cls of ['tracked', 'foot', 'walker'] as const) {
          const nav = game.ctx.navs.for(cls);
          for (const p of [...f.baseSites, ...f.outpostSites, ...f.townSites]) expect(nav.connected(f.baseSites[0], p)).toBe(true);
        }
        const { cols, rows, cellSize } = f.config;
        let n = 0;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (f.isWater(f.bounds.minX + (i + 0.5) * cellSize, f.bounds.minZ + (j + 0.5) * cellSize)) n++;
        wet += n / (cols * rows) / 4;
      }
      sea[outline] = wet;
    }
    for (const outline of ['island', 'isthmus', 'crescent', 'peninsula']) expect(sea[outline]).toBeGreaterThan(sea.full + 0.12);
    expect(sea.ring).toBeGreaterThan(sea.full + 0.04);
    const game = emptyGame(8, (s) => ((s.map.outline = 'ring'), (s.map.water = 0)));
    expect(game.field.isWater(0, 0)).toBe(true);
    expect(settingsFromParams(new URLSearchParams('outline=crescent')).map.outline).toBe('crescent');
  });

  it('a bridge out to cut-off land starts clear of the bridges already there, not from one’s side', () => {
    let bridges = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const s = defaultSettings();
      s.map.terrain = 'islands';
      s.map.towns = 2;
      const f = generateBattlefield(new Rng(seed * 7919), { ...battlefieldConfig(s), seats: [0, 1, 2] });
      bridges += f.bridges.length;
      for (const b of f.bridges) {
        for (const o of f.bridges) {
          if (o === b) continue;
          for (const [x, z] of [[b.ax, b.az], [b.bx, b.bz]]) {
            const dx = o.bx - o.ax;
            const dz = o.bz - o.az;
            const t = Math.max(0, Math.min(1, ((x - o.ax) * dx + (z - o.az) * dz) / (dx * dx + dz * dz)));
            expect(Math.hypot(x - o.ax - dx * t, z - o.az - dz * t)).toBeGreaterThan(o.width / 2 + 0.5);
          }
        }
      }
    }
    expect(bridges).toBeGreaterThan(16);
  });
  it('never puts a town on top of a base, even on a small map crowded with sides', () => {
    // A small map with three sides: one base sits on the middle line, where the first town goes.
    const q = 'seed=aw52vo&size=small&biome=steppe&water=0&hills=1.46&shape=0.76&forest=0&towns=2&sides=3';
    const game = new Game(hashSeed('aw52vo'), { settings: settingsFromParams(new URLSearchParams(q)), populate: false, autoSpawn: false });
    let towns = game.field.townSites.length;
    const clear = (f: typeof game.field) => {
      for (const t of f.townSites) for (const b of f.baseSites) expect(Math.hypot(t.x - b.x, t.z - b.z)).toBeGreaterThanOrEqual(t.radius + b.radius);
    };
    clear(game.field);
    for (let seed = 0; seed < 16; seed++) {
      const s = defaultSettings();
      s.map = { ...s.map, size: 'small', towns: 2 };
      s.factions = Array.from({ length: 3 + (seed % 3) }, (_, i) => defaultFaction(i));
      const f = generateBattlefield(new Rng(seed), battlefieldConfig(s));
      clear(f);
      towns += f.townSites.length;
    }
    // Most still get their towns, clear of the bases.
    expect(towns).toBeGreaterThan(16);
  });

  it('every map trait lays out its features on contested ground, and keeps the bases in reach', () => {
    for (const trait of MAP_TRAIT_IDS) {
      let placed = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = defaultSettings();
        s.map.traits = [trait];
        // (Tidal flats need water to lay their bars across.)
        if (trait === 'tidal') s.map.water = 0.7;
        const f = generateBattlefield(new Rng(seed * 101), battlefieldConfig(s));
        const reach = landReach(f);
        for (const b of f.baseSites) expect(reach[vertexAt(f, b.x, b.z)]).toBe(1);
        if (f.traits.sites.some((t) => t.kind === trait)) placed++;
        // Relics stand clear of the bases, towns and outposts.
        for (const r of f.traits.relics) {
          for (const b of f.baseSites) expect(Math.hypot(b.x - r.x, b.z - r.z)).toBeGreaterThan(b.radius * 1.35);
          for (const o of f.outpostSites) expect(Math.hypot(o.x - r.x, o.z - r.z)).toBeGreaterThan(o.radius);
        }
      }
      expect(placed, trait).toBeGreaterThanOrEqual(5);
    }
    const oil = defaultSettings();
    oil.map.traits = ['oil'];
    const f = generateBattlefield(new Rng(202), battlefieldConfig(oil));
    expect(f.traits.relics.filter((r) => r.building === 'derrick').length).toBeGreaterThan(1);
    expect([...f.ground].filter((g) => g === groundCode('oil')).length).toBeGreaterThan(10);
    const grove = defaultSettings();
    grove.map.traits = ['grove'];
    expect(generateBattlefield(new Rng(202), battlefieldConfig(grove)).woods.trees.filter((t) => t.size >= GIANT).length).toBeGreaterThan(10);
  });

  it('a map with no traits is the map as it always was, and traits round-trip through the link', () => {
    const plain = generateBattlefield(new Rng(77), battlefieldConfig(defaultSettings()));
    expect(plain.traits.sites.length + plain.traits.relics.length + plain.traits.vents.length).toBe(0);
    const s = defaultSettings();
    s.map.traits = ['ruins', 'oil'];
    const back = settingsFromParams(settingsToParams(s));
    expect(back.map.traits).toEqual(['oil', 'ruins']);
    expect(settingsFromParams(new URLSearchParams('traits=volcano,grove')).map.traits).toEqual(['grove']);
    expect(settingsToParams(defaultSettings()).has('traits')).toBe(false);
  });

  it('traits come alive in battle: relics are nobody’s, oil burns everyone, geysers steam, the hulk’s scrap stays', () => {
    const s = defaultSettings();
    s.map.traits = ['oil', 'geysers', 'hulk', 'ruins'];
    const game = new Game(12, { settings: s });
    const relics = [...game.world.query(Building, Faction)].filter((e) => game.world.req(e, Faction).id === RELIC);
    expect(relics.length).toBe(game.field.traits.relics.length);
    expect(game.ctx.sides.hostile(RELIC, 0) || game.ctx.sides.hostile(0, RELIC) || game.ctx.sides.allied(RELIC, 0)).toBe(false);
    // Set a pool alight: the fire spreads across it and burns whoever's in it.
    const pool = game.ctx.traits.pools[0];
    const cols = game.field.config.cols;
    const x = game.field.bounds.minX + ((pool % cols) + 0.5) * game.field.config.cellSize;
    const z = game.field.bounds.minZ + (Math.floor(pool / cols) + 0.5) * game.field.config.cellSize;
    const soldier = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, x, z);
    const hp = game.world.req(soldier, Health).hp;
    game.ctx.traits.strike(x, z, 1);
    let most = 0;
    let steam = 0;
    for (let n = 0; n < 40 * 30; n++) {
      game.step(1 / 30);
      most = Math.max(most, game.ctx.traits.burning.size);
      for (const v of game.field.traits.vents) if (game.ctx.smoke.nobodysAt(v.x, v.z)) steam++;
    }
    expect(most).toBeGreaterThan(2);
    expect(!game.world.isAlive(soldier) || game.world.req(soldier, Health).hp < hp).toBe(true);
    expect(steam).toBeGreaterThan(0);
    const hulk = game.field.traits.relics.find((r) => r.building === 'crashedHulk')!;
    expect(game.ctx.wreckage.massNear(hulk.x, hulk.z, 7.5)).toBeGreaterThan(50);
  });
});
