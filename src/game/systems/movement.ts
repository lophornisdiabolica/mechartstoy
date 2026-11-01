import { Entity, System, World } from '../../core/ecs';
import { Battlefield } from '../../world/battlefield';
import { Building, Collider, Faction, GroundFollow, Mover, NavState, Transform, Unit } from '../components';
import { SimContext } from '../context';

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const diff = wrapAngle(to - from);
  return wrapAngle(from + Math.max(-maxStep, Math.min(maxStep, diff)));
}

/** Route plans allowed per tick, so a crowd re-planning at once can't spike a frame. */
const PLANS_PER_TICK = 10;
/** Minimum seconds between re-plans for one unit chasing a moving goal. */
const REPLAN_INTERVAL = 1;
/** How far the goal can drift before the route is re-planned. */
const GOAL_DRIFT = 2.5;
/** Waypoint counts as reached within this distance. */
const WAYPOINT_RADIUS = 1.2;
/** Seconds between progress checks, and checks without progress before sidestepping. */
const STUCK_CHECK = 0.75;
const STUCK_LIMIT = 2;
/** Seconds between re-checking whether the goal is in a clear straight line. */
const DIRECT_CHECK = 0.4;
/** Heading error (radians) above which a unit counts as turning rather than stuck. */
const TURNING = 0.6;

/**
 * Pick the point to steer at this tick: a sidestep detour, the goal itself
 * if the straight line is clear, or the next waypoint of a planned route.
 */
function nextWaypoint(ctx: SimContext, world: World, t: Transform, m: Mover, radius: number, budget: { plans: number }): { x: number; z: number } {
  const nav = m.nav;
  const goal = { x: m.targetX!, z: m.targetZ! };
  if (world.time < nav.detourUntil) return { x: nav.detourX, z: nav.detourZ };

  const here = { x: t.x, z: t.z };
  if (world.time >= nav.directCheckAt) {
    nav.directCheckAt = world.time + DIRECT_CHECK;
    nav.direct = m.canCrossWater || ctx.nav.lineClear(here, goal, radius);
  }
  if (nav.direct) {
    nav.path = null;
    return goal;
  }

  const drifted = Math.hypot(goal.x - nav.pathGoalX, goal.z - nav.pathGoalZ) > GOAL_DRIFT;
  const stale = nav.path === null || nav.pathVersion !== ctx.nav.version || (drifted && world.time >= nav.replanAt);
  if (stale && budget.plans > 0) {
    budget.plans--;
    nav.path = ctx.nav.findPath(here, goal, radius);
    nav.pathIndex = 0;
    nav.pathGoalX = goal.x;
    nav.pathGoalZ = goal.z;
    nav.pathVersion = ctx.nav.version;
    nav.replanAt = world.time + REPLAN_INTERVAL;
  }
  const path = nav.path;
  if (!path || path.length === 0) return goal;

  while (nav.pathIndex < path.length - 1 && Math.hypot(path[nav.pathIndex].x - t.x, path[nav.pathIndex].z - t.z) < WAYPOINT_RADIUS) {
    nav.pathIndex++;
  }
  // Skip ahead when a later waypoint is already in clear view (e.g. after being pushed aside).
  if (nav.pathIndex < path.length - 1 && ctx.nav.lineClear(here, path[nav.pathIndex + 1], radius)) nav.pathIndex++;
  return path[Math.min(nav.pathIndex, path.length - 1)];
}

/**
 * Lateral nudge away from things sitting in our way: buildings, enemies, and
 * friendlies that have stopped. Returns a sideways vector to add to the heading.
 */
