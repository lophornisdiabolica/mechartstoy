import { World } from '../core/ecs';
import { SimContext } from './context';
import { plantForest } from './god';
import { FROZEN, PatchRules } from './frost';

/*
 * Verdant: a living army.
 *
 * Tangle (WeaponDef.tangle): vines leave a small patch of ground grown over
 * where they land, kept like frost (see frost.ts) on its own field: enemies
 * wading through it slow right down, more than on frost, but nothing
 * shatters, and it withers in a few seconds (fire burns it away). Seed pods (WeaponDef.plants): where one bursts a small thicket
 * springs up, a few trees that block shots like any wood until tanks crush
 * them. Each side plants at most one thicket every PLANT_GAP seconds, and
 * no more than MOST_GROVES in a battle, so the map doesn't fill with trees.
 */

/** How Verdant's tangle behaves: a patch holds a little less than frost, drags harder, and withers quicker. */
export const TANGLE_RULES: PatchRules = { holds: FROZEN, most: 8, fades: 0.6, pace: 0.3, deep: 3 };
/** How wide a patch a vine lays where it lands. */
export const TANGLE_RADIUS = 1.1;

/** Seconds between a side's thickets. */
const PLANT_GAP = 14;
/** Most thickets a side plants in a battle. */
const MOST_GROVES = 24;

/** Per side: when it last planted, and how many it has. */
export class Groves {
  last = new Map<number, number>();
  count = new Map<number, number>();
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
