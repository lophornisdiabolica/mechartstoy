import { World } from '../core/ecs';
import { Faction, Guard, Unit } from './components';
import { SimContext } from './context';
import { outpostsHeldBy } from './outposts';
import { UnitCategory, UnitDef } from './units';

/**
 * Unit caps. Each side has a cap per category (infantry, vehicles, super
 * units) rather than one for its whole army, so production that's full in
 * one category keeps building the others. Super units are rare on purpose:
 * a small cap of their own, a slow mech bay, and, on maps with outposts, a
 * side can only build them while it holds at least one. Losing every outpost
 * doesn't take existing super units away; it just stops new ones.
 *
 * The super cap can grow during a battle (see SuperGrowth), so a long battle
 * or a big map ends with more than one on the field.
 */

export const CATEGORIES: UnitCategory[] = ['infantry', 'vehicle', 'super'];

export type CategoryCounts = Record<UnitCategory, number>;

/**
 * Units alive per side and category. Outpost guards don't count: they stay
 * at their outpost and aren't part of the army.
 */
export function countByCategory(world: World, sides: number): CategoryCounts[] {
  const out = Array.from({ length: sides }, () => ({ infantry: 0, vehicle: 0, super: 0 }));
  for (const e of world.query(Unit, Faction)) {
    const f = world.req(e, Faction).id;
    if (f < 0 || world.has(e, Guard)) continue;
    out[f][world.req(e, Unit).def.category]++;
  }
  return out;
}

/** The super cap from its base, after it's grown (see SuperGrowth). */
function superCap(ctx: SimContext, faction: number, base: number): number {
  switch (ctx.settings.armies.superGrowth) {
    case 'none':
      return base;
    case 'tide':
      // The tide ramp's level runs 0 to 2, so the cap reaches 3× the base when it tops out.
      return Math.floor(base * (1 + ctx.escalation.tide) + 1e-6);
    case 'outposts':
      return base + Math.max(0, outpostsHeldBy(ctx, faction) - 1);
  }
}

/** A side's cap for one category, after its strength (smaller teams get bigger armies; see Sides.strength). */
export function capFor(ctx: SimContext, faction: number, category: UnitCategory): number {
  const base = ctx.settings.armies.caps[category];
  const cap = category === 'super' ? superCap(ctx, faction, base) : base;
  return Math.round(cap * ctx.sides.strength[faction]);
}

/** A side's whole army cap: every category's cap added up. */
export function armyCap(ctx: SimContext, faction: number): number {
  return CATEGORIES.reduce((s, c) => s + capFor(ctx, faction, c), 0);
}

/** Whether a side may build super units right now: on maps with outposts, only while it holds one. */
export function superPermitted(ctx: SimContext, faction: number): boolean {
  return ctx.outposts.length === 0 || outpostsHeldBy(ctx, faction) > 0;
}

/** Whether a side has room for one more of this unit (and, for a super unit, the outpost it needs). */
export function canBuild(ctx: SimContext, counts: CategoryCounts[], faction: number, def: UnitDef): boolean {
  if (counts[faction][def.category] >= capFor(ctx, faction, def.category)) return false;
  return def.category !== 'super' || superPermitted(ctx, faction);
}
