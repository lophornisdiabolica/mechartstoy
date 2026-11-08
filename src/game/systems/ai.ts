import { Entity, System, World } from '../../core/ecs';
import { Ai, Armed, Faction, Guard, Mover, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { CAPTURE_RADIUS, Outpost } from '../outposts';
import { objectiveIn } from '../spawn';
import { Role } from '../units';
import { distanceToTarget, effectiveRange } from './targeting';
import { MOVE_RULES } from '../../world/moveClasses';
import { threatKindOf } from '../commander/threats';
import * as D from '../../core/dmath';

/** How far an outpost's guards chase from the post before going back. */
const GUARD_LEASH = CAPTURE_RADIUS + 12;
/** Radians per second squads walk round an outpost they're holding. */
const PATROL_SPEED = 0.06;
/** Distance from the post that squads holding an outpost patrol at. */
const PATROL_RADIUS = CAPTURE_RADIUS - 2;
/** How far around itself a support unit looks for a frontline ally to follow. */
const ESCORT_RANGE = 24;
/** How far behind a frontline ally a support unit follows. */
const SUPPORT_TRAIL = 4;
/** How far ahead round its circle an aircraft fighting something aims, radians. */
const ORBIT_STEP = 0.7;
/** Seconds between an artillery or support unit's looks around (see Ai.roleCheckAt). */
const ROLE_CHECK = 0.5;
/** Massing infantry man trenches within this distance of their rally point. */
const TRENCH_MUSTER = 16;
/**
 * Whether a squad is one of the `share` of squads that hold outposts (see
 * the outpostHold setting): fixed per squad, spread evenly by the golden ratio.
 */
export function holdsOutposts(squad: number, share: number): boolean {
  return (squad * 0.618034) % 1 < share;
}

/**
 * Unit movement decisions. With a target: close to weapon range and hold.
 * Without: on the offensive, march down the squad's lane (see lanes.ts)
 * toward the enemy side its team is attacking this time (see Sides.target)
 * and into that base, taking any outpost on the lane on the way; otherwise
 * hold. A share of the squads on an outpost's lane (the outpostHold setting)
 * hold and patrol at that outpost (taking it first if need be); the rest mass
 * at their lane's rally point in front of the base until the next attack. The faction's orders can force the
 * stance and move the rally point.
 *
 * An outpost's guards (Guard) only ever defend their outpost.
 */
export function aiSystem(ctx: SimContext): System {
  return {
    name: 'ai',
    update(world) {
      for (const e of world.query(Ai, Armed, Mover, Transform)) {
        const ai = world.req(e, Ai);
        const armed = world.req(e, Armed);
        const mover = world.req(e, Mover);
        const t = world.req(e, Transform);
        const faction = world.req(e, Faction).id;
        const guard = world.get(e, Guard);
        const post = guard ? ctx.outposts[guard.outpost] : null;
        const def = world.get(e, Unit)?.def;
        // Engineers go and build what the Commander wants built, or wait at home (see commander/engineers.ts).
        if (def?.builds) {
          const job = ctx.commander.engineers.jobFor(e);
          const home = ctx.field.baseSites[faction];
          const enemy = ctx.sides.target(faction, ctx.offensive.attack(faction, world.time));
          const face = enemy !== null ? ctx.field.baseSites[enemy] : { x: 0, z: 0 };
          // With nothing to build, they follow a push out (see Engineers.waitFor) or wait at home.
          const wait = ctx.commander.engineers.waitFor(faction);
          if (job) moveTo(mover, t, job.standX, job.standZ, job.x, job.z);
          else if (wait) moveTo(mover, t, wait.x + ai.rallyOffsetX * 0.3, wait.z + ai.rallyOffsetZ * 0.3, face.x, face.z);
          else moveTo(mover, t, home.x + ai.rallyOffsetX * 0.5, home.z + ai.rallyOffsetZ * 0.5, face.x, face.z);
          continue;
        }
        const role: Role = def?.role ?? 'frontline';
        const lookAround = role !== 'frontline' && world.time >= ai.roleCheckAt;
        if (lookAround) ai.roleCheckAt = world.time + ROLE_CHECK;

        // Artillery backs away from enemy units inside its minimum range, to where it can shoot them.
        if (role === 'artillery' && armed.weapon.minRange > 0) {
          if (lookAround) ai.threat = nearestEnemyUnit(world, ctx, e, faction, armed.weapon.minRange);
          const threat = ai.threat !== null && world.isAlive(ai.threat) ? ai.threat : null;
          if (threat) {
            const tt = world.req(threat, Transform);
            const d = Math.max(0.1, D.hypot(t.x - tt.x, t.z - tt.z));
            const away = { x: t.x + ((t.x - tt.x) / d) * 6, z: t.z + ((t.z - tt.z) / d) * 6 };
            if (ctx.navs.for(mover.move).terrainAllowsAt(away.x, away.z)) {
              mover.targetX = away.x;
              mover.targetZ = away.z;
              mover.faceX = tt.x;
              mover.faceZ = tt.z;
              continue;
            }
          }
        }

        if (armed.target !== null && world.isAlive(armed.target) && (!post || near(world, armed.target, post, GUARD_LEASH))) {
          const tt = world.req(armed.target, Transform);
          const reach = effectiveRange(world, e, armed, armed.target);
          const outOfRange = distanceToTarget(world, e, armed.target) > reach * (role === 'artillery' ? 0.95 : 0.85);
          // Support units don't chase: out of range, they carry on keeping up with the frontline.
          if (!(role === 'support' && outOfRange && !post)) {
            // Square up to whatever we're fighting. Artillery stops near its longest range.
            mover.faceX = tt.x;
            mover.faceZ = tt.z;
            if (armed.blocked) {
              // Something's in the way: go round to a spot with a clear shot, or failing that, close in.
              const spotted = armed.spotX !== null && armed.spotZ !== null;
              mover.targetX = spotted ? armed.spotX : tt.x;
              mover.targetZ = spotted ? armed.spotZ : tt.z;
            } else if (outOfRange) {
              mover.targetX = tt.x;
              mover.targetZ = tt.z;
            } else if (MOVE_RULES[mover.move].flies) {
              // Aircraft don't park over a fight: they circle it, guns on the target.
              const a = D.atan2(t.z - tt.z, t.x - tt.x) + ORBIT_STEP;
              const r = Math.max(2, reach * 0.6);
              mover.targetX = tt.x + D.cos(a) * r;
              mover.targetZ = tt.z + D.sin(a) * r;
            } else {
              mover.targetX = mover.targetZ = null;
            }
            continue;
          }
        }

        // Support units tag along a little behind the nearest frontline ally.
        if (role === 'support' && !post) {
          if (lookAround) ai.escort = nearestFrontline(world, ctx, e, faction);
          const lead = ai.escort !== null && world.isAlive(ai.escort) ? ai.escort : null;
          if (lead !== null) {
            const lt = world.req(lead, Transform);
            const bx = lt.x - D.cos(lt.heading) * SUPPORT_TRAIL + ai.rallyOffsetX * 0.3;
            const bz = lt.z + D.sin(lt.heading) * SUPPORT_TRAIL + ai.rallyOffsetZ * 0.3;
            moveTo(mover, t, bx, bz, lt.x + D.cos(lt.heading) * 10, lt.z - D.sin(lt.heading) * 10);
            continue;
          }
        }

        if (post) {
          // Walk the outpost's perimeter, ready for whoever comes.
          const p = patrolPoint(post, ai.squad, world.time);
          moveTo(mover, t, p.x, p.z, post.x * 2 - p.x, post.z * 2 - p.z);
          continue;
        }

        const orders = ctx.orders[faction];
        const { armies } = ctx.settings;
        // Each attack, the squad gets its target and lane for that attack (and the build-up before it).
        const attack = ctx.offensive.attack(faction, world.time);
        const target = ctx.sides.target(faction, attack) ?? -1;
        if (ai.laneAttack !== attack || ai.target !== target) {
          ai.lane = target >= 0 ? ctx.lanes.laneFor(faction, target, attack, ai.squad, armies.flanking) : 0;
          // The Commander may move it to a lane less dangerous to its kind of unit (see commander/threats.ts).
          if (target >= 0 && def && orders.stance === 'auto' && !orders.rally) ai.lane = ctx.commander.avoidance.lane(ctx, faction, target, ai.lane, threatKindOf(def, mover.move));
          ai.laneAttack = attack;
          ai.target = target;
          if (target >= 0) {
            const objective = objectiveIn(ctx, target);
            ai.objectiveX = objective.x;
            ai.objectiveZ = objective.z;
          }
        }
        // The outpost on this squad's lane, if any.
        const via = target >= 0 ? ctx.lanes.routes(faction, target)[ai.lane]?.via : null;
        // Boats can't take outposts or follow land lanes: they head straight for the enemy base
        // and stop at the nearest water they can reach (see NavGrid.nearestInRegion).
        const naval = mover.move === 'naval';
        const outpost = via?.kind === 'outpost' && !naval ? ctx.outposts[via.index] : null;
        const ours = outpost !== null && ctx.sides.allied(outpost.owner, faction);

        // On auto, an attack is called off while the side's own base can't hold (Sides.recalling).
        // The Commander's job for this unit, if any; the flag and stances override it.
        const job = orders.stance === 'auto' && !orders.rally ? ctx.commander.roles.jobFor(e) : undefined;
        const recalled = ctx.sides.recalling[faction];
        const auto = orders.stance === 'auto' && !recalled && ctx.offensive.attacking(faction, world.time);
        const attacking = target >= 0 && (orders.stance === 'attack' || auto);
        if (!attacking) {
          // Form up at the player's flag; else hold this lane's outpost (unless the base itself
          // is under attack); else meet an attack on the base (or an ally's); else in front of
          // the base, leaning toward this squad's lane.
          // A squad on a task force goes about its job (see commander/taskForces.ts): into an outpost
          // to take it, or round it to hold it. The flag and stances override it.
          const force = orders.stance === 'auto' && !orders.rally ? ctx.commander.taskForces.forSquad(ai.squad) : undefined;
          if (force && force.side === faction) {
            const o = ctx.outposts[force.outpost];
            const p = patrolPoint(o, ai.squad, world.time);
            const k = force.kind === 'take' ? 0.5 : 1;
            moveTo(mover, t, o.x + (p.x - o.x) * k + ai.rallyOffsetX * 0.3, o.z + (p.z - o.z) * k + ai.rallyOffsetZ * 0.3, force.kind === 'take' ? o.x : p.x * 2 - o.x, force.kind === 'take' ? o.z : p.z * 2 - o.z);
            continue;
          }
          // Flak covering something of ours, or artillery waiting on high ground (see commander/roles.ts).
          if (job && (job.kind === 'cover' || job.kind === 'overwatch')) {
            const face = target >= 0 ? ctx.field.baseSites[target] : job;
            moveTo(mover, t, job.x + ai.rallyOffsetX * 0.5, job.z + ai.rallyOffsetZ * 0.5, face.x, face.z);
            continue;
          }
          const home = ctx.field.baseSites[faction];
          const defend = orders.rally ? null : ctx.sides.defencePoint(faction);
          if (!orders.rally && outpost && holdsOutposts(ai.squad, armies.outpostHold) && !ctx.sides.underAttack(faction)) {
            const p = patrolPoint(outpost, ai.squad, world.time);
            moveTo(mover, t, p.x + ai.rallyOffsetX * 0.4, p.z + ai.rallyOffsetZ * 0.4, ours ? p.x * 2 - outpost.x : outpost.x, ours ? p.z * 2 - outpost.z : outpost.z);
            continue;
          }
          const rally = orders.rally ?? defend ?? (target >= 0 ? ctx.lanes.rally(faction, target, ai.lane) : home);
          const facing = defend?.face ?? (target >= 0 ? ctx.field.baseSites[target] : { x: 0, z: 0 });
          // Infantry squads man the trenches their engineers dug near the rally point (see commander/engineers.ts).
          if (def?.class === 'infantry' && !orders.rally && !defend) {
            const trenches = ctx.commander.engineers.trenchesNear(faction, rally.x, rally.z, TRENCH_MUSTER);
            if (trenches.length > 0) {
              const w = trenches[ai.squad % trenches.length];
              // Spread along the stretch, by squad and soldier.
              const spread = (((ai.squad * 0.618 + ai.rallyOffsetX * 0.11 + ai.rallyOffsetZ * 0.07) % 1) + 1) % 1;
              const k = 0.1 + 0.8 * spread;
              const x = w.ax + (w.bx - w.ax) * k;
              const z = w.az + (w.bz - w.az) * k;
              // Right into the trench, not just near it.
              const there = D.hypot(x - t.x, z - t.z) < 0.4;
              mover.targetX = there ? null : x;
              mover.targetZ = there ? null : z;
              mover.faceX = facing.x;
              mover.faceZ = facing.z;
              continue;
            }
          }
          let rx = rally.x + ai.rallyOffsetX;
          let rz = rally.z + ai.rallyOffsetZ;
          if (!ctx.navs.for(mover.move).terrainAllowsAt(rx, rz)) {
            rx = rally.x;
            rz = rally.z;
          }
          // Hold near the rally point facing the next enemy; small tolerance so units settle rather than jostle.
          moveTo(mover, t, rx, rz, facing.x, facing.z);
          continue;
        }

        // On an attack, flak keeps over whatever of ours the enemy's aircraft are after, and escorts stay round the super unit.
        if (job?.kind === 'cover') {
          moveTo(mover, t, job.x + ai.rallyOffsetX * 0.5, job.z + ai.rallyOffsetZ * 0.5, job.x, job.z);
          continue;
        }
        if (job?.kind === 'escort' && job.lead !== null && world.isAlive(job.lead)) {
          const lt = world.req(job.lead, Transform);
          moveTo(mover, t, lt.x + job.x, lt.z + job.z, lt.x + D.cos(lt.heading) * 10, lt.z - D.sin(lt.heading) * 10);
          continue;
        }

        // An outpost on the way that isn't ours gets taken before the march goes on.
        if (outpost && !ours && ctx.lanes.progress(faction, target, t.x, t.z) < ctx.lanes.progress(faction, target, outpost.x, outpost.z) + 0.05) {
          const p = patrolPoint(outpost, ai.squad, world.time);
          const k = 0.5; // inside the capture ring, not on its edge
          mover.targetX = outpost.x + (p.x - outpost.x) * k + ai.rallyOffsetX * 0.3;
          mover.targetZ = outpost.z + (p.z - outpost.z) * k + ai.rallyOffsetZ * 0.3;
          mover.faceX = outpost.x;
          mover.faceZ = outpost.z;
          continue;
        }

        // Going round ground that's dangerous to this squad, if the Commander says so (see commander/threats.ts).
        const detour = !naval && orders.stance === 'auto' && !orders.rally ? ctx.commander.avoidance.detourFor(ai.squad) : undefined;
        if (detour) {
          mover.targetX = detour.x + ai.rallyOffsetX * 0.6;
          mover.targetZ = detour.z + ai.rallyOffsetZ * 0.6;
          mover.faceX = mover.targetX;
          mover.faceZ = mover.targetZ;
          continue;
        }

        // March down the lane, then into the enemy base.
        const waypoint = naval ? null : ctx.lanes.nextWaypoint(faction, target, ai.lane, t.x, t.z);
        if (waypoint) {
          // Squads spread out a little around the waypoint rather than queueing for one spot.
          mover.targetX = waypoint.x + ai.rallyOffsetX * 0.6;
          mover.targetZ = waypoint.z + ai.rallyOffsetZ * 0.6;
          mover.faceX = mover.targetX;
          mover.faceZ = mover.targetZ;
          continue;
        }
        if (D.hypot(ai.objectiveX - t.x, ai.objectiveZ - t.z) < 3) {
          // Reached the objective: pick another spot in the enemy base.
          const next = objectiveIn(ctx, target);
          ai.objectiveX = next.x;
          ai.objectiveZ = next.z;
        }
        mover.targetX = ai.objectiveX;
        mover.targetZ = ai.objectiveZ;
        mover.faceX = ai.objectiveX;
        mover.faceZ = ai.objectiveZ;
      }
    },
  };
}

/** The closest enemy unit (not building) within `range`, if any. */
function nearestEnemyUnit(world: World, ctx: SimContext, e: Entity, faction: number, range: number): Entity | null {
  if (range <= 0) return null;
  const t = world.req(e, Transform);
  let best: Entity | null = null;
  let bestD2 = range * range;
  ctx.grid.forEachNear(t.x, t.z, range, (other, d2) => {
    if (d2 >= bestD2 || world.get(other, Targetable)?.kind !== 'unit') return;
    if (!ctx.sides.hostile(faction, world.req(other, Faction).id)) return;
    best = other;
    bestD2 = d2;
  });
  return best;
}

/** Whether a unit leads the fighting (frontline role, and not an outpost's guard). */
function isFrontline(world: World, e: Entity): boolean {
  return world.get(e, Unit)?.def.role === 'frontline' && !world.has(e, Guard);
}

/** The closest allied frontline unit within ESCORT_RANGE, if any. */
function nearestFrontline(world: World, ctx: SimContext, e: Entity, faction: number): Entity | null {
  const t = world.req(e, Transform);
  let best: Entity | null = null;
  let bestD2 = ESCORT_RANGE * ESCORT_RANGE;
  ctx.grid.forEachNear(t.x, t.z, ESCORT_RANGE, (other, d2) => {
    if (other === e || d2 >= bestD2 || !isFrontline(world, other)) return;
    if (!ctx.sides.allied(faction, world.req(other, Faction).id)) return;
    best = other;
    bestD2 = d2;
  });
  return best;
}

/** Whether an entity is within `range` of an outpost's post. */
function near(world: World, e: Entity, post: Outpost, range: number): boolean {
  const t = world.req(e, Transform);
  return D.hypot(t.x - post.x, t.z - post.z) <= range;
}

/** A squad's current spot on its walk round an outpost; squads are spread round the ring. */
function patrolPoint(outpost: Outpost, squad: number, time: number): { x: number; z: number } {
  const angle = squad * 2.399 + time * PATROL_SPEED;
  return { x: outpost.x + D.cos(angle) * PATROL_RADIUS, z: outpost.z + D.sin(angle) * PATROL_RADIUS };
}

/** Head for a spot and face a point; stop when close so units settle rather than jostle. */
function moveTo(mover: Mover, t: Transform, x: number, z: number, faceX: number, faceZ: number): void {
  mover.faceX = faceX;
  mover.faceZ = faceZ;
  const close = D.hypot(x - t.x, z - t.z) < 2.5;
  mover.targetX = close ? null : x;
  mover.targetZ = close ? null : z;
}
