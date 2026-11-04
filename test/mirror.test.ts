import { describe, expect, it } from 'vitest';
import { ComponentType, Entity } from '../src/core/ecs';
import { hashSeed } from '../src/core/rng';
import { Armed, Building, Collider, Construction, Faction, Health, Producer, Renderable, Rubble, Transform, Unit, Wreck } from '../src/game/components';
import { Game } from '../src/game/game';
import { settingsFromParams } from '../src/ui/settingsUrl';
import { Frame, SimHost, SimView } from '../src/sim/mirror';
import { DrawClock } from '../src/sim/remoteSim';

/** A battle played by a SimHost and shown on a view, frames passed as postMessage would. */
function pair(query: string) {
  const settings = settingsFromParams(new URLSearchParams(query));
  const seed = hashSeed(settings.seed || 'mirror');
  const host = new SimHost(seed, structuredClone(settings));
  const view = new Game(seed, { settings: structuredClone(settings), view: true });
  const sim = new SimView(view);
  const exchange = (steps: number) => {
    host.step(steps, false);
    const { frame } = host.frame();
    sim.apply(structuredClone(frame) as Frame);
    sim.pose(frame.time);
  };
  return { host, view, sim, exchange };
}

const COPIED: ComponentType<unknown>[] = [Transform, Faction, Renderable, Armed, Health, Construction, Wreck, Rubble, Producer, Unit, Building, Collider];

/** Everything the page reads, for comparing the two copies. */
function picture(game: Game) {
  const w = game.world;
  const entities: Record<Entity, Record<string, unknown>> = {};
  for (const e of w.query(Transform)) {
    const comps: Record<string, unknown> = {};
    for (const type of COPIED) {
      const v = w.get(e, type);
      if (v !== undefined) comps[type.name] = v;
    }
    // The view draws from wherever things were on screen, so only the current position has to match.
    const t = w.req(e, Transform);
    comps.Transform = { x: t.x, y: t.y, z: t.z, heading: t.heading };
    entities[e] = comps;
  }
  return {
    time: w.time,
    entities,
    stats: game.stats.sides,
    outposts: game.ctx.outposts.map((o) => [o.owner, o.progress, o.claimant]),
    orders: game.ctx.orders,
    eliminated: game.ctx.sides.eliminated,
    plans: game.ctx.offensive.plansState,
    commander: JSON.parse(JSON.stringify(game.ctx.commander.state)) as unknown,
    ground: Array.from(game.field.ground),
    heights: Array.from(game.field.heights),
    fallen: game.field.woods.trees.map((t) => t.fell),
  };
}

