import { System, World, Entity } from '../core/ecs';
import { Mover, Rooted, Transform, Unit } from './components';
import { SimContext } from './context';
import { plantForest } from './god';
import { MOVE_RULES } from '../world/moveClasses';

/*
 * Verdant: a living army.
 *
 * Vines (WeaponDef.roots): a strangler's lash wraps round a vehicle or
 * walker it hits and holds it where it is for a few seconds (it can still
 * shoot). Seed pods (WeaponDef.plants): where one bursts a small thicket
 * springs up, a few trees that block shots like any wood until tanks crush
 * them. Each side plants at most one thicket every PLANT_GAP seconds, and
 * no more than MOST_GROVES in a battle, so the map doesn't fill with trees.
 */

/** Seconds between a side's thickets. */
const PLANT_GAP = 14;
/** Most thickets a side plants in a battle. */
const MOST_GROVES = 24;

/** Per side: when it last planted, and how many it has. */
export class Groves {
  last = new Map<number, number>();
  count = new Map<number, number>();
}

/** A vine hit: hold a ground vehicle or walker where it is for a while. */
export function root(world: World, ctx: SimContext, e: Entity, seconds: number): void {
  const def = world.get(e, Unit)?.def;
  if (!def || def.class === 'infantry' || def.category === 'super') return;
  const m = world.get(e, Mover);
  if (!m || MOVE_RULES[m.move].flies || m.move === 'naval') return;
  const r = world.get(e, Rooted);
  const until = world.time + seconds;
  if (r) {
    r.until = Math.max(r.until, until);
    return;
  }
  world.add(e, Rooted, { until });
  const t = world.req(e, Transform);
  ctx.events.emit('rooted', { x: t.x, y: t.y, z: t.z, radius: def.radius });
}

/** A seed pod bursting: a little thicket springs up, if the side has one to spare. */
export function plantGrove(world: World, ctx: SimContext, faction: number, x: number, z: number, radius: number): void {
  if (world.time - (ctx.groves.last.get(faction) ?? -Infinity) < PLANT_GAP) return;
  const count = ctx.groves.count.get(faction) ?? 0;
  if (count >= MOST_GROVES) return;
  if (!plantForest(world, ctx, x, z, radius, ctx.rng, false)) return;
  ctx.groves.last.set(faction, world.time);
  ctx.groves.count.set(faction, count + 1);
  ctx.events.emit('grove', { x, y: ctx.field.heightAt(x, z), z, radius });
}

/** Rooted units stay where they are. Runs after the AI, before movement. */
export function rootSystem(): System {
  return {
    name: 'roots',
    update(world) {
      for (const e of world.query(Rooted, Mover)) {
        if (world.time >= world.req(e, Rooted).until) {
          world.remove(e, Rooted);
          continue;
        }
        const m = world.req(e, Mover);
        m.targetX = null;
        m.targetZ = null;
      }
    },
  };
}
