import { describe, expect, it } from 'vitest';
import { Building, Faction, Health, Producer, Rubble, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { battlefieldConfig, defaultSettings, tunedUnits } from '../src/game/settings';
import { spawnBuilding } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';
import { DEFAULT_BATTLEFIELD } from '../src/world/battlefield';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

describe('battle settings', () => {
  it('defaults reproduce the hand-tuned map', () => {
    // The same terrain and town; outposts (one per side by default) are added on top.
    expect(battlefieldConfig(defaultSettings())).toEqual({ ...DEFAULT_BATTLEFIELD, outposts: 2 });
  });

  it('applies unit multipliers without touching the base definitions', () => {
    const s = defaultSettings();
    s.units.tank = { hp: 2, damage: 0.5, speed: 1.5, range: 2 };
    const units = tunedUnits(s);
    expect(units.tank.hp).toBe(UNIT_DEFS.tank.hp * 2);
    expect(units.tank.weapon.damage).toBe(UNIT_DEFS.tank.weapon.damage * 0.5);
    expect(units.tank.speed).toBe(UNIT_DEFS.tank.speed * 1.5);
    expect(units.tank.weapon.range).toBe(UNIT_DEFS.tank.weapon.range * 2);
    // Sight grows with range so the extra range is usable.
    expect(units.tank.sight).toBeGreaterThanOrEqual(units.tank.weapon.range);
    expect(units.trooper).toEqual(UNIT_DEFS.trooper);
  });

  it('map settings change the battlefield', () => {
    const s = defaultSettings();
    s.map.size = 'large';
    s.map.town = false;
    s.map.water = 0;
    const game = new Game(3, { settings: s, populate: false, autoSpawn: false });
    expect(game.field.config.cols).toBeGreaterThan(DEFAULT_BATTLEFIELD.cols);
    expect(game.field.townSites).toEqual([]);
    for (let x = game.field.bounds.minX; x < game.field.bounds.maxX; x += 3) {
      for (let z = game.field.bounds.minZ; z < game.field.bounds.maxZ; z += 3) expect(game.field.isWater(x, z)).toBe(false);
    }
  });

  it('bases stay connected by land even with maximum water', () => {
    const s = defaultSettings();
    s.map.water = 1;
    for (let seed = 0; seed < 12; seed++) {
      const field = new Game(seed * 31 + 1, { settings: s, populate: false, autoSpawn: false }).field;
      const [a, b] = field.baseSites;
      // Walk a flood fill over dry ground from one base to the other.
      const step = field.config.cellSize;
      const key = (x: number, z: number) => `${Math.round(x / step)},${Math.round(z / step)}`;
      const seen = new Set([key(a.x, a.z)]);
      const stack = [[a.x, a.z]];
      let reached = false;
      while (stack.length > 0 && !reached) {
        const [x, z] = stack.pop()!;
        reached = Math.hypot(x - b.x, z - b.z) < step;
        for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          const nx = x + dx;
          const nz = z + dz;
          if (!field.contains(nx, nz) || field.isWater(nx, nz) || seen.has(key(nx, nz))) continue;
          seen.add(key(nx, nz));
          stack.push([nx, nz]);
        }
      }
      expect(reached, `seed ${seed}`).toBe(true);
    }
  });

  it('the unit cap from settings limits dropped units', () => {
    const s = defaultSettings();
    s.armies.unitCap = 10;
    const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    let placed = 0;
    for (let i = 0; i < 20; i++) if (game.spawnUnitAt('trooper', 0, base.x + (i % 5), base.z + Math.floor(i / 5))) placed++;
    expect(placed).toBe(10);
  });
});

