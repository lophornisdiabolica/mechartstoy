import { Entity, System, World } from '../../core/ecs';
import { Battlefield } from '../../world/battlefield';
import { MOVE_RULES } from '../../world/moveClasses';
import { Building, Collider, Faction, GroundFollow, Mover, Transform, Unit } from '../components';
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
/** Route cost of plain open ground: a straight line to the goal over anything costlier gets a planned route instead. */
const PLAIN_GROUND = 1;
/** Heading error (radians) above which a unit counts as turning rather than stuck. */
const TURNING = 0.6;

/**
 * Pick the point to steer at this tick: a sidestep detour, the goal itself
 * if the straight line is clear, or the next waypoint of a planned route.
 */
function nextWaypoint(ctx: SimContext, world: World, t: Transform, m: Mover, radius: number, budget: { plans: number }): { x: number; z: number } {
  const nav = m.nav;
  const grid = ctx.navs.for(m.move);
  const goal = { x: m.targetX!, z: m.targetZ! };
  if (world.time < nav.detourUntil) return { x: nav.detourX, z: nav.detourZ };

  const here = { x: t.x, z: t.z };
  if (world.time >= nav.directCheckAt) {
    nav.directCheckAt = world.time + DIRECT_CHECK;
    // Straight there only if nothing's in the way and the line keeps to plain ground (see NavGrid.lineClear).
    nav.direct = grid.rules.flies || grid.lineClear(here, goal, radius, PLAIN_GROUND);
  }
  if (nav.direct) {
    nav.path = null;
    return goal;
  }

  const drifted = Math.hypot(goal.x - nav.pathGoalX, goal.z - nav.pathGoalZ) > GOAL_DRIFT;
  const stale = nav.path === null || nav.pathVersion !== grid.version || (drifted && world.time >= nav.replanAt);
  if (stale && budget.plans > 0) {
    budget.plans--;
    nav.path = grid.findPath(here, goal, radius);
    nav.pathIndex = 0;
    nav.pathGoalX = goal.x;
    nav.pathGoalZ = goal.z;
    nav.pathVersion = grid.version;
    nav.replanAt = world.time + REPLAN_INTERVAL;
  }
  const path = nav.path;
  if (!path || path.length === 0) return goal;

  while (nav.pathIndex < path.length - 1 && Math.hypot(path[nav.pathIndex].x - t.x, path[nav.pathIndex].z - t.z) < WAYPOINT_RADIUS) {
    nav.pathIndex++;
  }
  // Skip ahead when a later waypoint is already in clear view (e.g. after being pushed aside).
  const next = path[nav.pathIndex + 1];
  if (next && grid.lineClear(here, next, radius, Math.max(PLAIN_GROUND, grid.costAt(path[nav.pathIndex].x, path[nav.pathIndex].z), grid.costAt(next.x, next.z)))) nav.pathIndex++;
  return path[Math.min(nav.pathIndex, path.length - 1)];
}

/**
 * Lateral nudge away from things sitting in our way: buildings, enemies, and
 * friendlies that have stopped. Returns a sideways vector to add to the heading.
 */
