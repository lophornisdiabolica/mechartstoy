import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Ammo, Armed, Falling, GroundFollow, Health, Mover, Transform, Wreck } from '../src/game/components';
import { DOCTRINE_IDS, DOCTRINES, TEST_DOCTRINE_IDS, doctrineUnits } from '../src/game/doctrines';
import { FIRE_CELL, LIT, WHITE_HOT, heatPerShot } from '../src/game/fire';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { applyDamage } from '../src/game/systems/projectiles';
import { UNIT_DEFS, UnitDef } from '../src/game/units';
import { defaultVariety } from '../src/game/variety';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** An empty map with production off, sides 0 and 1 on these doctrines (see territory.test.ts). */
function emptyGame(doctrines: [string, string] = ['armour', 'armour'], seed = 4): Game {
  const s = defaultSettings();
  s.armies.caps.super = 0;
  s.factions.forEach((f, i) => (f.doctrine = (doctrines[i] ?? f.doctrine) as typeof f.doctrine));
  const game = new Game(seed, { settings: s, populate: false });
  for (const site of game.field.baseSites) {
    const a = Math.atan2(-site.z, -site.x);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, site.faction, site.x - Math.cos(a) * site.radius * 0.7, site.z - Math.sin(a) * site.radius * 0.7, 0);
  }
  return game;
}

/** Open, dry, flat ground round a base, at least `room` from anything built. */
function openGround(game: Game, faction = 0): { x: number; z: number } {
  const site = game.field.baseSites[faction];
  const dir = Math.sign(-site.x) || 1;
  for (let d = 10; d < 40; d += 2) {
    const x = site.x + dir * d;
    if (game.ctx.nav.fitsAt(x, site.z, 4) && !game.field.isWater(x, site.z)) return { x, z: site.z };
  }
  return { x: site.x + dir * 12, z: site.z };
}

describe('Talon: going over buildings', () => {
  it('spiders plan straight over buildings, walkers only over walls, tanks round both', () => {
    const game = emptyGame();
    const p = openGround(game);
    const wall = { x: p.x, z: p.z + 10 };
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.barracks, 0, p.x, p.z, 0);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.wall, 0, wall.x, wall.z, 0);
    run(game, 0.1);
    const navs = game.ctx.navs;
    expect(navs.land.fitsAt(p.x, p.z)).toBe(false);
    expect(navs.for('walker').fitsAt(p.x, p.z)).toBe(false);
    expect(navs.for('climber').fitsAt(p.x, p.z)).toBe(true);
    expect(navs.land.fitsAt(wall.x, wall.z)).toBe(false);
    expect(navs.for('walker').fitsAt(wall.x, wall.z)).toBe(true);
    expect(navs.for('climber').fitsAt(wall.x, wall.z)).toBe(true);
  });

  it('a spider climbs up onto a building it walks over, and back down', () => {
    const game = emptyGame();
    const p = openGround(game);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.barracks, 0, p.x, p.z, 0);
    const spider = spawnUnit(game.world, game.ctx, UNIT_DEFS.spider, 0, p.x - 6, p.z);
    game.world.remove(spider, Ai);
    const m = game.world.req(spider, Mover);
    m.targetX = p.x + 6;
    m.targetZ = p.z;
    let highest = 0;
    for (let i = 0; i < 6 / DT; i++) {
      game.step(DT);
      const t = game.world.req(spider, Transform);
      highest = Math.max(highest, t.y - game.field.surfaceAt(t.x, t.z));
    }
    const t = game.world.req(spider, Transform);
    expect(t.x).toBeGreaterThan(p.x + 3);
    expect(highest).toBeGreaterThan(BUILDING_DEFS.barracks.height * 0.7);
    run(game, 2);
    expect(t.y - game.field.surfaceAt(t.x, t.z)).toBeLessThan(0.2);
  });

  it("walkers don't waste shots on walls, but tanks do", () => {
    const game = emptyGame();
    const p = openGround(game, 1);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.wall, 1, p.x, p.z, 0);
    const strider = spawnUnit(game.world, game.ctx, UNIT_DEFS.strider, 0, p.x, p.z + 6);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, p.x, p.z - 6);
    for (const e of [strider, tank]) game.world.remove(e, Ai);
    run(game, 1);
    expect(game.world.req(strider, Armed).target).toBeNull();
    expect(game.world.req(tank, Armed).target).not.toBeNull();
  });
});

