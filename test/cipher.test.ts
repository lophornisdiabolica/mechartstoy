import { describe, expect, it } from 'vitest';
import { Ai, Armed, Arsenal, Building, Faction, Hacked, Health, Transform } from '../src/game/components';
import { DOCTRINES } from '../src/game/doctrines';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS, UnitDef } from '../src/game/units';
import { HACK_PROOF, reloadPace } from '../src/game/hacking';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function emptyGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

/** A unit that stands where it's put and fights only what comes into range. */
function standing(game: Game, def: UnitDef, faction: number, x: number, z: number): number {
  const e = spawnUnit(game.world, game.ctx, def, faction, x, z);
  game.world.remove(e, Ai);
  return e;
}

describe('Cipher: hacking', () => {
  it('a hack van turns an enemy tank to its side for a while, then it comes back and cannot be turned again at once', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.hackVan, 0, base.x, base.z);
    // A free tank (with its own AI) so there's something to set aside and give back.
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    game.world.req(tank, Armed).cooldown = Infinity;
    let turnedAt = -1;
    let backAt = -1;
    game.events.on('hacked', (h) => {
      if (h.entity !== tank) return;
      if (h.back) backAt = game.world.time;
      else turnedAt = game.world.time;
    });
    for (let i = 0; i < 6 / DT && turnedAt < 0; i++) game.step(DT);
    expect(turnedAt).toBeGreaterThan(0);
    expect(game.world.req(tank, Faction).id).toBe(0);
    expect(game.world.has(tank, Ai)).toBe(false);
    run(game, UNIT_DEFS.hackVan.weapon.hack! + 0.5);
    expect(backAt - turnedAt).toBeCloseTo(UNIT_DEFS.hackVan.weapon.hack!, 0);
    expect(game.world.req(tank, Faction).id).toBe(1);
    expect(game.world.has(tank, Ai)).toBe(true);
    // The truck reloads well before the tank is open to it again, but the hack doesn't take.
    run(game, HACK_PROOF - 2);
    expect(game.world.req(tank, Faction).id).toBe(1);
    expect(game.world.get(tank, Hacked)?.turned).toBe(false);
  });

  it('a turned tank fights its old friends', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const truck = standing(game, UNIT_DEFS.hackVan, 0, base.x, base.z);
    game.world.req(truck, Armed).cooldown = 0;
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    // The tank holds its fire until it's been turned.
    game.world.req(tank, Armed).cooldown = 1.5;
    const friend = standing(game, UNIT_DEFS.tank, 1, base.x + 16, base.z);
    game.world.req(friend, Armed).cooldown = Infinity;
    run(game, 7);
    expect(game.world.req(friend, Health).hp).toBeLessThan(UNIT_DEFS.tank.hp);
  });

  it('hack weapons leave infantry and super units alone', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const truck = standing(game, UNIT_DEFS.hackVan, 0, base.x, base.z);
    const trooper = standing(game, UNIT_DEFS.trooper, 1, base.x + 6, base.z);
    const titan = standing(game, UNIT_DEFS.titan, 1, base.x, base.z + 9);
    game.world.req(trooper, Armed).cooldown = Infinity;
    game.world.req(titan, Armed).cooldown = Infinity;
    // Its pintle gun would make short work of the trooper.
    for (const a of game.world.req(truck, Arsenal).arms) a.cooldown = Infinity;
    run(game, 4);
    expect(game.world.req(truck, Armed).target).toBeNull();
    expect(game.world.req(trooper, Faction).id).toBe(1);
    expect(game.world.req(titan, Faction).id).toBe(1);
  });

  it('a jammer slows the enemy guns round it, and only the enemy\'s', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.jammer, 0, base.x, base.z);
    const enemy = standing(game, UNIT_DEFS.tank, 1, base.x + 6, base.z);
    const ally = standing(game, UNIT_DEFS.tank, 0, base.x - 3, base.z);
    const far = standing(game, UNIT_DEFS.tank, 1, base.x + 20, base.z);
    // Its first pulse comes within one interval.
    run(game, UNIT_DEFS.jammer.jam!.every + 0.1);
    expect(reloadPace(game.world, game.world.req(enemy, Armed))).toBe(UNIT_DEFS.jammer.jam!.pace);
    expect(reloadPace(game.world, game.world.req(ally, Armed))).toBe(1);
    expect(reloadPace(game.world, game.world.req(far, Armed))).toBe(1);
  });
});

describe('Cipher: arc tanks', () => {
  it('lightning arcs from the soldier it hits to the ones round it', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.arcTank, 0, base.x, base.z);
    const squad = [0, 1, 2, 3].map((i) => {
      const e = standing(game, UNIT_DEFS.trooper, 1, base.x + 8 + (i % 2) * 1.2, base.z + Math.floor(i / 2) * 1.2);
      game.world.req(e, Armed).cooldown = Infinity;
      return e;
    });
    let arcs = 0;
    game.events.on('arc', () => arcs++);
    run(game, 3);
    expect(arcs).toBeGreaterThan(0);
    const hurt = squad.filter((e) => !game.world.isAlive(e) || (game.world.get(e, Health)?.hp ?? 0) < UNIT_DEFS.trooper.hp);
    expect(hurt.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Cipher base', () => {
  it('Cipher builds an uplink mast', () => {
    const s = defaultSettings();
    s.factions.forEach((f, i) => (f.doctrine = (['cipher', 'armour'] as const)[i] ?? f.doctrine));
    const game = new Game(4, { settings: s });
    run(game, 15);
    const mast = [...game.world.query(Building, Faction)].find((e) => game.world.req(e, Faction).id === 0 && game.world.req(e, Building).def.id === DOCTRINES.cipher.signature);
    expect(mast).toBeDefined();
    expect(game.world.has(mast!, Transform)).toBe(true);
  }, 30000);
});
