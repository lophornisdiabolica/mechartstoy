import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0, 1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('forks into independent streams', () => {
    const r = new Rng(1);
    expect(r.fork(1).next()).not.toBe(r.fork(2).next());
  });

  it('hashes strings stably', () => {
    expect(hashSeed('mech')).toBe(hashSeed('mech'));
    expect(hashSeed('mech')).not.toBe(hashSeed('mecha'));
  });
});
