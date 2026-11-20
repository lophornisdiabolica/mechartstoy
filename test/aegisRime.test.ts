import { describe, expect, it } from 'vitest';
import { Ai, Armed, Building, Faction, Health, Mover, Shield, Transform } from '../src/game/components';
import { DOCTRINES } from '../src/game/doctrines';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS, UnitDef } from '../src/game/units';
import { hitDome } from '../src/game/shields';
import { FROZEN } from '../src/game/frost';

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

/** A unit that stands there and takes it. */
function dummy(game: Game, def: UnitDef, faction: number, x: number, z: number): number {
  const e = standing(game, def, faction, x, z);
  game.world.req(e, Armed).cooldown = Infinity;
  return e;
}

describe('Aegis: energy domes', () => {
  it('a dome stops shells from outside: it soaks them up and the truck under it is unhurt', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const truck = dummy(game, UNIT_DEFS.domeTruck, 0, base.x, base.z);
    standing(game, UNIT_DEFS.tank, 1, base.x + 12, base.z);
    let hits = 0;
    game.events.on('shieldHit', (h) => h.entity === truck && hits++);
    run(game, 8);
    expect(hits).toBeGreaterThan(0);
    expect(game.world.req(truck, Shield).hp).toBeLessThan(UNIT_DEFS.domeTruck.shield!.hp);
    expect(game.world.req(truck, Health).hp).toBe(UNIT_DEFS.domeTruck.hp);
  });

  it('shots from inside go out freely', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.domeTruck, 0, base.x, base.z);
    const tank = standing(game, UNIT_DEFS.tank, 0, base.x + 1.5, base.z + 2);
    const enemy = dummy(game, UNIT_DEFS.tank, 1, base.x + 12, base.z + 2);
    run(game, 8);
    expect(game.world.req(tank, Armed).target).toBe(enemy);
    expect(game.world.req(enemy, Health).hp).toBeLessThan(UNIT_DEFS.tank.hp);
  });

  it('lobbed shells fall straight through it', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const truck = dummy(game, UNIT_DEFS.domeTruck, 0, base.x, base.z);
    standing(game, UNIT_DEFS.howitzer, 1, base.x + 20, base.z);
    run(game, 15);
    expect(game.world.req(truck, Health).hp).toBeLessThan(UNIT_DEFS.domeTruck.hp);
    expect(game.world.req(truck, Shield).hp).toBe(UNIT_DEFS.domeTruck.shield!.hp);
  });

  it('collapses when it takes more than it has, then comes back weaker after a while', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const truck = dummy(game, UNIT_DEFS.domeTruck, 0, base.x, base.z);
    run(game, 0.1);
    expect(game.ctx.domes.of(truck)).toBeDefined();
    let downs = 0;
    game.events.on('shieldDown', (d) => d.entity === truck && downs++);
    hitDome(game.world, game.ctx, truck, 1000, base.x, 1, base.z, null);
    expect(downs).toBe(1);
    expect(game.ctx.domes.of(truck)).toBeUndefined();
    run(game, UNIT_DEFS.domeTruck.shield!.downTime - 1);
    expect(game.ctx.domes.of(truck)).toBeUndefined();
    run(game, 1.5);
    expect(game.ctx.domes.of(truck)).toBeDefined();
    const s = game.world.req(truck, Shield);
    expect(s.hp).toBeLessThan(s.def.hp * 0.5);
  });

  it('lances drain a dome faster than their damage', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const truck = dummy(game, UNIT_DEFS.domeTruck, 0, base.x, base.z);
    standing(game, UNIT_DEFS.lanceWalker, 1, base.x + 12, base.z);
    let first = 0;
    game.events.on('shieldHit', (h) => h.entity === truck && first === 0 && (first = UNIT_DEFS.domeTruck.shield!.hp * (1 - h.share)));
    run(game, 6);
    const w = UNIT_DEFS.lanceWalker.weapon;
    expect(first).toBeCloseTo(w.damage * w.breaker!, 5);
  });
});

