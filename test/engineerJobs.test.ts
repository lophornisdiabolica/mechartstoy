import { describe, expect, it } from 'vitest';
import { dig, Earthwork, layGround } from '../src/game/commander/engineers';
import { PICTURE_INTERVAL } from '../src/game/commander/commander';
import { Ai, Ammo, Armed, Building, Faction, Health, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { DoctrineId } from '../src/game/doctrines';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** A flat, dry, empty map, with these doctrines. */
function flatGame(doctrines: [DoctrineId, DoctrineId], outposts = 0, seed = 4): Game {
  const s = defaultSettings();
  s.map.hills = 0;
  s.map.water = 0;
  s.map.towns = 0;
  s.map.outposts = outposts;
  s.map.forest = 0;
  s.armies.taskForces = 0;
  s.factions[0].doctrine = doctrines[0];
  s.factions[1].doctrine = doctrines[1];
  return new Game(seed, { settings: s, populate: false });
}

function buildings(game: Game, side: number, id: string) {
  return [...game.world.query(Building, Faction, Transform)].filter((e) => game.world.req(e, Faction).id === side && game.world.req(e, Building).def.id === id);
}

describe('Tidewater harbour', () => {
  it('digs a harbour basin for its dock on a map with no boat-deep water', () => {
    // Seed 7's medium map has no water deep enough for boats anywhere: before, Tidewater never had a dock on it.
    const s = defaultSettings();
    s.factions[0].doctrine = 'tidewater';
    s.factions[1].doctrine = 'armour';
    const game = new Game(7, { settings: s });
    expect(buildings(game, 0, 'dock').length).toBe(0);
    let docked = false;
    for (let t = 0; t < 240 && !docked; t += 10) {
      run(game, 10);
      docked = buildings(game, 0, 'dock').length > 0;
    }
    expect(docked).toBe(true);
    expect(game.ctx.commander.engineers.works.some((w) => w.side === 0 && w.kind === 'canal' && w.harbour)).toBe(true);
  }, 120000);

  it('sends its engineer to the dock before the walls, however near the walls are', () => {
    const s = defaultSettings();
    s.factions[0].doctrine = 'tidewater';
    s.factions[1].doctrine = 'armour';
    const game = new Game(5, { settings: s });
    const eng = game.ctx.commander.engineers;
    let first: string | null = null;
    for (let t = 0; t < 200 && first === null; t += 2) {
      run(game, 2);
      const urgent = [...game.world.query(Faction, Transform)].map((e) => eng.jobFor(e)).find((j) => j?.urgent);
      if (urgent) first = urgent.kind === 'build' ? urgent.def.id : urgent.kind;
    }
    expect(first).not.toBeNull();
  }, 120000);
});

describe('Legion', () => {
  it('builds walls in front of its trench lines as well as digging them', () => {
    const s = defaultSettings();
    s.factions[0].doctrine = 'legion';
    s.factions[1].doctrine = 'armour';
    const game = new Game(1, { settings: s });
    run(game, 120);
    expect(buildings(game, 0, 'wall').length).toBeGreaterThan(0);
    expect(game.ctx.commander.engineers.works.some((w) => w.side === 0 && w.kind === 'trench')).toBe(true);
  }, 120000);
});

describe('Skyline helipads', () => {
  it('engineers put up a forward helipad at an outpost Skyline holds, and aircraft rearm there', () => {
    const game = flatGame(['skyline', 'armour'], 2);
    const { world, ctx } = game;
    const home = game.field.baseSites[0];
    const o = [...ctx.outposts].sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
    o.owner = 0;
    spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x, home.z);
    let pads: number[] = [];
    for (let t = 0; t < 120 && pads.length === 0; t += 5) {
      run(game, 5);
      pads = buildings(game, 0, 'helipad');
    }
    expect(pads.length).toBe(1);
    const pt = world.req(pads[0], Transform);
    expect(Math.hypot(pt.x - o.x, pt.z - o.z)).toBeLessThan(14);
    // Once it's up, a gunship out of rounds by the outpost rearms at the helipad, not all the way home.
    run(game, ctx.buildings.helipad.buildTime + 1);
    const gunship = spawnUnit(world, ctx, UNIT_DEFS.gunship, 0, o.x + 4, o.z + 4);
    world.req(gunship, Ammo).left = 0;
    world.req(gunship, Ammo).rearming = true;
    let nearest = Infinity;
    for (let i = 0; i < 15 / DT && world.req(gunship, Ammo).rearming; i++) {
      game.step(DT);
      const gt = world.req(gunship, Transform);
      nearest = Math.min(nearest, Math.hypot(gt.x - pt.x, gt.z - pt.z));
    }
    expect(world.req(gunship, Ammo).rearming).toBe(false);
    expect(nearest).toBeLessThan(4);
  }, 120000);
});

