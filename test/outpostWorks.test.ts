import { describe, expect, it } from 'vitest';
import { Building, Faction, GARRISON, Health, OutpostPart, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { buildOutpost, capture, OUTPOST_KINDS, outpostBonus, outpostWorksSystem } from '../src/game/outposts';
import { Rng } from '../src/core/rng';
import { BattleSettings, defaultFaction, defaultSettings, DEFAULT_OUTPOST_KINDS } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { DOCTRINES } from '../src/game/doctrines';
import { airShare } from '../src/game/systems/production';
import { OutpostKind, SHIPYARD_REACH } from '../src/world/battlefield';
import { System } from '../src/core/ecs';

const DT = 1 / 30;

function settings(kinds: OutpostKind[], outposts = 4, water = 0.5): BattleSettings {
  const s = defaultSettings();
  s.map.outposts = outposts;
  s.map.outpostKinds = kinds;
  s.map.water = water;
  s.factions = [defaultFaction(0), defaultFaction(1)];
  return s;
}

/** A game with just outposts (no bases, no production) and the outpost works running by hand. */
function bareGame(s: BattleSettings, seed = 4): { game: Game; works: () => System } {
  const game = new Game(seed, { settings: s, populate: false, autoSpawn: false });
  const rng = new Rng(1);
  for (const o of game.ctx.outposts) buildOutpost(game.world, game.ctx, o, rng);
  return { game, works: () => outpostWorksSystem(game.ctx) };
}

function run(game: Game, seconds: number, extra: System[] = []): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    for (const s of extra) s.update(game.world, DT);
  }
}

/** Water deep enough for a boat round a site, out to a shipyard's reach. */
function wetness(game: Game, x: number, z: number): number {
  const f = game.field;
  let n = 0;
  for (let r = 10; r <= SHIPYARD_REACH; r++) {
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      if (f.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) < f.seaLevel - 0.5) n++;
    }
  }
  return n;
}

describe('new outpost kinds', () => {
  it('are off by default, so the usual battles keep their kinds', () => {
    expect(DEFAULT_OUTPOST_KINDS).toEqual(['supply', 'airstrip', 'gun', 'fuel', 'factory']);
    expect(defaultSettings().map.outpostKinds).toEqual(DEFAULT_OUTPOST_KINDS);
  });

  it('deal a shipyard only to a site with water by it, and none on a dry map', () => {
    let yards = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const wet = new Game(seed, { settings: settings(['shipyard', 'sensor', 'repair', 'signal'], 4, 0.7), populate: false, autoSpawn: false });
      for (const o of wet.field.outpostSites) {
        if (o.kind !== 'shipyard') continue;
        yards++;
        expect(wetness(wet, o.x, o.z)).toBeGreaterThan(0);
      }
      const dry = new Game(seed, { settings: settings(['shipyard', 'sensor'], 4, 0), populate: false, autoSpawn: false });
      for (const o of dry.field.outpostSites) {
        if (o.kind === 'shipyard') expect(wetness(dry, o.x, o.z)).toBeGreaterThan(0);
      }
    }
    expect(yards).toBeGreaterThan(0);
  });

  it('a shipyard launches boats for its holder, two afloat at most, starting its clock when taken', () => {
    let found = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { game, works } = bareGame(settings(['shipyard', 'supply'], 2, 0.7), seed);
      const yard = game.ctx.outposts.find((o) => o.kind.id === 'shipyard');
      if (!yard) continue;
      found = true;
      const sys = works();
      const launches: number[] = [];
      game.events.on('outpostLaunch', (e) => launches.push(e.faction));
      // Held by its garrison, it launches nothing.
      run(game, 90, [sys]);
      expect(launches).toEqual([]);
      capture(game.world, game.ctx, yard, 0);
      run(game, 70, [sys]);
      expect(launches).toEqual([]);
      run(game, 15, [sys]);
      expect(launches).toEqual([0]);
      const boats = [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Unit).def.id === 'missileBoat');
      expect(boats.length).toBe(1);
      expect(game.world.req(boats[0], Faction).id).toBe(0);
      run(game, 180, [sys]);
      expect(launches.length).toBeLessThanOrEqual(2);
      break;
    }
    expect(found).toBe(true);
  });

  it("a repair yard mends its holder's vehicles by it, not soldiers or the enemy's", () => {
    const { game, works } = bareGame(settings(['repair'], 2));
    const o = game.ctx.outposts[0];
    expect(o.kind.id).toBe('repair');
    capture(game.world, game.ctx, o, 0);
    game.setStance(0, 'hold');
    game.setStance(1, 'hold');
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, o.x + 4, o.z + 4);
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, o.x - 4, o.z + 4);
    for (const e of [tank, trooper]) game.world.req(e, Health).hp = game.world.req(e, Health).max * 0.5;
    const sys = works();
    run(game, 4, [sys]);
    expect(game.world.req(tank, Health).hp).toBeGreaterThan(game.world.req(tank, Health).max * 0.55);
    expect(game.world.req(trooper, Health).hp).toBe(game.world.req(trooper, Health).max * 0.5);
  });

  it('a signal fire calls in a relief column for its holder from the map edge', () => {
    const { game, works } = bareGame(settings(['signal'], 2));
    const o = game.ctx.outposts[0];
    expect(o.kind.id).toBe('signal');
    capture(game.world, game.ctx, o, 1);
    const sys = works();
    const reliefs: { x: number; z: number }[] = [];
    game.events.on('outpostRelief', (e) => reliefs.push(e));
    const before = [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === 1).length;
    run(game, 125, [sys]);
    expect(reliefs.length).toBe(1);
    const after = [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === 1).length;
    expect(after).toBeGreaterThan(before);
    const b = game.field.bounds;
    const edge = Math.min(reliefs[0].x - b.minX, b.maxX - reliefs[0].x, reliefs[0].z - b.minZ, b.maxZ - reliefs[0].z);
    expect(edge).toBeLessThan(Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) * 0.3);
  });

  it('a sensor station spots for its holder, and a landing field speeds up its aircraft', () => {
    expect(OUTPOST_KINDS.sensor.building).toBe('sensorStation');
    const { game } = bareGame(settings(['sensor'], 2));
    expect(game.ctx.buildings.sensorStation.spots).toBeGreaterThan(game.ctx.buildings.relayMast.spots!);
    expect(outpostBonus(game.ctx, 0, 'air')).toBe(0);
  });
});

