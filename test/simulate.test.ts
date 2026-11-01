import { describe, expect, it } from 'vitest';
import { BattleResult, formatTable, runBattle, Scenario, SCENARIOS, scenarioSettings, summarize } from '../src/sim/simulate';
import { settingsFromParams } from '../src/ui/settingsUrl';

const short: Scenario = { id: 'test', label: 'Test', battles: 1, quick: 1, setup: (s) => (s.map.size = 'small'), minutes: 0.5 };

function result(minutes: number, winner: number | null, seed: string): BattleResult {
  const side = { name: 'A', team: 1, out: null, kills: 10, lost: 5, razed: 2, captured: 1, attacks: 3 };
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
});
