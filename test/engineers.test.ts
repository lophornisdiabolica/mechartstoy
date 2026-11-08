import { describe, expect, it } from 'vitest';
import { dig, Earthwork, landStaysLinked, layGround } from '../src/game/commander/engineers';
import { Ai, Building, Faction, Health, Transform } from '../src/game/components';
import { DOCTRINES } from '../src/game/doctrines';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Game } from '../src/game/game';
import { clearShot, muzzlePoint } from '../src/game/lineOfFire';
import { defaultSettings } from '../src/game/settings';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { volleyWeapon } from '../src/game/systems/targeting';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** A flat, dry map with nothing on it. */
function flatGame(seed = 4): Game {
  const s = defaultSettings();
  s.map.hills = 0;
  s.map.water = 0;
  s.map.towns = 0;
  s.map.outposts = 0;
  s.map.forest = 0;
  return new Game(seed, { settings: s, populate: false, autoSpawn: false });
}

/** Dig (or heap up) a stretch all the way, and lay its ground. */
function finish(game: Game, w: Earthwork): void {
  for (let n = 0; n < 100 && dig(game.world, game.ctx, w); n++);
  w.done = true;
  layGround(game.ctx, w);
}

const stretch = (kind: Earthwork['kind'], ax: number, az: number, bx: number, bz: number, level: number): Earthwork => ({ kind, side: 0, ax, az, bx, bz, level, effort: 0, done: false });

describe('guard towers', () => {
  it('fire an armour-piercing shell at tanks, and their cannon at trucks and infantry', () => {
    const cannon = BUILDING_DEFS.tower.weapon;
    expect(volleyWeapon(cannon, UNIT_DEFS.tank.armor)).toBe(cannon.heavy);
    expect(volleyWeapon(cannon, UNIT_DEFS.trooper.armor)).toBe(cannon);
  });

  it('wear a tank down in a way the cannon alone never did', () => {
    const game = flatGame();
    const b = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, game.ctx.buildings.tower, 1, b.x, b.z, 0);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + 10, b.z);
    game.world.remove(tank, Ai);
    run(game, 20);
    // The cannon alone did a tenth of a hit per shell: about 25 health in 20 seconds.
    expect(UNIT_DEFS.tank.hp - game.world.req(tank, Health).hp).toBeGreaterThan(100);
  });
});

describe('Tidewater engineering', () => {
  it('its dock builds only boats: skimmers come from a hover pad', () => {
    const dock = DOCTRINES.tidewater.production.dock!.table;
    for (const entry of dock) {
      expect(UNIT_DEFS[entry.unit].move).toBe('naval');
      expect(entry.ifDry).toBeUndefined();
    }
  });

  it('engineers put up a hover pad in a base that has a dock', () => {
    const s = defaultSettings();
    s.map.water = 1;
    s.factions[0].doctrine = 'tidewater';
    s.factions[1].doctrine = 'armour';
    const game = new Game(4, { settings: s });
    const ids = () => [...game.world.query(Building, Faction)].filter((e) => game.world.req(e, Faction).id === 0).map((e) => game.world.req(e, Building).def);
    expect(ids().some((d) => d.id === 'dock')).toBe(true);
    expect(ids().some((d) => d.id === 'hoverPad')).toBe(false);
    run(game, 90);
    const pad = ids().find((d) => d.id === 'hoverPad');
    expect(pad?.field).toBe(true);
  }, 60000);

  it('a dug canal is boat-deep water', () => {
    const game = flatGame();
    const { field } = game;
    const naval = game.ctx.navs.for('naval');
    const x = 0;
    const z0 = field.bounds.minZ + 6;
    expect(naval.terrainAllowsAt(x, z0 + 3)).toBe(false);
    finish(game, stretch('canal', x, z0, x, z0 + 6, field.seaLevel));
    expect(field.isWater(x, z0 + 3)).toBe(true);
    expect(naval.terrainAllowsAt(x, z0 + 3)).toBe(true);
    // Dry land either side of it.
    expect(field.isWater(x + 5, z0 + 3)).toBe(false);
  });

  it('never digs a canal that cuts one base off from another', () => {
    const game = flatGame();
    const { field } = game;
    // Right across the map between the bases: no.
    expect(landStaysLinked(game.ctx, { x: 0, z: field.bounds.minZ }, { x: 0, z: field.bounds.maxZ }, 2.3)).toBe(false);
    // Part of the way: fine.
    expect(landStaysLinked(game.ctx, { x: 0, z: field.bounds.minZ }, { x: 0, z: 0 }, 2.3)).toBe(true);
  });
});