describe('settings in the URL', () => {
  it('writes nothing for the defaults', () => {
    expect(settingsToParams(defaultSettings()).toString()).toBe('');
  });

  it('round-trips every kind of setting', () => {
    const s = defaultSettings();
    s.seed = 'hello world';
    s.mode = 'conquest';
    s.map = { size: 'small', water: 0.2, hills: 1.35, town: false, outposts: 3 };
    s.armies = { unitCap: 90, production: 1.5, startingArmy: 0, attackTiming: 'tide', tideStrength: 0, tidePeriod: 200, buildingHp: 2.25, flanking: 0.8, evenTeams: 0.6, ramp: { conquest: { tide: 0.25, siege: 0.75 }, eternal: { tide: 0.6, siege: 0 } }, outpostBonus: 1.5, outpostHold: 0.3 };
    s.units.titan = { hp: 2, damage: 0.65, speed: 0.5, range: 1.25 };
    s.factions[1] = { name: 'Moss Pact', color: 0x33aa55, team: 1 };
    const back = settingsFromParams(new URLSearchParams(settingsToParams(s).toString()));
    expect(back).toEqual(s);
  });

  it('ignores junk and clamps out-of-range values', () => {
    const s = settingsFromParams(new URLSearchParams('mode=chaos&size=huge&cap=9999&water=abc&tank=5,x,0,-1&color1=zzz&name2=%20%20'));
    const d = defaultSettings();
    expect(s.mode).toBe(d.mode);
    expect(s.map.size).toBe(d.map.size);
    expect(s.armies.unitCap).toBe(150);
    expect(s.map.water).toBe(d.map.water);
    expect(s.units.tank).toEqual({ hp: 3, damage: 1, speed: 1, range: 1 });
    expect(s.factions).toEqual(d.factions);
  });
});

describe('conquest mode', () => {
  function conquest(seed: number): Game {
    const s = defaultSettings();
    s.mode = 'conquest';
    return new Game(seed, { settings: s, populate: false, autoSpawn: false });
  }

  it('does not rebuild ruins', () => {
    const game = conquest(4);
    const site = game.field.baseSites[1];
    const b = spawnBuilding(game.world, game.ctx, game.ctx.buildings.factory, 1, site.x, site.z, Math.PI);
    game.world.req(b, Health).hp = 0;
    run(game, game.ctx.buildings.factory.rebuildDelay + 20);
    expect([...game.world.query(Building)].length).toBe(0);
    expect([...game.world.query(Rubble)].length).toBe(1);
  });

  it('a side loses when its last production building falls', () => {
    const game = conquest(6);
    const [west, east] = game.field.baseSites;
    const hq = spawnBuilding(game.world, game.ctx, game.ctx.buildings.hq, 0, west.x, west.z, 0);
    const barracks = spawnBuilding(game.world, game.ctx, game.ctx.buildings.barracks, 0, west.x, west.z + 8, 0);
    spawnBuilding(game.world, game.ctx, game.ctx.buildings.tower, 0, west.x + 8, west.z, 0);
    spawnBuilding(game.world, game.ctx, game.ctx.buildings.factory, 1, east.x, east.z, Math.PI);
    const results: (number | null)[] = [];
    game.events.on('battleOver', (o) => results.push(o.team));

    game.world.req(hq, Health).hp = 0;
    run(game, 1);
    expect(game.outcome).toBeNull();
    // A tower left standing doesn't keep a side in the fight.
    game.world.req(barracks, Health).hp = 0;
    run(game, 1);
    expect(game.outcome?.winners).toEqual([1]);
    expect(results).toEqual([1]);
    run(game, 2);
    expect(results).toEqual([1]);
  });

  it('eternal mode never declares a winner', () => {
    const game = new Game(6, { populate: false, autoSpawn: false });
    const east = game.field.baseSites[1];
    spawnBuilding(game.world, game.ctx, game.ctx.buildings.factory, 1, east.x, east.z, Math.PI);
    run(game, 2);
    expect(game.outcome).toBeNull();
  });

  it('a full conquest battle ends with a winner', () => {
    const s = defaultSettings();
    s.mode = 'conquest';
    s.map.size = 'small';
    const game = new Game(7919, { settings: s });
    while (!game.outcome && game.world.time < 900) game.step(DT);
    expect(game.outcome).not.toBeNull();
    const loser = 1 - (game.outcome!.team ?? 0);
    const producers = [...game.world.query(Producer, Faction)].filter((e) => game.world.req(e, Faction).id === loser);
    expect(producers).toEqual([]);
    // No fallback waves for the beaten side.
    const before = [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === loser).length;
    run(game, 60);
    const after = [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === loser).length;
    expect(after).toBeLessThanOrEqual(before);
  }, 60000);
});