describe('Bastion', () => {
  it('its scout copters spot for its howitzers; other doctrines’ do not', () => {
    for (const [doctrine, spots] of [['bastion', true], ['armour', false]] as const) {
      const game = emptyGame([doctrine, 'armour']);
      const site = game.field.baseSites[0];
      const dir = Math.sign(-site.x);
      const range = UNIT_DEFS.howitzer.weapon.range;
      const gun = spawnUnit(game.world, game.ctx, UNIT_DEFS.howitzer, 0, site.x, site.z);
      const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, site.x + dir * (range - 2), site.z);
      const scout = spawnUnit(game.world, game.ctx, UNIT_DEFS.scout, 0, site.x + dir * (range - 10), site.z);
      for (const e of [gun, tank, scout]) game.world.remove(e, Ai);
      run(game, 1);
      expect(game.world.req(gun, Armed).target).toBe(spots ? tank : null);
    }
  });

  it('the spider test variant is off by default but builds a Siege Spider when picked', () => {
    expect(DOCTRINE_IDS).not.toContain('bastionSpider');
    expect(TEST_DOCTRINE_IDS).toContain('bastionSpider');
    expect(defaultVariety().doctrines).not.toContain('bastionSpider');
    expect(defaultSettings().factions.map((f) => f.doctrine)).not.toContain('bastionSpider');
    const units = doctrineUnits(DOCTRINES.bastionSpider);
    expect(units).toContain('siegeSpider');
    expect(units).not.toContain('fortress');
    expect(units).toContain('howitzer');
  });
});

describe('Firestorm: burning ground', () => {
  /** Pour a flamer's fire onto one spot for a while, from `flamers` of them, as the weapon system would. */
  function pour(game: Game, x: number, z: number, flamers: number, seconds: number): void {
    const w = UNIT_DEFS.cinderWalker.weapon;
    const every = w.cooldown / w.burst;
    for (let s = 0; s < seconds; s += every) {
      for (let f = 0; f < flamers; f++) game.ctx.fire.add(x, z, w.splash, heatPerShot(w), 0, 'cinderWalker');
      run(game, every);
    }
  }

  it('one flamer keeps ground hot, a pack makes it white-hot, and it cools to scorch, then nothing', () => {
    const game = emptyGame(['firestorm', 'armour']);
    const p = openGround(game, 1);
    pour(game, p.x, p.z, 1, 8);
    const one = game.ctx.fire.heatAt(p.x, p.z);
    expect(one).toBeGreaterThan(LIT);
    expect(one).toBeLessThan(WHITE_HOT);
    pour(game, p.x, p.z, 3, 8);
    expect(game.ctx.fire.heatAt(p.x, p.z)).toBeGreaterThan(WHITE_HOT);
    run(game, 12);
    const k = game.ctx.fire.cellAt(p.x, p.z);
    expect(game.ctx.fire.heat[k]).toBeLessThan(LIT);
    expect(game.ctx.fire.scorch[k]).toBeGreaterThan(0);
    run(game, 20);
    expect(game.ctx.fire.count).toBe(0);
  });

  it('white-hot ground burns through a tank’s armour; hot ground barely scratches it', () => {
    const burnt = (flamers: number) => {
      const game = emptyGame(['firestorm', 'armour']);
      const p = openGround(game, 1);
      const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.lancer, 1, p.x, p.z);
      game.world.remove(tank, Ai);
      game.world.remove(tank, Armed);
      pour(game, p.x, p.z, flamers, 6);
      return UNIT_DEFS.lancer.hp - game.world.req(tank, Health).hp;
    };
    const hot = burnt(1);
    const white = burnt(3);
    expect(white).toBeGreaterThan(hot * 4);
    expect(white).toBeGreaterThan(40);
  });

  it('flame shots light the ground where they land', () => {
    const game = emptyGame(['firestorm', 'armour']);
    const p = openGround(game, 1);
    const flamer = spawnUnit(game.world, game.ctx, UNIT_DEFS.flameTrooper, 0, p.x - 4, p.z);
    const target = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, p.x, p.z);
    for (const e of [flamer, target]) game.world.remove(e, Ai);
    game.world.remove(target, Armed);
    run(game, 3);
    expect(game.ctx.fire.count).toBeGreaterThan(0);
    expect(game.ctx.fire.heatAt(p.x, p.z) + game.ctx.fire.heatAt(p.x - FIRE_CELL, p.z)).toBeGreaterThan(0);
  });
});