describe('sim mirror', () => {
  it('shows exactly the battle the host plays', () => {
    // Forest and outposts, so trees fall, scrap forms and outposts change hands.
    const { host, view, exchange } = pair('seed=mirror-1&map=forest&size=small');
    exchange(0);
    expect(picture(view)).toEqual(picture(host.game));
    for (let i = 0; i < 90; i++) exchange(i % 3 === 0 ? 0 : 90);
    const real = picture(host.game);
    expect(real.time).toBeGreaterThan(170);
    expect(real.stats.some((s) => s.lost > 0)).toBe(true);
    expect(picture(view)).toEqual(real);
  }, 60000);

  it('draws between frames along the real tick-by-tick path', () => {
    const query = 'seed=mirror-3&size=small';
    const { host, view, sim, exchange } = pair(query);
    exchange(600);
    // A second copy of the battle, played to the middle of the next frame.
    const settings = settingsFromParams(new URLSearchParams(query));
    const half = new Game(hashSeed(settings.seed || 'mirror'), { settings });
    for (let i = 0; i < 603; i++) half.step(1 / 30);
    host.step(6, false);
    sim.apply(structuredClone(host.frame().frame) as Frame);
    const alpha = sim.pose(half.world.time);
    expect(alpha).toBe(0);
    let checked = 0;
    for (const e of half.world.query(Transform)) {
      const t = half.world.req(e, Transform);
      const v = view.world.get(e, Transform);
      if (!v || sim.unborn.has(e)) continue;
      expect([v.px, v.pz]).toEqual([t.x, t.z]);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('forwards commands from the view to the real battle', () => {
    const { host, view, exchange } = pair('seed=mirror-2&size=small');
    const sent: Parameters<Game['command']>[0][] = [];
    view.forward = (c) => sent.push(c);
    view.setRally(0, { x: 5, z: 6 });
    view.setStance(1, 'hold');
    expect(view.ctx.orders[0].rally).toBeNull();
    for (const c of sent) host.command(c);
    exchange(0);
    expect(view.ctx.orders[0].rally).toEqual({ x: 5, z: 6 });
    expect(view.ctx.orders[1].stance).toBe('hold');
  });
});

describe('fast-forward (the at URL option)', () => {
  it('jumps the view to where the battle has got to, stats and all', () => {
    const { host, view, sim } = pair('seed=mirror-2&size=small');
    host.skip(150 * 30);
    host.step(0, false);
    const { frame } = host.frame();
    expect(frame.skipped).toBeDefined();
    expect(frame.events.length).toBe(0);
    sim.apply(structuredClone(frame) as Frame);
    sim.pose(frame.time);
    expect(picture(view)).toEqual(picture(host.game));
    // And carries on in step from there.
    host.step(60, false);
    const next = host.frame().frame;
    expect(next.skipped).toBeUndefined();
    sim.apply(structuredClone(next) as Frame);
    sim.pose(next.time);
    expect(picture(view)).toEqual(picture(host.game));
  }, 60000);

  it('sends units\' routes only when asked', () => {
    const { host } = pair('seed=mirror-3&size=small');
    host.step(300, false);
    expect(host.frame().frame.routes).toBeUndefined();
    host.routes = true;
    host.step(30, false);
    const routes = host.frame().frame.routes!;
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) expect(r.length % 2).toBe(1);
  }, 60000);
});

describe('draw clock', () => {
  /** The sim time drawn each frame at 4× speed, with answers arriving as `answers` says (ticks per answer, by frame). */
  function drawn(answers: (frame: number) => number, frames: number) {
    const clock = new DrawClock();
    let simTime = 0;
    const out: number[] = [];
    for (let f = 0; f < frames; f++) {
      clock.advance((1 / 60) * 4);
      const ticks = answers(f);
      if (ticks > 0) {
        simTime += ticks / 30;
        clock.arrived(simTime);
      }
      out.push(clock.time);
    }
    return { out, simTime };
  }

  it('moves smoothly when answers come late and in big batches', () => {
    // 4× speed: 2 ticks a frame due, but the worker answers every third frame with 6.
    const { out } = drawn((f) => (f % 3 === 0 ? 6 : 0), 600);
    const steps = out.slice(100).map((p, i, a) => (i > 0 ? p - a[i - 1] : 0)).slice(1);
    // No frame stands still, and none jumps much more than the average.
    const mean = steps.reduce((a, b) => a + b) / steps.length;
    expect(Math.min(...steps)).toBeGreaterThan(mean * 0.4);
    expect(Math.max(...steps)).toBeLessThan(mean * 1.8);
  });

  it('jumps after a fast-forward instead of crawling up to it', () => {
    const clock = new DrawClock();
    clock.arrived(0.1);
    clock.advance(0.05);
    clock.jump(600);
    clock.arrived(600);
    clock.advance(1 / 60);
    expect(clock.time).toBeGreaterThanOrEqual(599.9);
  });

  it('keeps up when answers come every frame', () => {
    const { out, simTime } = drawn(() => 2, 300);
    // Drawing stays within about a frame of the newest state.
    expect(simTime - out[299]).toBeLessThan(0.15);
  });
});
