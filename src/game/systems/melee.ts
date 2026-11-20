import { Entity, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Armed, Building, Collider, Faction, Hit, Mover, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { entityHeight } from '../lineOfFire';
import { applyDamage } from './projectiles';
import { canHit } from './targeting';
import { wrapAngle } from './movement';
import * as D from '../../core/dmath';

/*
 * Melee: blows instead of shots (see MeleeDef). A melee weapon is a weapon
 * like any other, picked by targeting, aimed and cooled down by the weapon
 * system; when it goes off, it lands a blow here instead of launching a
 * projectile. What a watcher sees is all physical:
 * - the striker has to be up against its target (its reach runs from its
 *   own edge), so melee units close to contact and press in (see ai.ts);
 * - a lunge carries it the last stretch in one bound;
 * - a knock shoves the struck back, small things further than big ones;
 * - a sweep catches enemies beside the target as well.
 * The swing, thrust or stomp itself is drawn by the model and the effects,
 * from the 'struck' event.
 */

/** Most others a sweep catches when its weapon doesn't say. */
const SWEEP_MOST = 2;
/** A knock moves something at most this many times as far as it would one the striker's own size. */
const KNOCK_MOST = 1.5;
const KNOCK_LEAST = 0.2;

/** Where a unit or building's edge nearest a point is, and its height there: where a blow lands. */
function contactPoint(world: World, from: { x: number; z: number }, target: Entity): { x: number; y: number; z: number } {
  const tt = world.req(target, Transform);
  const r = world.get(target, Collider)?.radius ?? 0.5;
  const d = Math.max(1e-4, D.hypot(from.x - tt.x, from.z - tt.z));
  const k = Math.min(1, r / d);
  return { x: tt.x + (from.x - tt.x) * k, y: tt.y + entityHeight(world, target) * 0.5, z: tt.z + (from.z - tt.z) * k };
}

/** Move a unit along (dx, dz) as far as its ground lets it, in a few steps: it stops at a wall or the water's edge. */
function shove(world: World, ctx: SimContext, e: Entity, dx: number, dz: number): number {
  const mover = world.get(e, Mover);
  const t = world.req(e, Transform);
  if (!mover) return 0;
  const rules = MOVE_RULES[mover.move];
  if (rules.flies) return 0;
  const grid = ctx.navs.for(mover.move);
  const len = D.hypot(dx, dz);
  if (len < 1e-4) return 0;
  const steps = Math.max(1, Math.ceil(len / 0.4));
  let moved = 0;
  for (let k = 0; k < steps; k++) {
    const nx = t.x + dx / steps;
    const nz = t.z + dz / steps;
    if (!grid.terrainAllowsAt(nx, nz) || grid.railCrossing(t.x, t.z, nx, nz)) break;
    t.x = nx;
    t.z = nz;
    moved += len / steps;
  }
  return moved;
}

/**
 * Land one blow from `e`'s melee weapon on `target` (and, with a sweep, on
 * enemies beside it): lunge in if it has to, hurt, knock back, and tell
 * the view (the 'struck' event).
 */
export function strike(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity): void {
  const w = armed.weapon;
  const melee = w.melee;
  if (!melee) return;
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const faction = world.req(e, Faction).id;
  const r = world.get(e, Collider)?.radius ?? 0.5;
  const tr = world.get(target, Collider)?.radius ?? 0.5;

  // A lunge carries the striker in to its reach's halfway mark, as far as the ground lets it.
  let lunged = 0;
  const dist = D.hypot(tt.x - t.x, tt.z - t.z);
  const gap = dist - r - tr;
  if (melee.lunge && gap > w.range * 0.5 && dist > 1e-4) {
    const step = Math.min(melee.lunge, gap - w.range * 0.5);
    lunged = shove(world, ctx, e, ((tt.x - t.x) / dist) * step, ((tt.z - t.z) / dist) * step);
  }

  const by: Hit = { source: world.get(e, Unit)?.def.id ?? world.get(e, Building)?.def.id ?? 'unknown', faction };
  const heading = D.atan2(-(tt.z - t.z), tt.x - t.x);
  const struck = [target];
  if (melee.sweep) {
    // Others within reach either side of the line to the target, nearest first.
    const others: { e: Entity; d: number }[] = [];
    ctx.grid.forEachNear(t.x, t.z, r + w.range + 3, (other, d2) => {
      if (other === target || other === e || !world.has(other, Targetable)) return;
      if (!ctx.sides.hostile(faction, world.req(other, Faction).id) || !canHit(world, armed, other)) return;
      const d = Math.sqrt(d2);
      if (d - r - (world.get(other, Collider)?.radius ?? 0.5) > w.range) return;
      const ot = world.req(other, Transform);
      if (Math.abs(wrapAngle(D.atan2(-(ot.z - t.z), ot.x - t.x) - heading)) > melee.sweep!) return;
      others.push({ e: other, d });
    });
    others.sort((a, b) => a.d - b.d || a.e - b.e);
    for (const o of others.slice(0, melee.sweepMost ?? SWEEP_MOST)) struck.push(o.e);
  }

  const at = contactPoint(world, t, target);
  for (const victim of struck) {
    // The knock, from where the striker stands, before the damage: a blow that kills still throws the wreck.
    if (melee.knock && world.has(victim, Mover) && !world.has(victim, Building)) {
      const vt = world.req(victim, Transform);
      const vr = world.get(victim, Collider)?.radius ?? 0.5;
      const d = Math.max(1e-4, D.hypot(vt.x - t.x, vt.z - t.z));
      const k = melee.knock * Math.max(KNOCK_LEAST, Math.min(KNOCK_MOST, r / vr));
      shove(world, ctx, victim, ((vt.x - t.x) / d) * k, ((vt.z - t.z) / d) * k);
    }
    applyDamage(world, ctx, victim, w.damage, by, w.pierce ?? 0);
  }
  ctx.events.emit('struck', { entity: e, x: at.x, y: at.y, z: at.z, heading, style: melee.style, kind: w.projectile, lunge: lunged, hits: struck.length });
}