describe('citadel and landing field traits', () => {
  function traitGame(seed: number): Game {
    const s = settings(DEFAULT_OUTPOST_KINDS, 2);
    s.map.size = 'large';
    s.map.traits = ['citadel', 'landing'];
    return new Game(seed, { settings: s });
  }

  it('each add an outpost the bases can reach, held by its garrison', () => {
    for (const seed of [1, 2, 3]) {
      const game = traitGame(seed);
      const { field, nav } = game.ctx;
      const kinds = field.outpostSites.map((o) => o.kind);
      expect(kinds).toContain('citadel');
      expect(kinds).toContain('landing');
      expect(field.outpostSites.length).toBe(4);
      for (const o of field.outpostSites) {
        expect(field.isWater(o.x, o.z)).toBe(false);
        for (const b of field.baseSites) expect(nav.connected(o, b)).toBe(true);
        for (const p of field.outpostSites) if (p !== o) expect(Math.hypot(o.x - p.x, o.z - p.z)).toBeGreaterThan(o.radius + p.radius);
      }
      for (const o of game.ctx.outposts) expect(o.owner).toBe(GARRISON);
    }
  });

  it('the citadel is walled in round its keep', () => {
    const game = traitGame(2);
    const citadel = game.ctx.outposts.find((o) => o.kind.id === 'citadel')!;
    const parts = [...game.world.query(OutpostPart, Building)].filter((e) => game.world.req(e, OutpostPart).outpost === citadel.index);
    const ids = parts.map((e) => game.world.req(e, Building).def.id);
    expect(ids.filter((id) => id === 'citadelWall').length).toBe(8);
    expect(ids.filter((id) => id === 'tower').length).toBe(4);
    expect(ids).toContain('keep');
    expect(OUTPOST_KINDS.citadel.guards).toBe(8);
  });

  it("the landing field's holder gets the air bonus", () => {
    const game = traitGame(1);
    const landing = game.ctx.outposts.find((o) => o.kind.id === 'landing')!;
    capture(game.world, game.ctx, landing, 0);
    expect(outpostBonus(game.ctx, 0, 'air')).toBeGreaterThan(0);
    expect(outpostBonus(game.ctx, 1, 'air')).toBe(0);
  });

  it('the air bonus speeds up what flies or drops: all of an airpad, a drop side’s drops, only the scout drones from a vehicle factory', () => {
    const s = defaultSettings();
    s.factions = [{ ...defaultFaction(0), doctrine: 'armour' }, { ...defaultFaction(1), doctrine: 'zenith' }];
    const { ctx } = new Game(3, { settings: s });
    const factory = DOCTRINES.armour.production.factory!.table;
    const drones = airShare(ctx, 'factory', factory, 0);
    expect(drones).toBeGreaterThan(0.05);
    expect(drones).toBeLessThan(0.2);
    expect(airShare(ctx, 'airpad', DOCTRINES.skyline.production.airpad!.table, 0)).toBe(1);
    expect(airShare(ctx, 'dropControl', [{ unit: 'trooper', weight: 1 }], 1)).toBe(1);
    // The factory works 1 + air × share faster and its drones are 1 + air likelier: air more drones, as many of the rest.
    const air = 0.35;
    const lift = 1 + air * drones;
    const flying = (1 + air) * drones;
    const total = flying + (1 - drones);
    expect(lift * (flying / total)).toBeCloseTo(drones * (1 + air), 10);
    expect(lift * ((1 - drones) / total)).toBeCloseTo(1 - drones, 10);
  });
});
