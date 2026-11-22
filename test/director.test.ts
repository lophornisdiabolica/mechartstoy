import { describe, expect, it } from 'vitest';
import { Game, SIM_HZ } from '../src/game/game';

const SIM_DT = 1 / SIM_HZ;

import { acrossAzimuth, Director, evenness, tiltFor, UnitCam, zoomFor } from '../src/render/director';

describe('director camera', () => {
  it('rates even fights above routs', () => {
    expect(evenness(10, 10)).toBe(1);
    expect(evenness(10, 0)).toBe(0);
    expect(evenness(12, 8)).toBeGreaterThan(evenness(18, 2));
  });

  it('looks across the line between the two sides, the nearer way round', () => {
    // Sides west and east of each other: the camera looks from the north or south.
    const [a, b] = acrossAzimuth(-10, 0, 10, 0, 0.2);
    expect(Math.abs(Math.sin(a))).toBeCloseTo(1);
    expect(Math.abs(Math.sin(b))).toBeCloseTo(1);
    expect(Math.sin(a)).toBeGreaterThan(0);
    expect(acrossAzimuth(-10, 0, 10, 0, -1.4)[0]).toBeCloseTo(-Math.PI / 2);
  });

  it('frames tighter fights closer and lower', () => {
    expect(zoomFor(6, 70)).toBeGreaterThan(zoomFor(30, 70));
    expect(tiltFor(zoomFor(6, 70))).toBeLessThan(tiltFor(zoomFor(30, 70)));
  });

  it('follows a real battle, holding each shot', () => {
    const game = new Game(5);
    const director = new Director(game);
    const unitCam = new UnitCam(game);
    const cuts: number[] = [];
    let last = director.shot;
    for (let t = 0; t < 150; t += SIM_DT) {
      game.step(SIM_DT);
      director.update(SIM_DT);
      if (director.shot && director.held === 0 && director.shot !== last) cuts.push(Math.round(game.world.time) * 1000 + Math.round(Math.hypot(director.shot.x - (last?.x ?? 0), director.shot.z - (last?.z ?? 0))));
      last = director.shot;
    }
    expect(director.shot).not.toBeNull();
    const s = director.shot!;
    expect(s.zoom).toBeGreaterThanOrEqual(0.85);
    expect(s.zoom).toBeLessThanOrEqual(2.6);
    // Cuts are spaced out: never two within the early-cut time.
    for (let i = 1; i < cuts.length; i++) expect(Math.floor(cuts[i] / 1000) - Math.floor(cuts[i - 1] / 1000)).toBeGreaterThanOrEqual(2);
    expect(unitCam.pick(s, director.cast)).not.toBeNull();
  }, 60_000);
});