function avoidance(ctx: SimContext, world: World, e: Entity, t: Transform, dirX: number, dirZ: number): { x: number; z: number } {
  const r = world.get(e, Collider)?.radius ?? 0.5;
  const lookahead = r + 2.5;
  const myFaction = world.get(e, Faction)?.id;
  let ax = 0;
  let az = 0;
  ctx.grid.forEachNear(t.x, t.z, lookahead + 3.5, (other) => {
    if (other === e) return;
    const ot = world.req(other, Transform);
    const or = world.get(other, Collider)?.radius ?? 0.5;
    const isBuilding = world.has(other, Building);
    if (!isBuilding && world.get(other, Faction)?.id === myFaction) {
      // Friendlies on the move sort themselves out via separation; only steer around parked ones.
      const om = world.get(other, Mover);
      if (om && om.targetX !== null) return;
    }
    const vx = ot.x - t.x;
    const vz = ot.z - t.z;
    const ahead = vx * dirX + vz * dirZ;
    if (ahead <= 0 || ahead > lookahead + or) return;
    // Signed sideways offset of the obstacle from our line of travel (left is positive).
    const side = vx * -dirZ + vz * dirX;
    const clearance = r + or + 0.3;
    if (Math.abs(side) >= clearance) return;
    const urgency = (1 - Math.max(0, ahead - or) / lookahead) * (1 - Math.abs(side) / clearance);
    // Steer to the side the obstacle isn't on; dead ahead, break the tie consistently per pair.
    const away = Math.abs(side) > 0.05 ? -Math.sign(side) : (e + other) % 2 === 0 ? 1 : -1;
    ax += -dirZ * away * urgency * 2;
    az += dirX * away * urgency * 2;
  });
  return { x: ax, z: az };
}

/**
 * Every so often check we've actually moved; if not, sidestep for a moment.
 * Turning on the spot doesn't count: big units take seconds to turn around,
 * and calling that "stuck" sends them off on a detour before they've finished.
 */
function checkStuck(ctx: SimContext, world: World, e: Entity, t: Transform, nav: NavState, dirX: number, dirZ: number, turning: boolean): void {
  if (world.time < nav.checkAt) return;
  nav.checkAt = world.time + STUCK_CHECK;
  const moved = Math.hypot(t.x - nav.checkX, t.z - nav.checkZ);
  nav.checkX = t.x;
  nav.checkZ = t.z;
  nav.stuckFor = moved < 0.35 && !turning ? nav.stuckFor + 1 : 0;
  if (nav.stuckFor < STUCK_LIMIT) return;
  nav.stuckFor = 0;
  // Try a point off to one side (alternating by entity), then the other, then back the way we came.
  // Prefer spots the unit actually fits in; a wide unit wedged between buildings has to back out.
  const radius = world.get(e, Collider)?.radius ?? 0.5;
  const r = radius + 2.5;
  const first = e % 2 === 0 ? 1 : -1;
  const tries = [
    [first, 0.3],
    [-first, 0.3],
    [first * 0.5, -1],
    [-first * 0.5, -1],
  ];
  for (const fit of [radius, 0]) {
    for (const [side, fwd] of tries) {
      const x = t.x + (-dirZ * side + dirX * fwd) * r;
      const z = t.z + (dirX * side + dirZ * fwd) * r;
      if (ctx.nav.fitsAt(x, z, fit) && ctx.field.contains(x, z, 1)) {
        nav.detourX = x;
        nav.detourZ = z;
        nav.detourUntil = world.time + 1.2;
        nav.path = null;
        return;
      }
    }
  }
}

/**
 * Drives units toward their target: plans routes around water and buildings
 * (A* on the nav grid, only when the straight line is blocked), steers
 * around obstacles in the way, wriggles free when stuck, and turns idle
 * units to face where they're told to look.
 */
