import { describe, expect, it } from 'vitest';
import { formatDuels, parseDuel, parseGroup, runDuel } from '../src/sim/duel';

describe('duels', () => {
  it('reads line-ups', () => {
    expect(parseGroup('tank*4+trooper*12')).toEqual([
      { unit: 'tank', count: 4 },
      { unit: 'trooper', count: 12 },
    ]);
    expect(parseGroup('lancer')).toEqual([{ unit: 'lancer', count: 1 }]);
    expect(parseDuel('tank*2 vs trooper*3').b).toEqual([{ unit: 'trooper', count: 3 }]);
    expect(() => parseGroup('tonk*2')).toThrow();
    expect(() => parseDuel('tank*2 trooper*3')).toThrow();
  });

  it('sets two groups on each other until one is gone, the same way every time', () => {
    const duel = parseDuel('tank*4 vs trooper*6');
    const r = runDuel(duel, 1);
    expect(r.winner).toBe('a');
    expect(r.sides[0]).toMatchObject({ units: 4, left: 4 });
    expect(r.sides[1]).toMatchObject({ units: 6, left: 0 });
    expect(r.sides[0].dealt).toBeGreaterThan(0);
    expect(r.seconds).toBeLessThan(60);
    expect(runDuel(duel, 1)).toEqual(r);
    expect(formatDuels([r, runDuel(duel, 2)])).toContain('tank*4 vs trooper*6');
  });
});