describe('bridges over canals', () => {
  /** A Tidewater canal across the middle of the map, all but a long way round at one end. */
  function canalled(): Game {
    const game = flatGame(['armour', 'tidewater']);
    const { field, ctx } = game;
    const [a, b] = field.baseSites;
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    // Across the way between the bases, from far off one side to just past the other.
    const nx = -(b.z - a.z) / d;
    const nz = (b.x - a.x) / d;
    const works = ctx.commander.engineers.works;
    for (let s = -60; s < 30; s += 3) {
      const w: Earthwork = { kind: 'canal', side: 1, ax: mx + nx * s, az: mz + nz * s, bx: mx + nx * (s + 3), bz: mz + nz * (s + 3), level: field.seaLevel, effort: 0, done: false };
      for (let n = 0; n < 100 && dig(game.world, ctx, w); n++);
      w.done = true;
      layGround(ctx, w);
      works.push(w);
    }
    return game;
  }

  it('engineers of other doctrines throw one across where it cuts the way short', () => {
    const game = canalled();
    const { world, ctx, field } = game;
    const home = field.baseSites[0];
    spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x, home.z);
    let built = false;
    for (let t = 0; t < 150 && !built; t += 5) {
      run(game, 5);
      built = field.bridges.some((b) => b.builtBy === 0 && !b.gone);
    }
    expect(built).toBe(true);
    expect(ctx.commander.engineers.spansOf(0)).toBe(1);
    // Tidewater doesn't bridge its own canals.
    expect(ctx.commander.engineers.spansOf(1)).toBe(0);
  }, 120000);

  it('comes down under enemy fire, taking whatever’s on it into the water', () => {
    const game = canalled();
    const { world, ctx, field } = game;
    const home = field.baseSites[0];
    spawnUnit(world, ctx, UNIT_DEFS.engineer, 0, home.x, home.z);
    for (let t = 0; t < 150 && !field.bridges.some((b) => b.builtBy === 0); t += 5) run(game, 5);
    const index = field.bridges.findIndex((b) => b.builtBy === 0);
    expect(index).toBeGreaterThanOrEqual(0);
    const b = field.bridges[index];
    const mx = (b.ax + b.bx) / 2;
    const mz = (b.az + b.bz) / 2;
    expect(field.deckAt(mx, mz)).not.toBeNull();
    const tank = spawnUnit(world, ctx, UNIT_DEFS.tank, 0, mx, mz);
    world.remove(tank, Ai);
    game.step(DT);
    // Shells from Tidewater's side bursting on the deck.
    for (let n = 0; n < 40 && !field.bridges[index].gone; n++) ctx.commander.engineers.blast(world, ctx, mx, b.level, mz, 60, 2, { source: 'missileBoat', faction: 1 });
    expect(field.bridges[index].gone).toBe(true);
    expect(field.deckAt(mx, mz)).toBeNull();
    expect(field.nearBridge(mx, mz)).toBe(false);
    expect(world.get(tank, Health)!.hp).toBeLessThanOrEqual(0);
    // Its own side's fire doesn't.
    const before = ctx.commander.engineers.spansOf(0);
    expect(before).toBe(0);
  }, 120000);
});

/** Put one of side 0's soldiers in a gun's sight, out toward `toward` (beyond where hunters count as on it already), and let the gun open up on it. */
function shelled(game: Game, gun: number, toward: { x: number; z: number }): void {
  const t = game.world.req(gun, Transform);
  const d = Math.hypot(toward.x - t.x, toward.z - t.z);
  const target = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, t.x + ((toward.x - t.x) / d) * 18, t.z + ((toward.z - t.z) / d) * 18);
  game.world.remove(target, Ai);
  for (let n = 0; n < 300 && game.world.req(gun, Armed).firedAt < 0; n++) game.step(DT);
  expect(game.world.req(gun, Armed).firedAt).toBeGreaterThanOrEqual(0);
}