export function movementSystem(ctx: SimContext): System {
  return {
    name: 'movement',
    update(world, dt) {
      const budget = { plans: PLANS_PER_TICK };
      for (const e of world.query(Transform, Mover)) {
        const t = world.req(e, Transform);
        const m = world.req(e, Mover);

        if (m.targetX === null || m.targetZ === null) {
          m.nav.path = null;
          m.nav.stuckFor = 0;
          if (m.faceX !== null && m.faceZ !== null) {
            t.heading = turnToward(t.heading, Math.atan2(-(m.faceZ - t.z), m.faceX - t.x), m.turnRate * 0.5 * dt);
          }
          continue;
        }
        if (Math.hypot(m.targetX - t.x, m.targetZ - t.z) < 0.3) {
          m.targetX = m.targetZ = null;
          continue;
        }

        const wp = nextWaypoint(ctx, world, t, m, world.get(e, Collider)?.radius ?? 0, budget);
        const dx = wp.x - t.x;
        const dz = wp.z - t.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-4) continue;
        let dirX = dx / dist;
        let dirZ = dz / dist;
        const avoid = avoidance(ctx, world, e, t, dirX, dirZ);
        const sx = dirX + avoid.x;
        const sz = dirZ + avoid.z;
        const sl = Math.hypot(sx, sz);
        if (sl > 1e-4) {
          dirX = sx / sl;
          dirZ = sz / sl;
        }
        const desired = Math.atan2(-dirZ, dirX);
        const diff = wrapAngle(desired - t.heading);
        checkStuck(ctx, world, e, t, m.nav, dirX, dirZ, Math.abs(diff) > TURNING);

        t.heading = turnToward(t.heading, desired, m.turnRate * dt);
        // Slow down while facing away so units arc rather than strafe.
        const throttle = Math.max(0, Math.cos(diff));
        const stepLen = Math.min(dist, m.speed * throttle * dt);
        const nx = t.x + Math.cos(t.heading) * stepLen;
        const nz = t.z - Math.sin(t.heading) * stepLen;
        if (m.canCrossWater || !ctx.field.isWater(nx, nz)) {
          t.x = nx;
          t.z = nz;
        }
      }
    },
  };
}

/** Keeps the nav grid's building obstacles in sync as buildings fall and rise. */
export function navObstacleSystem(ctx: SimContext): System {
  const marked = new Map<Entity, { x: number; z: number; r: number }>();
  return {
    name: 'navObstacles',
    update(world) {
      for (const [e, o] of marked) {
        if (!world.has(e, Building)) {
          ctx.nav.markObstacle(o.x, o.z, o.r, -1);
          marked.delete(e);
        }
      }
      for (const e of world.query(Building, Transform, Collider)) {
        if (marked.has(e)) continue;
        const t = world.req(e, Transform);
        // A little clearance so routes don't scrape the walls.
        const o = { x: t.x, z: t.z, r: world.req(e, Collider).radius + 0.5 };
        ctx.nav.markObstacle(o.x, o.z, o.r, 1);
        marked.set(e, o);
      }
    },
  };
}
/** Pushes overlapping units apart, and out of buildings, so they don't stack up. */
export function separationSystem(ctx: SimContext): System {
  return {
    name: 'separation',
    update(world) {
      for (const e of world.query(Unit, Transform, Collider)) {
        const t = world.req(e, Transform);
        const r = world.req(e, Collider).radius;
        const myFaction = world.req(e, Faction).id;
        ctx.grid.forEachNear(t.x, t.z, r + 4, (other, d2) => {
          if (other === e || d2 < 1e-6) return;
          const ot = world.req(other, Transform);
          const minDist = r + world.req(other, Collider).radius;
          const d = Math.sqrt(d2);
          if (d >= minDist) return;
          // Buildings don't budge, so the unit takes the whole overlap. Between units each
          // moves part of it; enemies push a little harder so lines hold.
          const share = world.has(other, Building) ? 1 : world.req(other, Faction).id === myFaction ? 0.25 : 0.35;
          const push = ((minDist - d) / d) * share;
          const nx = t.x + (t.x - ot.x) * push;
          const nz = t.z + (t.z - ot.z) * push;
          if (!ctx.field.isWater(nx, nz)) {
            t.x = nx;
            t.z = nz;
          }
        });
      }
    },
  };
}

export function groundFollowSystem(field: Battlefield): System {
  return {
    name: 'groundFollow',
    update(world) {
      for (const e of world.query(Transform, GroundFollow)) {
        const t = world.req(e, Transform);
        t.x = field.clampX(t.x, 0.5);
        t.z = field.clampZ(t.z, 0.5);
        t.y = field.surfaceAt(t.x, t.z) + world.req(e, GroundFollow).offset;
      }
    },
  };
}