describe('Firestorm: fuel tanks', () => {
  it('a badly hurt flame unit breaks off and drives at the nearest enemy', () => {
    const game = emptyGame(['firestorm', 'armour']);
    const p = openGround(game, 1);
    const buggy = spawnUnit(game.world, game.ctx, UNIT_DEFS.scorchBuggy, 0, p.x, p.z);
    const enemy = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, p.x, p.z + 22);
    game.world.remove(enemy, Ai);
    game.world.remove(enemy, Armed);
    game.world.req(buggy, Health).hp = UNIT_DEFS.scorchBuggy.hp * 0.2;
    run(game, 0.5);
    const m = game.world.req(buggy, Mover);
    expect(m.targetZ).toBeCloseTo(p.z + 22, 0);
  });

  it('blows up when destroyed, hurting both sides round it, and leaves the ground burning', () => {
    const game = emptyGame(['firestorm', 'armour']);
    const p = openGround(game, 1);
    const walker = spawnUnit(game.world, game.ctx, UNIT_DEFS.cinderWalker, 0, p.x, p.z);
    const own = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, p.x + 1.5, p.z);
    const enemy = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, p.x, p.z + 2.5);
    for (const e of [walker, own, enemy]) game.world.remove(e, Ai);
    for (const e of [walker, own, enemy]) game.world.remove(e, Armed);
    run(game, 0.1);
    applyDamage(game.world, game.ctx, walker, 1e6, { source: 'tank', faction: 1 });
    run(game, 0.1);
    expect(game.world.get(own, Health)?.hp ?? 0).toBeLessThan(UNIT_DEFS.trooper.hp);
    expect(game.world.req(enemy, Health).hp).toBeLessThan(UNIT_DEFS.tank.hp);
    expect(game.ctx.fire.heatAt(p.x, p.z)).toBeGreaterThan(LIT);
  });
});

describe('Skyline: aircraft', () => {
  it('a plane with nothing to do keeps flying round in circles', () => {
    const game = emptyGame(['skyline', 'armour']);
    const site = game.field.baseSites[0];
    const jet = spawnUnit(game.world, game.ctx, UNIT_DEFS.jet, 0, site.x, site.z);
    game.world.remove(jet, Ai);
    const t = game.world.req(jet, Transform);
    let far = 0;
    for (let i = 0; i < 20 / DT; i++) {
      const x = t.x;
      const z = t.z;
      game.step(DT);
      // Always moving at full speed...
      expect(Math.hypot(t.x - x, t.z - z) / DT).toBeCloseTo(UNIT_DEFS.jet.speed, 1);
      far = Math.max(far, Math.hypot(t.x - site.x, t.z - site.z));
    }
    // ...but staying round where it was left.
    expect(far).toBeLessThan(25);
  });

  it('once its ammunition is spent it flies home to the airpad to rearm, then is ready again', () => {
    const game = emptyGame(['skyline', 'armour']);
    const site = game.field.baseSites[0];
    const p = openGround(game, 0);
    const pad = spawnBuilding(game.world, game.ctx, BUILDING_DEFS.airpad, 0, site.x, site.z, 0);
    const gunship = spawnUnit(game.world, game.ctx, UNIT_DEFS.gunship, 0, p.x + 10, p.z + 10);
    const ammo = game.world.req(gunship, Ammo);
    ammo.left = 0;
    ammo.rearming = true;
    const t = game.world.req(gunship, Transform);
    const pt = game.world.req(pad, Transform);
    let landed = false;
    for (let i = 0; i < 25 / DT && ammo.rearming; i++) {
      game.step(DT);
      // It sets down on the pad to be loaded.
      if (ammo.readyAt !== null) {
        expect(Math.hypot(t.x - pt.x, t.z - pt.z)).toBeLessThan(4);
        landed ||= game.world.req(gunship, GroundFollow).offset < 2;
      }
    }
    expect(landed).toBe(true);
    expect(ammo.rearming).toBe(false);
    expect(ammo.left).toBe(UNIT_DEFS.gunship.ammo);
  });

  it('a shot-down plane flies on as it falls, and explodes where it hits the ground', () => {
    const game = emptyGame(['skyline', 'armour']);
    const p = openGround(game, 1);
    const bomber = spawnUnit(game.world, game.ctx, UNIT_DEFS.bomber, 0, p.x, p.z);
    game.world.remove(bomber, Ai);
    run(game, 0.5);
    const t = game.world.req(bomber, Transform);
    const from = { x: t.x, z: t.z };
    applyDamage(game.world, game.ctx, bomber, 1e6, { source: 'flakTank', faction: 1 });
    run(game, 0.1);
    expect(game.world.has(bomber, Wreck)).toBe(true);
    expect(game.world.has(bomber, Falling)).toBe(true);
    let impacts = 0;
    game.events.on('impact', () => impacts++);
    run(game, 3);
    expect(game.world.has(bomber, Falling)).toBe(false);
    expect(game.world.req(bomber, GroundFollow).offset).toBe(0);
    expect(Math.hypot(t.x - from.x, t.z - from.z)).toBeGreaterThan(5);
    expect(impacts).toBeGreaterThan(0);
  });

  it('every Skyline plane flies (never parks), and its gunships and bombers carry limited ammunition', () => {
    for (const id of doctrineUnits(DOCTRINES.skyline)) {
      const def: UnitDef = UNIT_DEFS[id];
      if (def.fixedWing) expect(def.move).toBe('air');
    }
    expect(UNIT_DEFS.bomber.fixedWing).toBe(true);
    expect(UNIT_DEFS.gunship.ammo).toBeGreaterThan(0);
    expect(doctrineUnits(DOCTRINES.skyline)).toContain('jet');
  });
});
