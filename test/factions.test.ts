import { describe, expect, it } from 'vitest';
import { Armed, Faction, Health, Mover, Producer, Transform, Unit } from '../src/game/components';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { Game } from '../src/game/game';
import { BattleSettings, battlefieldConfig, defaultFaction, defaultSettings, MAX_FACTIONS, seating } from '../src/game/settings';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function sides(teams: number[], mode: 'eternal' | 'conquest' = 'eternal'): BattleSettings {
  const s = defaultSettings();
  s.mode = mode;
  s.factions = teams.map((team, i) => ({ ...defaultFaction(i), team }));
  return s;
}

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** Destroy every production building a side has. */
function wreck(game: Game, faction: number): void {
  for (const e of game.world.query(Producer, Faction)) if (game.world.req(e, Faction).id === faction) game.world.req(e, Health).hp = 0;
}

describe('more than two sides', () => {
  it('fits every base on the map, apart, on dry land joined to the others', () => {
    for (let n = 2; n <= MAX_FACTIONS; n++) {
      for (const size of ['small', 'large'] as const) {
        const s = sides(Array.from({ length: n }, (_, i) => i));
        s.map.size = size;
        s.map.water = 1;
        const game = new Game(n * 13 + 1, { settings: s, populate: false, autoSpawn: false });
        const { baseSites } = game.field;
        expect(baseSites.map((b) => b.faction)).toEqual(Array.from({ length: n }, (_, i) => i));
        for (const a of baseSites) {
          expect(game.field.contains(a.x, a.z, a.radius)).toBe(true);
          expect(game.ctx.nav.connected(a, baseSites[0])).toBe(true);
          for (const b of baseSites) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.radius + b.radius + 8);
        }
      }
    }
  });

  it('two sides keep the original map size; more sides grow it', () => {
    expect(battlefieldConfig(sides([0, 1])).cols).toBe(battlefieldConfig(defaultSettings()).cols);
    expect(battlefieldConfig(sides([0, 1, 2, 3, 4, 5])).cols).toBeGreaterThan(battlefieldConfig(defaultSettings()).cols);
  });

  it('seats teammates next to each other', () => {
    expect(seating(sides([0, 1, 0, 1]))).toEqual([0, 2, 1, 3]);
    expect(seating(sides([2, 0, 0, 1]))).toEqual([0, 1, 2, 3]);
  });

  it('allies hold fire and attack the same enemy', () => {
    const game = new Game(4, { settings: sides([0, 0, 1, 1]), populate: false, autoSpawn: false });
    const { sides: relations } = game.ctx;
    expect(relations.hostile(0, 1)).toBe(false);
    expect(relations.allied(0, 1)).toBe(true);
    expect(relations.hostile(0, 2)).toBe(true);
    expect(relations.hostile(0, -1)).toBe(false);
    for (let attack = 0; attack < 20; attack++) {
      const target = relations.target(0, attack);
      expect([2, 3]).toContain(target);
      expect(relations.target(1, attack)).toBe(target);
    }
  });

  it('a free-for-all spreads attacks over every enemy, nearest most often', () => {
    const game = new Game(9, { settings: sides([0, 1, 2, 3]), populate: false, autoSpawn: false });
    const counts = [0, 0, 0, 0];
    for (let attack = 0; attack < 400; attack++) counts[game.ctx.sides.target(0, attack)!]++;
    expect(counts[0]).toBe(0);
    for (const f of [1, 2, 3]) expect(counts[f]).toBeGreaterThan(20);
    const base = game.field.baseSites;
    const dist = (f: number) => Math.hypot(base[f].x - base[0].x, base[f].z - base[0].z);
    const nearest = [1, 2, 3].sort((a, b) => dist(a) - dist(b))[0];
    expect(Math.max(...counts)).toBe(counts[nearest]);
  });

  it('conquest: knocked-out sides drop out and the last team standing wins', () => {
    const game = new Game(6, { settings: sides([0, 1, 2], 'conquest') });
    const events: string[] = [];
    game.events.on('sideEliminated', (e) => events.push(`out ${e.faction}`));
    game.events.on('battleOver', (o) => events.push(`won ${o.winners}`));
    run(game, 1);
    wreck(game, 1);
    run(game, 1);
    expect(game.outcome).toBeNull();
    expect(game.ctx.sides.enemiesOf(0)).toEqual([2]);
    expect(game.ctx.sides.target(0, 5)).toBe(2);
    wreck(game, 2);
    run(game, 1);
    expect(events).toEqual(['out 1', 'out 2', 'won 0']);
    expect(game.outcome?.team).toBe(0);
  });

  it('conquest: a team wins together, even if one of them fell', () => {
    const game = new Game(7, { settings: sides([0, 0, 1, 1], 'conquest') });
    run(game, 1);
    wreck(game, 0);
    run(game, 1);
    expect(game.outcome).toBeNull();
    wreck(game, 2);
    wreck(game, 3);
    run(game, 1);
    expect(game.outcome?.team).toBe(0);
    expect(game.outcome?.winners).toEqual([0, 1]);
  });

  it('sides and teams round-trip through the link', () => {
    const s = sides([0, 1, 0, 2, 2]);
    s.factions[4].name = 'Late Arrivals';
    const p = settingsToParams(s);
    expect(p.get('sides')).toBe('5');
    expect(p.get('team3')).toBe('1');
    expect(settingsFromParams(new URLSearchParams(p.toString())).factions).toEqual(s.factions);
    // Out-of-range counts and teams are ignored or clamped.
    expect(settingsFromParams(new URLSearchParams('sides=40')).factions.length).toBe(MAX_FACTIONS);
    expect(settingsFromParams(new URLSearchParams('sides=3&team2=9')).factions[1].team).toBe(1);
  });

  it('opening armies form up in front of their own base, however many sides', () => {
    for (const n of [2, 6, 8]) {
      const game = new Game(n, { settings: sides(Array.from({ length: n }, (_, i) => i)) });
      for (const e of game.world.query(Unit, Faction, Transform)) {
        const base = game.field.baseSites[game.world.req(e, Faction).id];
        const t = game.world.req(e, Transform);
        expect(Math.hypot(t.x - base.x, t.z - base.z)).toBeLessThan(base.radius + 16);
      }
    }
  });

  it('holding units go to meet an attack on their base, from whichever side it comes', () => {
    const game = new Game(5, { settings: sides([0, 1, 2]), populate: false, autoSpawn: false });
    game.setStance(0, 'hold');
    const base = game.field.baseSites[0];
    // A defender on the far side of the base, raiders from side 2 on the near side, out of its sight.
    const away = (f: number, d: number) => {
      const o = game.field.baseSites[f];
      const len = Math.hypot(o.x - base.x, o.z - base.z);
      return { x: base.x + ((o.x - base.x) / len) * d, z: base.z + ((o.z - base.z) / len) * d };
    };
    const post = away(2, -12);
    const defender = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, post.x, post.z);
    const raid = away(2, 22);
    for (let i = 0; i < 6; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 2, raid.x + (i % 3) * 1.5, raid.z + Math.floor(i / 3) * 1.5);
    game.setStance(2, 'hold');
    run(game, 0.5);
    expect(game.ctx.sides.threat[0]).toBe(6);
    expect(game.world.req(defender, Armed).target).toBeNull();
    const mover = game.world.req(defender, Mover);
    expect(mover.targetX).not.toBeNull();
    // Heading for the raiders, not staying on the far side.
    expect(Math.hypot(mover.targetX! - raid.x, mover.targetZ! - raid.z)).toBeLessThan(Math.hypot(mover.targetX! - post.x, mover.targetZ! - post.z));
  });

  it('an army out attacking comes home when its base is overrun, and goes back once it holds', () => {
    const game = new Game(5, { settings: sides([0, 1, 2]), populate: false, autoSpawn: false });
    const relations = game.ctx.sides;
    relations.assess(0, 5, 0, 0, 0);
    expect(relations.recalling[0]).toBe(false); // a small raid: the base guard deals with it
    relations.assess(0, 8, 0, 0, 3);
    expect(relations.recalling[0]).toBe(true);
    relations.assess(0, 8, 0, 0, 9);
    expect(relations.recalling[0]).toBe(true); // not until clearly enough defenders are back
    relations.assess(0, 8, 0, 0, 12);
    expect(relations.recalling[0]).toBe(false);
    relations.assess(0, 8, 0, 0, 3);
    relations.assess(0, 2, 0, 0, 0);
    expect(relations.recalling[0]).toBe(false); // the attack is beaten off

    // A recalled unit marching on the enemy turns for home; one under orders to attack keeps going.
    game.setStance(1, 'attack');
    const target = relations.target(0, 0)!;
    const mid = { x: (game.field.baseSites[0].x + game.field.baseSites[target].x) / 2, z: (game.field.baseSites[0].z + game.field.baseSites[target].z) / 2 };
    const unit = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, mid.x, mid.z);
    game.ctx.orders[0].stance = 'attack';
    relations.assess(0, 10, 0, 0, 0);
    game.step(DT);
    const homeward = (e: number) => {
      const m = game.world.req(e, Mover);
      const home = game.field.baseSites[0];
      return Math.hypot(m.targetX! - home.x, m.targetZ! - home.z) < Math.hypot(mid.x - home.x, mid.z - home.z);
    };
    expect(homeward(unit)).toBe(false);
    game.ctx.orders[0].stance = 'auto';
    game.step(DT);
    expect(homeward(unit)).toBe(true);
  });

  it('a four-side battle runs: everyone fields units and fights', () => {
    const game = new Game(12, { settings: sides([0, 1, 2, 3]) });
    run(game, 120);
    for (const side of game.stats.sides) {
      expect(side.fielded).toBeGreaterThan(10);
      expect(side.kills).toBeGreaterThan(0);
    }
  }, 60000);
});
