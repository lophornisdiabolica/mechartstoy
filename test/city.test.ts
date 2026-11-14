import { describe, expect, it } from 'vitest';
import { Building, Faction, NEUTRAL, Transform, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { battlefieldConfig, defaultSettings } from '../src/game/settings';
import { UNIT_DEFS } from '../src/game/units';
import { generateBattlefield } from '../src/world/battlefield';
import { CITY_CELL, cityOut, cityStreets } from '../src/world/city';
import { Rng } from '../src/core/rng';
import * as D from '../src/core/dmath';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** A battle with a city and nobody fighting. */
function quietCity(seed = 1, size: 'medium' | 'large' = 'medium'): Game {
  const s = defaultSettings();
  s.map.city = 'district';
  s.map.size = size;
  s.armies.startingArmy = 0;
  return new Game(seed, { settings: s, autoSpawn: false });
}

/** Length of a route. */
function length(path: { x: number; z: number }[], from: { x: number; z: number }): number {
  let d = 0;
  let at = from;
  for (const p of path) {
    d += D.hypot(p.x - at.x, p.z - at.z);
    at = p;
  }
  return d;
}

describe('cities', () => {
  it('lays out a city of blocks on medium and large maps, but keeps maps without one the same', () => {
    for (const size of ['medium', 'large'] as const) {
      const s = defaultSettings();
      s.map.size = size;
      s.map.city = 'district';
      const field = generateBattlefield(new Rng(7).fork(1), battlefieldConfig(s));
      const city = field.townSites[0].city!;
      expect(city).toBeDefined();
      expect(city.lots.length).toBeGreaterThan(size === 'large' ? 90 : 30);
      expect(field.roads.filter((r) => r.kind === 'alley').length).toBeGreaterThan(5);
      // Clear of every base pad.
      for (const b of field.baseSites) expect(cityOut(city, b.x, b.z)).toBeGreaterThan(1);
    }
    const plain = defaultSettings();
    const a = generateBattlefield(new Rng(7).fork(1), battlefieldConfig(plain));
    plain.map.city = 'off';
    plain.map.towns = 1;
    const b = generateBattlefield(new Rng(7).fork(1), battlefieldConfig(plain));
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
  });

  it('puts one building on each lot, and an outpost on the square', () => {
    const s = defaultSettings();
    s.map.city = 'district';
    s.map.outposts = 2;
    s.armies.startingArmy = 0;
    const game = new Game(2, { settings: s, autoSpawn: false });
    const city = game.field.townSites[0].city!;
    const square = game.field.outpostSites[0];
    expect(D.hypot(square.x - city.square.x, square.z - city.square.z)).toBeLessThan(0.01);
    const civic = [...game.world.query(Building, Faction, Transform)].filter((e) => game.world.req(e, Faction).id === NEUTRAL);
    const onLots = civic.filter((e) => {
      const t = game.world.req(e, Transform);
      return city.lots.some((l) => D.hypot(l.x - t.x, l.z - t.z) < 0.01);
    });
    expect(onLots.length).toBeGreaterThan(city.lots.length * 0.9);
    // Nothing on the square's pad.
    for (const e of onLots) {
      const t = game.world.req(e, Transform);
      expect(D.hypot(t.x - square.x, t.z - square.z)).toBeGreaterThan(square.radius);
    }
  });

  it('keeps vehicles to the avenues, while infantry cut down the alleys', () => {
    const game = quietCity(1);
    run(game, 0.5);
    const city = game.field.townSites[0].city!;
    const tanks = game.ctx.navs.for('tracked');
    const feet = game.ctx.navs.for('foot');
    // Two lots back to back across an alley: the alley has room for infantry, not tanks.
    let checked = 0;
    for (const a of city.lots) {
      const b = city.lots.find((l) => l.bi === a.bi && l.bj === a.bj && Math.abs(l.x - a.x) < 0.01 && Math.abs(l.z - a.z - 3 * CITY_CELL) < 0.01);
      if (!b) continue;
      const alley = { x: a.x, z: a.z + CITY_CELL * 1.5 };
      expect(tanks.fitsAt(alley.x, alley.z, UNIT_DEFS.tank.radius)).toBe(false);
      expect(feet.fitsAt(alley.x, alley.z, UNIT_DEFS.trooper.radius)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
    // Right across the city, a tank's route always has room for it.
    const from = { x: city.x - city.rx - 4, z: city.z + 0.3 * city.rz };
    const to = { x: city.x + city.rx + 4, z: city.z - 0.3 * city.rz };
    const drive = tanks.findPath(from, to, UNIT_DEFS.tank.radius)!;
    expect(drive).not.toBeNull();
    // (Its turns, and halfway along each leg: a straight leg can clip an alley's mouth at a corner.)
    let at = from;
    for (const p of drive) {
      for (const q of [p, { x: (p.x + at.x) / 2, z: (p.z + at.z) / 2 }]) {
        expect(tanks.clearanceAt(q.x, q.z), `${q.x.toFixed(1)},${q.z.toFixed(1)}`).toBeGreaterThan(UNIT_DEFS.tank.radius);
      }
      at = p;
    }
    // On foot, the same trip is no longer, and can take the alleys.
    const walk = feet.findPath(from, to, UNIT_DEFS.trooper.radius)!;
    expect(length(walk, from)).toBeLessThanOrEqual(length(drive, from) + 0.5);
  });

  it("opens an alley up once a building beside it is razed", () => {
    const game = quietCity(1);
    run(game, 0.5);
    const city = game.field.townSites[0].city!;
    const nav = game.ctx.navs.for('tracked');
    const lot = city.lots.find((a) => city.lots.some((l) => l.bj === a.bj && Math.abs(l.x - a.x) < 0.01 && Math.abs(l.z - a.z - 3 * CITY_CELL) < 0.01))!;
    const alley = { x: lot.x, z: lot.z + CITY_CELL * 1.5 };
    expect(nav.fitsAt(alley.x, alley.z, UNIT_DEFS.tank.radius)).toBe(false);
    const near = [...game.world.query(Building, Transform)].filter((e) => {
      const t = game.world.req(e, Transform);
      return D.hypot(t.x - alley.x, t.z - alley.z) < 3;
    });
    for (const e of near) game.world.destroy(e);
    run(game, 0.5);
    expect(nav.fitsAt(alley.x, alley.z, UNIT_DEFS.tank.radius)).toBe(true);
  });

  it('runs a city battle with no vehicle wedged in an alley', () => {
    const s = defaultSettings();
    s.map.city = 'district';
    const game = new Game(4, { settings: s });
    const nav = game.ctx.navs.for('tracked');
    let wedged = 0;
    let seen = 0;
    for (let t = 0; t < 6; t++) {
      run(game, 30);
      for (const e of game.world.query(Unit, Transform)) {
        const def = game.world.req(e, Unit).def;
        if (def.move !== 'tracked' || def.radius < 1) continue;
        const p = game.world.req(e, Transform);
        if (!game.field.inCity(p.x, p.z)) continue;
        seen++;
        // An alley's cell (see NavGrid.capAlleys); a big vehicle merely snug against a building is fine.
        if (nav.clearanceAt(p.x, p.z) > 0 && nav.clearanceAt(p.x, p.z) <= CITY_CELL / 2) wedged++;
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect(wedged).toBe(0);
  }, 120_000);
});

describe('city traffic', () => {
  it('registers each avenue stretch between crossings as a narrow street', () => {
    const game = quietCity(1);
    const city = game.field.townSites[0].city!;
    const streets = cityStreets(city);
    expect(streets.length).toBeGreaterThan(city.avenues.length);
    for (const s of streets) {
      expect(s.width).toBeCloseTo(4.5);
      // Straight, along one axis.
      expect(s.ax === s.bx || s.az === s.bz).toBe(true);
      const mid = { x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2 };
      expect(game.ctx.traffic.at(mid.x, mid.z, 0)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('cities over the whole map', () => {
  it('covers the map round the bases, with no towns besides', () => {
    const s = defaultSettings();
    s.map.city = 'sprawl';
    s.map.towns = 3;
    const field = generateBattlefield(new Rng(5).fork(1), battlefieldConfig(s));
    expect(field.townSites.length).toBe(1);
    const city = field.townSites[0].city!;
    expect(city.lots.length).toBeGreaterThan(100);
    for (const l of city.lots) {
      for (const b of field.baseSites) expect(D.hypot(l.x - b.x, l.z - b.z)).toBeGreaterThan(b.radius + 5);
      if (l.use === 'building') expect(field.isWater(l.x, l.z)).toBe(false);
    }
    // Built lots reach most of the way across the map.
    const xs = city.lots.map((l) => l.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(field.width * 0.7);
  });

  it('runs a battle on one', () => {
    const s = defaultSettings();
    s.map.city = 'sprawl';
    const game = new Game(6, { settings: s });
    run(game, 60);
    expect(game.ctx.outposts.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('parks and ponds', () => {
  it('makes some blocks parks with trees, and some ponds with water, over a few cities', () => {
    let parks = 0;
    let ponds = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const s = defaultSettings();
      s.map.city = 'sprawl';
      s.map.size = 'large';
      const field = generateBattlefield(new Rng(seed).fork(1), battlefieldConfig(s));
      const city = field.townSites[0].city!;
      for (const f of city.features) {
        const mid = { x: (f.x0 + f.x1) / 2, z: (f.z0 + f.z1) / 2 };
        if (f.kind === 'pond') {
          ponds++;
          expect(field.isWater(mid.x, mid.z)).toBe(true);
        } else {
          parks++;
          const trees = field.woods.trees.filter((t) => t.x > f.x0 && t.x < f.x1 && t.z > f.z0 && t.z < f.z1);
          expect(trees.length).toBeGreaterThan(0);
        }
        for (const l of city.lots) if (l.x > f.x0 && l.x < f.x1 && l.z > f.z0 && l.z < f.z1) expect(l.use).toBe(f.kind);
      }
    }
    expect(parks).toBeGreaterThan(3);
    expect(ponds).toBeGreaterThan(0);
  });

  it('leaves parks and ponds without buildings', () => {
    const s = defaultSettings();
    s.map.city = 'sprawl';
    s.armies.startingArmy = 0;
    const game = new Game(3, { settings: s, autoSpawn: false });
    const city = game.field.townSites[0].city!;
    const open = city.lots.filter((l) => l.use !== 'building');
    expect(open.length).toBeGreaterThan(0);
    for (const e of game.world.query(Building, Transform)) {
      const t = game.world.req(e, Transform);
      expect(open.some((l) => D.hypot(l.x - t.x, l.z - t.z) < 0.01)).toBe(false);
    }
  });
});
