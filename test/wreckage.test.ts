import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { MAX_WRECKAGE, WreckageField } from '../src/game/wreckage';

describe('wreckage', () => {
  const field = () => new WreckageField(new Game(3, { populate: false, autoSpawn: false }).field);

  it('piles up where wrecks fall, spilling outward once a spot is full', () => {
    const w = field();
    w.add(0, 0, 1.5, 1);
    const one = w.near(0, 0, 3);
    expect(one).toBeCloseTo(1, 3);
    for (let i = 0; i < 80; i++) w.add(0, 0, 1.5, 1);
    expect(w.near(0, 0, 30)).toBeCloseTo(81, 0);
    expect(w.at(0, 0)).toBeLessThanOrEqual(MAX_WRECKAGE);
    // Full cells pushed it further out than one wreck reaches.
    expect(w.near(0, 0, 30) - w.near(0, 0, 3)).toBeGreaterThan(1);
  });

  it('rusts away over minutes, not at once, a lone wreck sooner than a heap', () => {
    const w = field();
    w.add(10, 10, 2, 4);
    w.rust(60);
    expect(w.total).toBeGreaterThan(2);
    for (let t = 0; t < 40 * 60; t += 3) w.rust(3);
    expect(w.total).toBe(0);
    expect(w.count).toBe(0);
    // A lone tank's junk and a heap of a dozen, side by side: after five minutes the lone one's gone, the heap isn't.
    const both = field();
    both.add(-20, 0, 1.5, 1.5);
    for (let i = 0; i < 12; i++) both.add(20, 0, 1.5, 1.5);
    for (let t = 0; t < 5 * 60; t += 3) both.rust(3);
    expect(both.near(-20, 0, 6)).toBe(0);
    expect(both.near(20, 0, 8)).toBeGreaterThan(3);
  });

  it('lasts longer or shorter by the battle setting', () => {
    const game = new Game(3, { populate: false, autoSpawn: false });
    const short = new WreckageField(game.field, 0.5);
    const long = new WreckageField(game.field, 2);
    for (const w of [short, long]) {
      w.add(0, 0, 2, 4);
      for (let t = 0; t < 120; t += 3) w.rust(3);
    }
    expect(long.total).toBeGreaterThan(short.total * 1.5);
  });

  it('can be taken, nearest first', () => {
    const w = field();
    w.add(0, 0, 1, 2);
    w.add(8, 0, 1, 2);
    expect(w.take(0, 0, 10, 2.5)).toBeCloseTo(2.5, 3);
    expect(w.near(0, 0, 2)).toBeCloseTo(0, 3);
    expect(w.near(8, 0, 2)).toBeCloseTo(1.5, 3);
  });

  it('copies to the page and back', () => {
    const a = field();
    a.add(5, -4, 3, 3);
    const b = field();
    b.apply(a.snapshot());
    expect(b.near(5, -4, 6)).toBeCloseTo(a.near(5, -4, 6), 1);
  });
});
