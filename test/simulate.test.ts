import { describe, expect, it } from 'vitest';
import { BattleResult, doctrinePlans, formatTable, formatUnits, headToHead, orthogonalArray, runBattle, Scenario, SCENARIOS, scenarioSettings, summarize, summarizeDoctrines, unitReport, unitsCsv } from '../src/sim/simulate';
import { settingsFromParams } from '../src/ui/settingsUrl';

const short: Scenario = { id: 'test', label: 'Test', battles: 1, quick: 1, setup: (s) => (s.map.size = 'small'), minutes: 0.5 };

function result(minutes: number, winner: number | null, seed: string): BattleResult {
  const side = { name: 'A', doctrine: 'armour' as const, team: 1, out: null, kills: 10, lost: 5, razed: 2, captured: 1, attacks: 3, units: {} };
  return { scenario: 'x', seed, minutes, decided: winner !== null, winner, sides: [side, { ...side, team: 2 }], msPerTick: 0.5, link: '' };
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
    const plans = doctrinePlans(2);
    expect(plans.length).toBe(16);
    expect(new Set(plans).size).toBe(16);
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
    expect(unitsCsv([r]).split('\n')[0]).toBe('doctrine,unit,built,lost,kills,razed,killed_most,killed_most_by');
  }, 30_000);
});
