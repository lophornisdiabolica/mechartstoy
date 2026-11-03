import { describe, expect, it } from 'vitest';
import {
  battlePlans,
  BattleResult,
  compareRuns,
  damageSplit,
  doctrinePlans,
  formatDoctrines,
  formatTable,
  formatUnits,
  headToHead,
  margin,
  orthogonalArray,
  runBattle,
  Scenario,
  SCENARIOS,
  scenarioSettings,
  summarize,
  summarizeDoctrines,
  unitReport,
  unitsCsv,
} from '../src/sim/simulate';
import { settingsFromParams } from '../src/ui/settingsUrl';

const short: Scenario = { id: 'test', label: 'Test', battles: 1, quick: 1, setup: (s) => (s.map.size = 'small'), minutes: 0.5 };

function result(minutes: number, winner: number | null, seed: string): BattleResult {
  const side = { name: 'A', doctrine: 'armour' as const, team: 1, out: null, kills: 10, lost: 5, razed: 2, captured: 1, attacks: 3, units: {} };
  return { scenario: 'x', seed, map: '', set: '', minutes, decided: winner !== null, winner, sides: [side, { ...side, team: 2 }], msPerTick: 0.5, link: '' };
}

describe('balance runs', () => {
  it('scenario ids are unique and every scenario sets up a valid battle', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const s of SCENARIOS) {
      const settings = scenarioSettings(s, 3);
      expect(settings.seed).toBe(`${s.id}-3`);
      expect(new Set(settings.factions.map((f) => f.team)).size).toBeGreaterThan(1);
      expect(s.quick).toBeLessThanOrEqual(s.battles);
    }
  });

  it('plays a battle headlessly and links back to it', () => {
    const r = runBattle(short, 1);
    expect(r.minutes).toBeCloseTo(0.5, 1);
    expect(r.sides.length).toBe(2);
    expect(r.sides.reduce((a, s) => a + s.kills + s.lost, 0)).toBeGreaterThanOrEqual(0);
    const replay = settingsFromParams(new URLSearchParams(r.link));
    expect(replay.seed).toBe('test-1');
    expect(replay.map.size).toBe('small');
    // Same seed, same battle.
    expect(runBattle(short, 1).sides).toEqual(r.sides);
  });

  it('summarizes lengths, wins and the battles to replay', () => {
    const conquest: Scenario = { ...short, minutes: undefined };
    const s = summarize(conquest, [result(5, 1, 'a'), result(9, 2, 'b'), result(7, 1, 'c'), result(60, null, 'd')]);
    expect(s.median).toBe(8);
    expect(s.wins).toEqual({ 1: 2, 2: 1 });
    expect(s.undecided).toBe(1);
    expect(s.shortestSeed).toBe('a');
    expect(s.longestSeed).toBe('d');
    expect(s.kills).toBe(20);
    const table = formatTable([s], new Set());
    expect(table).toContain('T1:2 T2:1 undecided:1');
    expect(table.split('\n').length).toBe(3);
  });

  it('the orthogonal array pairs every two columns with every pair of values equally often', () => {
    for (const [levels, factors] of [[3, 2], [3, 4], [3, 6], [3, 8], [5, 3], [4, 2], [4, 5], [4, 8], [8, 3], [9, 4]]) {
      const rows = orthogonalArray(levels, factors);
      expect(rows[0].length).toBe(factors);
      for (let a = 0; a < factors; a++) {
        for (let b = a + 1; b < factors; b++) {
          const seen = new Map<string, number>();
          for (const r of rows) seen.set(`${r[a]},${r[b]}`, (seen.get(`${r[a]},${r[b]}`) ?? 0) + 1);
          expect(seen.size).toBe(levels * levels);
          expect(new Set(seen.values()).size).toBe(1);
        }
      }
    }
    expect(orthogonalArray(3, 4).length).toBe(9);
    expect(orthogonalArray(3, 6).length).toBe(27);
    expect(orthogonalArray(4, 2).length).toBe(16);
    expect(() => orthogonalArray(6, 2)).toThrow();
  });

  it('doctrine plans give every side a doctrine, and doctrine results add up', () => {
    // Eight doctrines: an 8-level array has 64 rows.
    const plans = doctrinePlans(2);
    expect(plans.length).toBe(64);
    expect(new Set(plans).size).toBe(64);
    const s = scenarioSettings(SCENARIOS[0], 1, plans[5]);
    expect(s.factions.map((f) => f.doctrine)).toEqual(plans[5].split('&').map((p) => p.split('=')[1]));

    const a = result(5, 1, 'a');
    a.sides[1] = { ...a.sides[1], doctrine: 'legion' };
    const b = result(5, 2, 'b');
    b.sides[1] = { ...b.sides[1], doctrine: 'legion' };
    const summary = summarizeDoctrines([a, b, result(60, null, 'c')]);
    expect(summary.find((d) => d.doctrine === 'armour')).toMatchObject({ played: 2, won: 1 });
    expect(summary.find((d) => d.doctrine === 'legion')).toMatchObject({ played: 2, won: 1 });
    expect(headToHead([a, b]).armour.legion).toBe(1);
    expect(headToHead([a, b]).legion.armour).toBe(1);
  });
  it('the unit report adds up each doctrine’s unit types across battles, and ties back to the side totals', () => {
    const r = runBattle({ ...short, minutes: 1.5, setup: (s) => ((s.map.size = 'small'), (s.factions[1].doctrine = 'legion')) }, 2);
    for (const side of r.sides) {
      const types = Object.values(side.units);
      expect(types.reduce((a, t) => a + t.lost, 0)).toBe(side.lost);
      expect(types.reduce((a, t) => a + t.kills, 0)).toBe(side.kills);
      for (const t of types) expect(Object.values(t.victims).reduce((a, n) => a + n, 0)).toBe(t.kills);
    }
    expect(r.sides.reduce((a, s) => a + s.lost, 0)).toBeGreaterThan(0);
    const twice = unitReport([r, r]);
    const once = unitReport([r]);
    expect(twice.map((row) => row.kills)).toEqual(once.map((row) => row.kills * 2));
    expect(new Set(once.map((row) => row.doctrine))).toEqual(new Set(['armour', 'legion']));
    expect(formatUnits([r])).toContain('legion:');
    expect(unitsCsv([r]).split('\n')[0]).toContain('doctrine,unit,built,lost,kills,razed,dealt,taken,');
  }, 30_000);

  it('tracks damage and time on the field per unit type', () => {
    const r = runBattle({ ...short, minutes: 1.5, setup: (s) => ((s.map.size = 'small'), (s.map.outposts = 0)) }, 3);
    for (const side of r.sides) {
      const types = Object.values(side.units);
      const dealt = types.reduce((a, t) => a + t.dealt, 0);
      expect(dealt).toBeGreaterThan(0);
      for (const t of types) {
        // The split by victim category adds up to the total, and no unit fires or aims for longer than it lives.
        expect(Object.values(t.dealtTo).reduce((a, n) => a + n, 0)).toBeCloseTo(t.dealt, 6);
        expect(t.firing).toBeLessThanOrEqual(t.alive);
        expect(t.engaged).toBeLessThanOrEqual(t.alive);
      }
      // A minute and a half, sampled once a second: at least one unit was out for most of it.
      expect(Math.max(...types.map((t) => t.alive))).toBeGreaterThan(60);
    }
    // With no outpost garrisons to fight, what one side dealt the other took (fire on the town isn't counted).
    const dealt = (i: number) => Object.values(r.sides[i].units).reduce((a, t) => a + t.dealt, 0);
    const taken = (i: number) => Object.values(r.sides[i].units).reduce((a, t) => a + t.taken, 0);
    expect(dealt(0)).toBeCloseTo(taken(1), 3);
    expect(dealt(1)).toBeCloseTo(taken(0), 3);
    expect(damageSplit({ vehicle: 60, infantry: 35, air: 5 })).toBe('veh 60% inf 35%');
    expect(formatUnits([r])).toContain('Dmg/slot-min');
  }, 30_000);

  it('win rates come with a margin of error and a score against par', () => {
    // About ±12 points over 64 games at 50%, wider for fewer, never zero.
    expect(margin(32, 64)).toBeCloseTo(0.12, 2);
    expect(margin(2, 4)).toBeGreaterThan(margin(32, 64));
    expect(margin(0, 4)).toBeGreaterThan(0);
    // 1v3: the lone side's par is a half, so winning half its battles is 1.00x.
    const lone = (winner: number, seed: string): BattleResult => {
      const r = result(5, winner, seed);
      const side = r.sides[0];
      r.sides = [{ ...side, doctrine: 'talon', team: 1 }, ...[0, 1, 2].map(() => ({ ...side, doctrine: 'armour' as const, team: 2 }))];
      return r;
    };
    const summary = summarizeDoctrines([lone(1, 'a'), lone(2, 'b')]);
    expect(summary.find((d) => d.doctrine === 'talon')!.score).toBeCloseTo(1, 6);
    expect(summary.find((d) => d.doctrine === 'armour')!.score).toBeCloseTo(1, 6);
  });

  it('map types are another column of the doctrine array', () => {
    const plans = battlePlans(2, 64, { doctrines: true, maps: ['medium', 'wet', 'dry', 'hilly'], set: 'water=0.3' });
    expect(plans.length).toBe(64);
    // The doctrine pairs are the same as without map types, so runs stay comparable.
    expect(plans.map((p) => p.set.split('&').filter((x) => x.startsWith('doc')).join('&'))).toEqual(doctrinePlans(2));
    // Every doctrine meets every map type equally often, on each side.
    for (const side of [1, 2]) {
      const seen = new Map<string, number>();
      for (const p of plans) {
        const doc = new URLSearchParams(p.set).get(`doc${side}`);
        seen.set(`${doc}|${p.map}`, (seen.get(`${doc}|${p.map}`) ?? 0) + 1);
      }
      expect(seen.size).toBe(8 * 4);
      expect(new Set(seen.values())).toEqual(new Set([2]));
    }
    // The map type's settings win over --set's (the first value of a setting counts).
    const wet = plans.find((p) => p.map === 'wet')!;
    expect(scenarioSettings(SCENARIOS[0], 1, wet.set).map.water).toBe(1);
    expect(scenarioSettings(SCENARIOS[0], 1, plans.find((p) => p.map === 'medium')!.set).map.water).toBe(0.3);
    // Crossed, every battle is played on every map type; without doctrines, battles take turns.
    expect(battlePlans(2, 64, { doctrines: true, maps: ['wet', 'dry'], cross: true }).length).toBe(128);
    expect(battlePlans(2, 6, { maps: ['wet', 'dry', 'flat:hills=0'] }).map((p) => p.map)).toEqual(['wet', 'dry', 'flat', 'wet', 'dry', 'flat']);
    expect(() => battlePlans(2, 4, { maps: ['swamp'] })).toThrow();
  });

  it('splits doctrine win rates by map type', () => {
    const on = (map: string, winner: number, seed: string): BattleResult => {
      const r = result(5, winner, seed);
      r.map = map;
      r.sides[1] = { ...r.sides[1], doctrine: 'tidewater' };
      return r;
    };
    const text = formatDoctrines([on('wet', 2, 'a'), on('wet', 2, 'b'), on('dry', 1, 'c'), on('dry', 1, 'd')]);
    expect(text).toContain('Win rate by map type');
    const row = text.split('\n').find((l) => l.startsWith('tidewater') && l.includes('±'))!;
    expect(row).toBeDefined();
  });

  it('compares two runs battle by battle', () => {
    const before = [result(5, 1, 'a'), result(6, 1, 'b'), result(7, 2, 'c')];
    const after = [result(4, 1, 'a'), result(6, 2, 'b'), result(7, 2, 'c'), result(9, 1, 'd')];
    const text = compareRuns({ battles: before }, { battles: after, set: 'prod=2' });
    expect(text).toContain('3 battles were played in both runs; 1 of them (33%) changed winner.');
    expect(text).toContain('Settings changed for every battle');
  });
});
