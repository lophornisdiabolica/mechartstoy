import { World } from '../core/ecs';
import { SimContext } from './context';
import { settle } from './god';
import { UnitDef } from './units';

/*
 * Craters: a super unit blowing up leaves a small crater where it fell (a
 * shot-down airship, where it hits the ground). One is a dent with a low
 * rim of churned earth; dozens of them, along a front that's been fought
 * over for an hour, wear the ground down and reshape the map. On low ground
 * a crater goes below the water and floods, so a battlefield by a lake or
 * river slowly turns to ponds and marsh. Engineers fill in or bridge any
 * that cut the way across (see commander/crossings.ts), so craters can't
 * wall a battle into a stalemate.
 *
 * Off with the map's craters setting.
 */

/** A crater's radius: this much, plus this share of the super unit's own radius. */
const CRATER_BASE = 1.6;
const CRATER_PER_RADIUS = 0.45;
/** How deep a fresh crater digs at its middle. */
export const CRATER_DEPTH = 0.55;
/** How far below the water a crater can dig: a pond, not a lake (engineers fill in any that cut the way across, see crossings.ts). */
export const CRATER_FLOOR = 0.45;
/** The rim: how far past the bowl it reaches (as a share of the radius), and how high it heaps (as a share of the depth). */
const RIM = 0.6;
const RIM_HEIGHT = 0.35;

/** The crater a super unit leaves, if any: its radius and depth. */
export function craterOf(ctx: SimContext, def: UnitDef): { radius: number; depth: number } | null {
  if (!ctx.settings.map.craters || def.category !== 'super') return null;
  return { radius: CRATER_BASE + def.radius * CRATER_PER_RADIUS, depth: CRATER_DEPTH };
}

/**
 * Blast a crater into the ground round a point: a bowl down to as deep as
 * `depth` (never below CRATER_FLOOR under the water), with a low rim just
 * outside it, and churned earth on its floor. Returns how many map vertices
 * moved.
 */
export function blastCrater(world: World, ctx: SimContext, x: number, z: number, radius: number, depth: number): number {
  const field = ctx.field;
  if (!field.contains(x, z, 1)) return 0;
  const floor = field.seaLevel - CRATER_FLOOR;
  const reach = radius * (1 + RIM);
  const moved = field.reshape(x, z, reach, (h, d) => {
    const t = d / radius;
    if (t < 1) {
      // Deepest in the middle; ground already at the floor stays put.
      const out = h - depth * (1 - t * t);
      return Math.fround(h <= floor ? h : Math.max(floor, out));
    }
    return Math.fround(h + depth * RIM_HEIGHT * (1 - (t - 1) / RIM));
  });
  if (moved === 0) return 0;
  // Churned earth in the bowl, over open ground (roads, trenches and scrap keep theirs).
  field.paint(x, z, radius * 0.8, 'earth', (current) => current === 'plain' || current === 'thicket');
  // Trees in the blast come down, falling away from it.
  field.woods.crush(x, z, radius, { x, z });
  settle(world, ctx, x, z, reach);
  ctx.events.emit('crater', { x, z, radius });
  return moved;
}