describe('Rime: frost', () => {
  it('cryo shots frost the ground, and enemies on it slow down while allies do not', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.cryoTrooper, 0, base.x, base.z);
    const enemy = dummy(game, UNIT_DEFS.tank, 1, base.x + 6, base.z);
    run(game, 5);
    const t = game.world.req(enemy, Transform);
    expect(game.ctx.frost.at(t.x, t.z)).toBeGreaterThan(FROZEN);
    expect(game.ctx.frost.paceAt(game.ctx, t.x, t.z, 1)).toBeLessThan(0.9);
    expect(game.ctx.frost.paceAt(game.ctx, t.x, t.z, 0)).toBe(1);
  });

  it('frost thaws on its own, and fire melts it at once', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    game.ctx.frost.add(base.x, base.z, 2, 3, 0);
    game.ctx.frost.add(base.x + 10, base.z, 2, 3, 0);
    game.ctx.fire.add(base.x + 10, base.z, 2, 4, 1, 'flameTrooper');
    run(game, 0.2);
    expect(game.ctx.frost.at(base.x, base.z)).toBeGreaterThan(2);
    expect(game.ctx.frost.at(base.x + 10, base.z)).toBe(0);
    run(game, 9);
    expect(game.ctx.frost.at(base.x, base.z)).toBe(0);
  });

  it('shard guns shatter what stands on frost: more damage there', () => {
    const hurt = (frozen: boolean) => {
      const game = emptyGame();
      const base = game.field.baseSites[0];
      // Without the light frost its own shells lay, so only the frost laid here counts.
      const def = { ...UNIT_DEFS.shardTank, weapon: { ...UNIT_DEFS.shardTank.weapon, frost: undefined } };
      standing(game, def, 0, base.x, base.z);
      const enemy = dummy(game, UNIT_DEFS.tank, 1, base.x + 10, base.z);
      let shattered = 0;
      game.events.on('shatter', () => shattered++);
      for (let i = 0; i < 4 / DT; i++) {
        if (frozen) game.ctx.frost.add(base.x + 10, base.z, 2, 0.2, 0);
        game.step(DT);
      }
      return { lost: UNIT_DEFS.tank.hp - game.world.req(enemy, Health).hp, shattered };
    };
    const plain = hurt(false);
    const iced = hurt(true);
    expect(plain.shattered).toBe(0);
    expect(iced.shattered).toBeGreaterThan(0);
    expect(iced.lost).toBeGreaterThan(plain.lost * 1.4);
  });

  it('the Glacier freezes the ground round it as it walks', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const g = dummy(game, UNIT_DEFS.glacier, 0, base.x, base.z);
    run(game, 3);
    const t = game.world.req(g, Transform);
    expect(game.ctx.frost.at(t.x + 5, t.z)).toBeGreaterThan(FROZEN);
    expect(game.ctx.frost.hostileAt(game.ctx, t.x + 5, t.z, 1)).toBe(true);
    // A tank walking into it crawls.
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, t.x + 5, t.z);
    const m = game.world.req(tank, Mover);
    expect(game.ctx.frost.paceAt(game.ctx, t.x + 5, t.z, 1) * m.speed).toBeLessThan(m.speed * 0.8);
  });
});

describe('Aegis and Rime bases', () => {
  const battle = (doctrines: [string, string]) => {
    const s = defaultSettings();
    s.factions.forEach((f, i) => (f.doctrine = doctrines[i] as typeof f.doctrine));
    return new Game(4, { settings: s });
  };
  const buildingOf = (game: Game, faction: number, id: string) =>
    [...game.world.query(Building, Faction)].find((e) => game.world.req(e, Faction).id === faction && game.world.req(e, Building).def.id === id);

  it('Aegis builds a shield works with a dome over the base', () => {
    const game = battle(['aegis', 'rime']);
    run(game, 15);
    const works = buildingOf(game, 0, DOCTRINES.aegis.signature);
    expect(works).toBeDefined();
    expect(game.ctx.domes.of(works!)).toBeDefined();
  }, 30000);

  it('Rime builds a cryo plant that keeps the ground round it frozen', () => {
    const game = battle(['aegis', 'rime']);
    run(game, 15);
    const plant = buildingOf(game, 1, DOCTRINES.rime.signature);
    expect(plant).toBeDefined();
    const t = game.world.req(plant!, Transform);
    expect(game.ctx.frost.hostileAt(game.ctx, t.x + 6, t.z, 0)).toBe(true);
  }, 30000);
});