describe('Legion earthworks', () => {
  it('soldiers in a trench shoot out over the berm, while shots at them from afar hit it', () => {
    const game = flatGame();
    const { world, ctx, field } = game;
    const b = game.field.baseSites[0];
    const level = field.heightAt(b.x, b.z);
    const soldier = spawnUnit(world, ctx, UNIT_DEFS.trooper, 0, b.x, b.z);
    const tank = spawnUnit(world, ctx, UNIT_DEFS.tank, 1, b.x + 14, b.z);
    for (const e of [soldier, tank]) world.remove(e, Ai);
    const tankShoots = () => clearShot(world, ctx, muzzlePoint(world, tank, Math.PI, 0.8, UNIT_DEFS.tank.weapon.muzzleHeight, ctx), soldier, tank, 1);
    const soldierShoots = () => clearShot(world, ctx, muzzlePoint(world, soldier, 0, 0.2, UNIT_DEFS.trooper.weapon.muzzleHeight, ctx), tank, soldier, 0);
    // In the open, both ways.
    expect(tankShoots()).toBe(true);
    expect(soldierShoots()).toBe(true);
    finish(game, stretch('trench', b.x, b.z - 3, b.x, b.z + 3, level));
    finish(game, stretch('berm', b.x + 1.8, b.z - 3.5, b.x + 1.8, b.z + 3.5, level));
    world.req(soldier, Transform).y = field.heightAt(b.x, b.z);
    expect(field.groundAt(b.x, b.z).id).toBe('trench');
    expect(tankShoots()).toBe(false);
    expect(soldierShoots()).toBe(true);
    // From close by, the tank gets a shot in.
    const t = world.req(tank, Transform);
    t.x = b.x + 3.2;
    t.y = field.heightAt(t.x, t.z);
    expect(tankShoots()).toBe(true);
  });

  it('Legion engineers dig a trench line and berm, and massing infantry man it', () => {
    const s = defaultSettings();
    s.factions[0].doctrine = 'legion';
    s.factions[1].doctrine = 'armour';
    const game = new Game(5, { settings: s });
    const eng = game.ctx.commander.engineers;
    let manned = 0;
    for (let i = 0; i < 400 / DT && manned === 0; i++) {
      game.step(DT);
      if (i % 150 !== 0 || !eng.works.some((w) => w.kind === 'trench' && w.done)) continue;
      for (const e of game.world.query(Ai, Faction, Transform)) {
        const t = game.world.req(e, Transform);
        if (game.world.req(e, Faction).id === 0 && game.field.groundAt(t.x, t.z).id === 'trench') manned++;
      }
    }
    expect(eng.works.some((w) => w.side === 0 && w.kind === 'berm')).toBe(true);
    expect(manned).toBeGreaterThan(0);
    // Nobody else digs.
    expect(eng.works.every((w) => w.side === 0)).toBe(true);
  }, 120000);
});

describe('fortifying', () => {
  it('Talon walls a valley out toward the enemy that Armour leaves alone', () => {
    const game = flatGame(6);
    const { field, ctx } = game;
    const home = field.baseSites[0];
    const enemy = field.baseSites[1];
    // A steep ridge across the map, 40% of the way to the enemy, with a gap in it.
    const ridgeX = home.x + (enemy.x - home.x) * 0.42;
    const gapZ = (home.z + enemy.z) / 2;
    const { cols, rows } = field.config;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        if (Math.abs(field.vertexX(i) - ridgeX) < 2.2 && Math.abs(field.vertexZ(j) - gapZ) > 3.5) field.heights[j * (cols + 1) + i] = field.seaLevel + 7;
      }
    }
    field.changed({ i0: 0, j0: 0, i1: cols - 1, j1: rows - 1 });
    const choke = (doctrine: 'talon' | 'armour') => {
      ctx.settings.factions[0].doctrine = doctrine;
      return (ctx.commander.engineers as unknown as { findChoke(c: typeof ctx, s: number, e: number): { x: number; z: number; segments: number } | null }).findChoke(ctx, 0, 1);
    };
    const talon = choke('talon');
    expect(talon).not.toBeNull();
    expect(Math.abs(talon!.x - ridgeX)).toBeLessThan(3);
    expect(Math.abs(talon!.z - gapZ)).toBeLessThan(2.5);
    expect(talon!.segments).toBeGreaterThanOrEqual(2);
    // Too far out for a doctrine that can't get round it.
    expect(choke('armour')).toBeNull();
  });

  it('what engineers build doesn’t keep a side in a Conquest battle', () => {
    const s = defaultSettings();
    s.mode = 'conquest';
    const game = new Game(4, { settings: s, populate: false, autoSpawn: false });
    const { world, ctx } = game;
    const [a, b] = game.field.baseSites;
    spawnBuilding(world, ctx, { ...ctx.buildings.hoverPad, field: true }, 0, a.x, a.z, 0);
    spawnBuilding(world, ctx, ctx.buildings.hoverPad, 1, b.x, b.z, 0);
    run(game, 1);
    expect(ctx.sides.eliminated[0]).toBe(true);
    expect(ctx.sides.eliminated[1]).toBe(false);
  });
});
