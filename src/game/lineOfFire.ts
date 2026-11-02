import { Entity, World } from '../core/ecs';
import { Building, Collider, Faction, Targetable, Transform, Unit } from './components';
import { SimContext } from './context';
import { UnitDef } from './units';

/**
 * Line of fire: direct-fire shots (bullets and shells) travel in a straight
 * line and stop at the first thing in their way, whether that's a building,
 * a rise in the ground or another unit. Allied units are see-through
 * (squads don't shoot each other in the back), but allied buildings still
 * stop shots. Lobbed weapons (`arc`) fly over everything and aren't traced.
 */

/** A point in the world. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** Where a traced shot stops, and what it hits there (null for the ground, or nothing at all). */
export interface Trace {
  x: number;
  y: number;
  z: number;
  hit: Entity | null;
  /** What stopped it: an entity (unit or building), the ground, or nothing within reach. */
  stoppedBy: 'unit' | 'building' | 'ground' | 'nothing';
}

/** Extra width shots get against units, so a near miss still counts (matches the old direct-hit test). */
export const UNIT_HIT_SLACK = 0.4;
/** Slack for units a shot wasn't aimed at: they're only hit by shots that really pass through them. */
const BYSTANDER_SLACK = 0.1;
/** Ground has to rise this far above a shot's path to stop it, so low shots skim small bumps. */
const GROUND_SLACK = 0.25;
/** Step along a shot's path when checking the ground. */
const GROUND_STEP = 0.5;

/** Height of a unit's body: what shots can hit, and what it hides behind. */
export function unitHeight(def: UnitDef): number {
  return def.weapon.muzzleHeight * 1.2 + 0.3;
}

/** Height of an entity above its base (units from their definition, buildings from theirs). */
export function entityHeight(world: World, e: Entity): number {
  const unit = world.get(e, Unit);
  if (unit) return unitHeight(unit.def);
  return world.get(e, Building)?.def.height ?? 1;
}

/** Where to aim at an entity: the middle of its body. */
export function aimPoint(world: World, e: Entity): Point3 {
  const t = world.req(e, Transform);
  return { x: t.x, y: t.y + entityHeight(world, e) * 0.5, z: t.z };
}

/**
 * Follow a shot from `from` toward `to` and on past it, up to `reach` along
 * the ground, and report the first thing it hits. `shooter` and its allies'
 * units are ignored; `target` gets the wider hit slack. `pad` widens
 * buildings, for checking a line has room to spare.
 */
export function traceShot(world: World, ctx: SimContext, from: Point3, to: Point3, reach: number, shooter: Entity, faction: number, target: Entity | null, pad = 0): Trace {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-4) return { ...to, hit: target, stoppedBy: target !== null ? 'unit' : 'nothing' };
  // Direction per unit of ground distance, with height changing at the aimed slope.
  const ux = dx / flat;
  const uz = dz / flat;
  const slope = (to.y - from.y) / flat;
  const end = Math.max(flat, reach);
  const yAt = (s: number) => from.y + slope * s;

  // Nearest entity along the path (ray against each candidate's circle, then its height).
  let best = end;
  let hit: Entity | null = null;
  let kind: Trace['stoppedBy'] = 'nothing';
  const midX = from.x + ux * end * 0.5;
  const midZ = from.z + uz * end * 0.5;
  ctx.grid.forEachNear(midX, midZ, end * 0.5 + 4, (other) => {
    if (other === shooter || !world.has(other, Targetable)) return;
    const isBuilding = world.has(other, Building);
    if (!isBuilding && ctx.sides.allied(world.req(other, Faction).id, faction)) return;
    const ot = world.req(other, Transform);
    const r = (world.get(other, Collider)?.radius ?? 0.5) + (isBuilding ? (other === target ? 0 : pad) : other === target ? UNIT_HIT_SLACK : BYSTANDER_SLACK);
    // Distance along the path to the point closest to the centre, and how far off the path the centre is.
    const ox = ot.x - from.x;
    const oz = ot.z - from.z;
    const along = ox * ux + oz * uz;
    const off2 = ox * ox + oz * oz - along * along;
    if (off2 > r * r) return;
    const half = Math.sqrt(r * r - off2);
    // Check where the path enters the circle and where it leaves, against the entity's height.
    const top = ot.y + entityHeight(world, other);
    for (const s of [along - half, along, along + half]) {
      if (s < 0.3 || s >= best) continue;
      const y = yAt(s);
      if (y >= ot.y - 0.2 && y <= top) {
        best = s;
        hit = other;
        kind = isBuilding ? 'building' : 'unit';
        break;
      }
    }
  });

  // The ground: walk the path until it dips under the surface (or water).
  for (let s = GROUND_STEP; s < best; s += GROUND_STEP) {
    const x = from.x + ux * s;
    const z = from.z + uz * s;
    if (!ctx.field.contains(x, z)) {
      best = s;
      hit = null;
      kind = 'nothing';
      break;
    }
    if (yAt(s) < ctx.field.surfaceAt(x, z) - GROUND_SLACK) {
      best = s;
      hit = null;
      kind = 'ground';
      break;
    }
  }
  return { x: from.x + ux * best, y: yAt(best), z: from.z + uz * best, hit, stoppedBy: kind };
}

/** Where a weapon's shots leave from. */
export function muzzlePoint(world: World, e: Entity, aim: number, muzzleOffset: number, muzzleHeight: number): Point3 {
  const t = world.req(e, Transform);
  return { x: t.x + Math.cos(aim) * muzzleOffset, y: t.y + muzzleHeight, z: t.z - Math.sin(aim) * muzzleOffset };
}

/**
 * Whether a direct-fire shot from `from` at `target` would get there: true
 * unless a building or the ground is in the way first. Enemy units in the
 * way don't count (they'd just take the hit instead). With `pad`, buildings
 * count as that much wider, so a line that only just scrapes past (and that
 * scattered shots would mostly hit) doesn't count.
 */
export function clearShot(world: World, ctx: SimContext, from: Point3, target: Entity, shooter: Entity, faction: number, pad = 0): boolean {
  const to = aimPoint(world, target);
  const flat = Math.hypot(to.x - from.x, to.z - from.z);
  const trace = traceShot(world, ctx, from, to, flat, shooter, faction, target, pad);
  return trace.hit === target || trace.stoppedBy === 'unit' || trace.stoppedBy === 'nothing';
}
