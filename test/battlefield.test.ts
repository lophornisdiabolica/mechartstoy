import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { generateBattlefield } from '../src/world/battlefield';

describe('generateBattlefield', () => {
  it('is reproducible from a seed', () => {
    const a = generateBattlefield(new Rng(123));
    const b = generateBattlefield(new Rng(123));
    expect(a.heights).toEqual(b.heights);
  });

  it('flattens dry base pads for both factions', () => {
    for (let seed = 0; seed < 10; seed++) {
      const f = generateBattlefield(new Rng(seed));
      expect(f.baseSites.map((s) => s.faction)).toEqual([0, 1]);
      for (const s of f.baseSites) {
        expect(s.height).toBeGreaterThan(f.seaLevel);
        for (const [dx, dz] of [[0, 0], [5, 0], [0, -5], [-6, 6]]) {
          expect(f.heightAt(s.x + dx, s.z + dz)).toBeCloseTo(s.height, 3);
        }
      }
    }
  });

  it('interpolates heights between vertices', () => {
    const f = generateBattlefield(new Rng(9));
    const x0 = f.vertexX(10);
    const x1 = f.vertexX(11);
    const z = f.vertexZ(10);
    const mid = f.heightAt((x0 + x1) / 2, z);
    expect(mid).toBeCloseTo((f.vertexHeight(10, 10) + f.vertexHeight(11, 10)) / 2, 5);
  });
});
