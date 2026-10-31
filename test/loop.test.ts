import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/core/loop';

describe('FixedLoop', () => {
  it('runs whole steps and reports the remainder as alpha', () => {
    let steps = 0;
    let alpha = -1;
    const loop = new FixedLoop(0.1, { step: () => steps++, render: (a) => (alpha = a) });
    loop.advance(1);
    loop.advance(1.25);
    expect(steps).toBe(2);
    expect(alpha).toBeCloseTo(0.5);
  });

  it('pauses when timeScale is 0', () => {
    let steps = 0;
    const loop = new FixedLoop(0.1, { step: () => steps++, render: () => {} });
    loop.timeScale = 0;
    loop.advance(0);
    loop.advance(0.2);
    expect(steps).toBe(0);
  });
});
