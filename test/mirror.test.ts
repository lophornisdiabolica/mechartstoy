import { describe, expect, it } from 'vitest';
import { ComponentType, Entity } from '../src/core/ecs';
import { hashSeed } from '../src/core/rng';
import { Armed, Building, Collider, Construction, Faction, Health, Producer, Renderable, Rubble, Transform, Unit, Wreck } from '../src/game/components';
import { Game } from '../src/game/game';
import { settingsFromParams } from '../src/ui/settingsUrl';
import { Frame, SimHost, SimView } from '../src/sim/mirror';

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