function avoidance(ctx: SimContext, world: World, e: Entity, t: Transform, dirX: number, dirZ: number, air: Set<Entity>): { x: number; z: number } {
  const r = world.get(e, Collider)?.radius ?? 0.5;
  const lookahead = r + 2.5;
  const myFaction = world.get(e, Faction)?.id;
  const flying = air.has(e);
  let ax = 0;
  let az = 0;
  ctx.grid.forEachNear(t.x, t.z, lookahead + 3.5, (other) => {
    if (other === e) return;
    // Aircraft only steer round other aircraft, and ground units don't dodge what's flying over them.
    if (air.size > 0 && air.has(other) !== flying) return;
    const ot = world.req(other, Transform);
    const or = world.get(other, Collider)?.radius ?? 0.5;
    const isBuilding = world.has(other, Building);
    if (!isBuilding && myFaction !== undefined && ctx.sides.allied(world.get(other, Faction)?.id ?? -1, myFaction)) {
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
function checkStuck(ctx: SimContext, world: World, e: Entity, t: Transform, m: Mover, dirX: number, dirZ: number, turning: boolean): void {
  const nav = m.nav;
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
      if (ctx.navs.for(m.move).fitsAt(x, z, fit) && ctx.field.contains(x, z, 1)) {
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
      const air = aircraft(world);
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
        const avoid = avoidance(ctx, world, e, t, dirX, dirZ, air);
        const sx = dirX + avoid.x;
        const sz = dirZ + avoid.z;
        const sl = Math.hypot(sx, sz);
        if (sl > 1e-4) {
          dirX = sx / sl;
          dirZ = sz / sl;
        }
        const desired = Math.atan2(-dirZ, dirX);
        const diff = wrapAngle(desired - t.heading);
        checkStuck(ctx, world, e, t, m, dirX, dirZ, Math.abs(diff) > TURNING);

        t.heading = turnToward(t.heading, desired, m.turnRate * dt);
        // Slow down while facing away so units arc rather than strafe.
        const throttle = Math.max(0, Math.cos(diff));
        const rules = MOVE_RULES[m.move];
        // Wading and swimming are slower (or, for hovers, a little faster) than driving.
        const speed = !rules.flies && ctx.field.isWater(t.x, t.z) ? m.speed * rules.waterSpeed : m.speed;
        const stepLen = Math.min(dist, speed * throttle * dt);
        const nx = t.x + Math.cos(t.heading) * stepLen;
        const nz = t.z - Math.sin(t.heading) * stepLen;
        if (rules.flies || ctx.navs.for(m.move).terrainAllowsAt(nx, nz)) {
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
/** The aircraft in the world this tick (usually none, which lets the checks below skip the work). */
function aircraft(world: World): Set<Entity> {
  const air = new Set<Entity>();
  for (const e of world.query(Mover)) if (MOVE_RULES[world.req(e, Mover).move].flies) air.add(e);
  return air;
}

/** Extra gap infantry keep between each other (on top of their radii). */
const INFANTRY_SPACING = 0.9;

/**
 * Pushes overlapping units apart, and out of buildings, so they don't stack
 * up. Aircraft only bump into other aircraft.
 */
export function separationSystem(ctx: SimContext): System {
  return {
    name: 'separation',
    update(world) {
      const air = aircraft(world);
      for (const e of world.query(Unit, Transform, Collider)) {
        const t = world.req(e, Transform);
        const r = world.req(e, Collider).radius;
        const myFaction = world.req(e, Faction).id;
        const move = world.get(e, Mover)?.move ?? 'tracked';
        const flying = air.has(e);
        const terrain = ctx.navs.for(move);
        const foot = move === 'foot';
        ctx.grid.forEachNear(t.x, t.z, r + 4, (other, d2) => {
          if (other === e || d2 < 1e-6) return;
          if (air.size > 0 && air.has(other) !== flying) return;
          const ot = world.req(other, Transform);
          // Infantry keep a little apart from each other, so one shell doesn't catch a whole squad.
          const spacing = foot && world.get(other, Mover)?.move === 'foot' ? INFANTRY_SPACING : 0;
          const minDist = r + world.req(other, Collider).radius + spacing;
          const d = Math.sqrt(d2);
          if (d >= minDist) return;
          // Buildings don't budge, so the unit takes the whole overlap. Between units each
          // moves part of it; enemies push a little harder so lines hold.
          const share = world.has(other, Building) ? 1 : ctx.sides.allied(world.req(other, Faction).id, myFaction) ? 0.25 : 0.35;
          const push = ((minDist - d) / d) * share;
          const nx = t.x + (t.x - ot.x) * push;
          const nz = t.z + (t.z - ot.z) * push;
          if (flying || terrain.terrainAllowsAt(nx, nz)) {
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
