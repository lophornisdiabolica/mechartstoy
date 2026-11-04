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
  };
  return { host, view, exchange };
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

describe('draw clock', () => {
  /** Drawn position of something moving 1 unit per sim second, through irregular answers, as RemoteSim + SimView draw it. */
  function drawn(answers: (frame: number) => number, frames: number) {
    const clock = new DrawClock();
    let px = 0;
    let x = 0;
    let simTime = 0;
    const out: number[] = [];
    for (let f = 0; f < frames; f++) {
      let alpha = clock.advance((1 / 60) * 4);
      const ticks = answers(f);
      if (ticks > 0) {
        px += (x - px) * alpha;
        simTime += ticks / 30;
        x = simTime;
        alpha = clock.arrived(simTime);
      }
      out.push(px + (x - px) * alpha);
    }
    return out;
  }

  it('moves smoothly when answers come late and in big batches', () => {
    // 4× speed: 2 ticks a frame due, but the worker answers every third frame with 6.
    const pos = drawn((f) => (f % 3 === 0 ? 6 : 0), 600);
    const steps = pos.slice(100).map((p, i, a) => (i > 0 ? p - a[i - 1] : 0)).slice(1);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    // No frame stands still, and none jumps much more than the average.
    const mean = steps.reduce((a, b) => a + b) / steps.length;
    expect(Math.min(...steps)).toBeGreaterThan(mean * 0.4);
    expect(Math.max(...steps)).toBeLessThan(mean * 1.8);
  });

  it('keeps up when answers come every frame', () => {
    const pos = drawn(() => 2, 300);
    // Drawing stays within about a frame of the newest state.
    expect(300 * (2 / 30) - pos[299]).toBeLessThan(0.15);
  });
});