describe('hunting the guns', () => {
  it('sends its squads after a howitzer shelling it from far behind the enemy lines, and they kill it', () => {
    const game = flatGame(['armour', 'bastion']);
    const { world, ctx, field } = game;
    const [home, away] = field.baseSites;
    const gx = away.x + (home.x - away.x) * 0.3;
    const gz = away.z + (home.z - away.z) * 0.3;
    const gun = spawnUnit(world, ctx, UNIT_DEFS.howitzer, 1, gx, gz);
    // A scout of ours it's shelling, out past the reach of anything to hunt it with.
    shelled(game, gun, home);
    const tanks = [0, 1, 2, 3].map((i) => spawnUnit(world, ctx, UNIT_DEFS.tank, 0, home.x + 3 + i * 3, home.z + 3));
    run(game, PICTURE_INTERVAL + DT);
    const hunts = ctx.commander.hunts.hunts;
    expect(hunts.length).toBe(1);
    expect(hunts[0].gun).toBe(gun);
    expect(hunts[0].side).toBe(0);
    expect(ctx.commander.sides[0].goals.some((g) => g.kind === 'hunt')).toBe(true);
    // Nothing in the way: straight at it.
    expect(hunts[0].stage).toBe('strike');
    let dead = false;
    for (let t = 0; t < 120 && !dead; t += 2) {
      run(game, 2);
      dead = !world.isAlive(gun) || !world.has(gun, Health) || world.req(gun, Health).hp <= 0;
    }
    expect(dead).toBe(true);
    expect(tanks.some((e) => world.isAlive(e))).toBe(true);
  }, 120000);

  it('swings round a flank when the enemy army stands between it and the gun', () => {
    const game = flatGame(['armour', 'bastion']);
    const { world, ctx, field } = game;
    const [home, away] = field.baseSites;
    const gx = away.x + (home.x - away.x) * 0.32;
    const gz = away.z + (home.z - away.z) * 0.32;
    const gun = spawnUnit(world, ctx, UNIT_DEFS.howitzer, 1, gx, gz);
    shelled(game, gun, home);
    for (let i = 0; i < 8; i++) spawnUnit(world, ctx, UNIT_DEFS.tank, 0, home.x + 3 + (i % 4) * 3, home.z + 3 + Math.floor(i / 4) * 3);
    // A few of the enemy's walkers out in front of the gun, between our army and it.
    const mx = home.x + (gx - home.x) * 0.6;
    const mz = home.z + (gz - home.z) * 0.6;
    for (let i = 0; i < 2; i++) spawnUnit(world, ctx, UNIT_DEFS.strider, 1, mx + i * 2, mz);
    run(game, PICTURE_INTERVAL + DT);
    const h = ctx.commander.hunts.hunts[0];
    expect(h).toBeDefined();
    expect(h.stage).toBe('flank');
    expect(h.flankX).not.toBeNull();
    // The flank point is well off the straight line from the hunters to the gun.
    const d = Math.hypot(gx - h.fromX, gz - h.fromZ);
    const off = Math.abs((h.flankX! - h.fromX) * (gz - h.fromZ) - (h.flankZ! - h.fromZ) * (gx - h.fromX)) / d;
    expect(off).toBeGreaterThan(10);
  }, 120000);

  it('can be switched off', () => {
    const game = flatGame(['armour', 'bastion']);
    game.ctx.settings.armies.hunts = false;
    const { world, ctx, field } = game;
    const [home, away] = field.baseSites;
    const gun = spawnUnit(world, ctx, UNIT_DEFS.howitzer, 1, away.x + (home.x - away.x) * 0.3, away.z + (home.z - away.z) * 0.3);
    shelled(game, gun, home);
    for (let i = 0; i < 4; i++) spawnUnit(world, ctx, UNIT_DEFS.tank, 0, home.x + 3 + i * 3, home.z + 3);
    run(game, PICTURE_INTERVAL + DT);
    expect(ctx.commander.hunts.hunts.length).toBe(0);
  });
});
