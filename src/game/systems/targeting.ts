import { Entity, System, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Armed, Collider, Construction, Faction, Mover, Targetable, Transform } from '../components';
import { clearShot, muzzlePoint, Point3 } from '../lineOfFire';
import { SimContext } from '../context';

const RETARGET_INTERVAL = 0.5;
/** Buildings count as this much further away, so units shoot units first. Siege units invert it. */
const BUILDING_PENALTY = 8;
/** Extra range per world unit of height above the target, as a fraction of the weapon's range, and the most it can add. */
const HEIGHT_RANGE_PER_UNIT = 0.03;
const HEIGHT_RANGE_MAX = 0.15;

/** Whether a weapon that hits `targets` can shoot at this entity (aircraft need an anti-air weapon). */
export function canHit(world: World, armed: Armed, target: Entity): boolean {
  const m = world.get(target, Mover);
  const air = m !== undefined && MOVE_RULES[m.move].flies;
  return armed.weapon.targets === 'both' || (armed.weapon.targets === 'air') === air;
}

/**
 * A weapon's reach against a target: its range, plus up to 15% from higher
 * ground (3% per unit of height above the target). Shooting uphill costs
 * nothing extra; the low side just can't reach as far as the high side.
 */
export function effectiveRange(world: World, e: Entity, armed: Armed, target: Entity): number {
  const dh = world.req(e, Transform).y - world.req(target, Transform).y;
  return armed.weapon.range * (1 + Math.max(0, Math.min(HEIGHT_RANGE_MAX, dh * HEIGHT_RANGE_PER_UNIT)));
}

/** How many of the best-scoring targets to check for a clear shot before settling for one behind cover. */
const SIGHT_CHECKS = 3;

/** Muzzle position for a shot at `target`, with the weapon swung round to face it. */
function muzzleToward(world: World, e: Entity, armed: Armed, target: Entity): Point3 {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  return muzzlePoint(world, e, Math.atan2(-(tt.z - t.z), tt.x - t.x), armed.muzzleOffset, armed.weapon.muzzleHeight);
}

/**
 * The best enemy in sight: closest first, buildings after units (before,
 * for siege units). Direct-fire weapons prefer one they have a clear shot
 * at; if none of the best few is in the open, they take the best anyway
 * and are marked blocked (see Armed.blocked).
 */
function findTarget(world: World, ctx: SimContext, e: Entity, armed: Armed): Entity | null {
  const t = world.req(e, Transform);
  const faction = world.req(e, Faction).id;
  const candidates: { e: Entity; score: number }[] = [];
  ctx.grid.forEachNear(t.x, t.z, armed.sight, (other, d2) => {
    const otherFaction = world.req(other, Faction).id;
    // Only enemies; nobody aims at the civilian town (it only suffers stray fire).
    if (!ctx.sides.hostile(faction, otherFaction)) return;
    if (!canHit(world, armed, other)) return;
    const d = Math.sqrt(d2);
    if (d < armed.weapon.minRange) return;
    const isBuilding = world.req(other, Targetable).kind === 'building';
    candidates.push({ e: other, score: d + (isBuilding ? (armed.siege ? -BUILDING_PENALTY * 3 : BUILDING_PENALTY) : 0) });
  });
  armed.blocked = false;
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.score - b.score || a.e - b.e);
  if (armed.weapon.arc) return candidates[0].e;
  for (const c of candidates.slice(0, SIGHT_CHECKS)) {
    if (clearShot(world, ctx, muzzleToward(world, e, armed, c.e), c.e, e, faction)) return c.e;
  }
  armed.blocked = true;
  return candidates[0].e;
}

/** How far a firing spot's line of fire has to clear buildings by, so scattered shots don't hit them. */
const SPOT_ROOM = 0.9;
/** Bearings (radians either side of the line from the target to the unit) tried when looking for a firing spot. */
const SPOT_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4];

/**
 * A spot near the unit with a clear shot at its target: on a ring round the
 * target at a bit inside weapon range, starting from the unit's own side
 * and working round. Null if there's none (the unit then just closes in).
 */
export function firingSpot(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity): { x: number; z: number } | null {
  const mover = world.get(e, Mover);
  if (!mover) return null;
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const faction = world.req(e, Faction).id;
  const grid = ctx.navs.for(mover.move);
  const radius = world.get(e, Collider)?.radius ?? 0.5;
  const dist = Math.hypot(t.x - tt.x, t.z - tt.z);
  const ring = Math.max(armed.weapon.minRange + 1, Math.min(dist, armed.weapon.range * 0.7));
  const base = Math.atan2(t.z - tt.z, t.x - tt.x);
  for (const da of SPOT_ANGLES) {
    const a = base + da;
    const x = tt.x + Math.cos(a) * ring;
    const z = tt.z + Math.sin(a) * ring;
    if (!grid.terrainAllowsAt(x, z) || !grid.fitsAt(x, z, radius)) continue;
    const ground = grid.rules.flies ? t.y : ctx.field.surfaceAt(x, z);
    const from = { x, y: ground + armed.weapon.muzzleHeight, z };
    if (clearShot(world, ctx, from, target, e, faction, SPOT_ROOM)) return { x, z };
  }
  return null;
}

/** Every armed entity (units and towers) picks the best enemy in sight. */
export function targetingSystem(ctx: SimContext): System {
  return {
    name: 'targeting',
    update(world) {
      for (const e of world.query(Armed, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const armed = world.req(e, Armed);
        // A dead target triggers an immediate re-think; otherwise re-think on a timer.
        if (armed.target !== null && !world.has(armed.target, Targetable)) {
          armed.target = null;
          armed.nextTargetAt = world.time;
        }
        if (world.time < armed.nextTargetAt) continue;
        armed.nextTargetAt = world.time + RETARGET_INTERVAL;
        armed.target = findTarget(world, ctx, e, armed);
        const spot = armed.blocked && armed.target !== null ? firingSpot(world, ctx, e, armed, armed.target) : null;
        armed.spotX = spot?.x ?? null;
        armed.spotZ = spot?.z ?? null;
      }
    },
  };
}

/** Edge-to-edge distance from an entity to its target, so big buildings count as in range sooner. */
export function distanceToTarget(world: World, e: Entity, target: Entity): number {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const r = world.get(target, Collider)?.radius ?? 0;
  return Math.max(0, Math.hypot(tt.x - t.x, tt.z - t.z) - r);
}
