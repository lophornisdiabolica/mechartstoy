import { System, World, Entity } from '../core/ecs';
import { Construction, Building, FallingBack, Faction, Health, Transform, Unit } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';

/*
 * Falling back to mend (UnitDef.retreats): a unit that knows when it's
 * beaten breaks off once its health drops below a share, heads home to
 * the nearest of its side's finished buildings that mend (BuildingDef
 * mends), or its base if it has none, fighting only what gets in its way
 * (see systems/ai.ts), and mends there until it's fit to go back. Anything
 * can use it: the Leviathan does, so it grows old instead of dying young.
 */

/** How close to home a unit has to be to mend. */
export const MEND_REACH = 9;

/** Where a side's units go to mend: its nearest finished building that mends, else its base. */
export function mendingPlace(world: World, ctx: SimContext, faction: number, x: number, z: number): { x: number; z: number } {
  let best = Infinity;
  let at: { x: number; z: number } | null = null;
  for (const b of world.query(Building, Transform, Faction)) {
    if (!world.req(b, Building).def.mends || world.has(b, Construction) || world.req(b, Faction).id !== faction) continue;
    const bt = world.req(b, Transform);
    const d = D.hypot(bt.x - x, bt.z - z);
    if (d < best) {
      best = d;
      at = { x: bt.x, z: bt.z };
    }
  }
  return at ?? ctx.field.baseSites[faction] ?? { x, z };
}

/** Breaking off, mending at home, and going back once fit. */
export function retreatSystem(ctx: SimContext): System {
  return {
    name: 'retreat',
    update(world, dt) {
      for (const e of world.query(Unit, Health, Transform, Faction)) {
        const rule = world.req(e, Unit).def.retreats;
        if (!rule) continue;
        const h = world.req(e, Health);
        const back = world.has(e, FallingBack);
        if (!back) {
          if (h.hp > 0 && h.hp < h.max * rule.below) world.add(e, FallingBack, { since: world.time });
          continue;
        }
        if (h.hp >= h.max * rule.until) {
          world.remove(e, FallingBack);
          continue;
        }
        if (atHome(world, ctx, e)) h.hp = Math.min(h.max, h.hp + h.max * rule.mends * dt);
      }
    },
  };
}

/** Whether a unit is close enough to its mending place to mend. */
export function atHome(world: World, ctx: SimContext, e: Entity): boolean {
  const t = world.req(e, Transform);
  const home = mendingPlace(world, ctx, world.req(e, Faction).id, t.x, t.z);
  return D.hypot(home.x - t.x, home.z - t.z) < MEND_REACH;
}
