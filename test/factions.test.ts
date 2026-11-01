import { describe, expect, it } from 'vitest';
import { Faction, Health, Producer } from '../src/game/components';
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

  it('a four-side battle runs: everyone fields units and fights', () => {
    const game = new Game(12, { settings: sides([0, 1, 2, 3]) });
    run(game, 120);
    for (const side of game.stats.sides) {
      expect(side.fielded).toBeGreaterThan(10);
      expect(side.kills).toBeGreaterThan(0);
    }
  }, 60000);
});
