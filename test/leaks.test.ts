import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/game/settings';
import { collectionSizes, LeakSample, leakReport, leakRun } from '../src/sim/leaks';

describe('leak checks', () => {
  it('adds up collections by where they are, across elements', () => {
    const root = { a: [1, 2, 3], m: new Map([[1, { list: [1] }], [2, { list: [1, 2] }]]), s: new Set([1]), buf: new Float32Array(100) };
    const sizes = collectionSizes(root, 'r');
    expect(sizes.get('r.a')).toBe(3);
    expect(sizes.get('r.m')).toBe(2);
    expect(sizes.get('r.m[*].list')).toBe(3);
    expect(sizes.get('r.s')).toBe(1);
    expect(sizes.has('r.buf')).toBe(false);
  });

  it('flags a collection that keeps growing, not one that rises and falls with the battle', () => {
    const samples: LeakSample[] = [0, 5, 10, 15, 20, 25].map((minute, k) => ({
      minute,
      entities: 100 + (k % 2) * 20,
      heapMB: null,
      sizes: new Map([
        ['game.cache', 10 + k * 30],
        ['game.units', 100 + (k % 2) * 20],
      ]),
    }));
    const growers = leakReport(samples, 5);
    expect(growers.map((g) => g.path)).toEqual(['game.cache']);
  });

  it('a long Eternal battle settles down: nothing it keeps grows for ever', () => {
    const s = defaultSettings();
    s.mode = 'eternal';
    s.map.size = 'small';
    const samples = leakRun(s, 11, 24, 4);
    expect(samples.length).toBe(7);
    expect(leakReport(samples, 8)).toEqual([]);
  }, 300000);
});
