import { Entity, System, World } from '../../core/ecs';
import { Ai, Armed, Faction, Guard, Mover, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { CAPTURE_RADIUS, Outpost } from '../outposts';
import { objectiveIn } from '../spawn';
import { Role } from '../units';
import { distanceToTarget, effectiveRange } from './targeting';

/** How far an outpost's guards chase from the post before going back. */
const GUARD_LEASH = CAPTURE_RADIUS + 12;
/** Radians per second squads walk round an outpost they're holding. */
const PATROL_SPEED = 0.06;
/** Distance from the post that squads holding an outpost patrol at. */
const PATROL_RADIUS = CAPTURE_RADIUS - 2;
/** How far around itself artillery and support units look for the frontline allies they keep behind. */
const ESCORT_RANGE = 24;
/** How far behind the frontline artillery holds on the march. */
const ARTILLERY_HANG_BACK = 10;
/** How far behind a frontline ally a support unit follows. */
const SUPPORT_TRAIL = 4;
/** Seconds between an artillery or support unit's looks around (see Ai.roleCheckAt). */
const ROLE_CHECK = 0.5;
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
        const role: Role = world.get(e, Unit)?.def.role ?? 'frontline';
        const lookAround = role !== 'frontline' && world.time >= ai.roleCheckAt;
        if (lookAround) ai.roleCheckAt = world.time + ROLE_CHECK;

        // Artillery backs away from enemy units inside its minimum range, to where it can shoot them.
        if (role === 'artillery' && armed.weapon.minRange > 0) {
          if (lookAround) ai.threat = nearestEnemyUnit(world, ctx, e, faction, armed.weapon.minRange);
          const threat = ai.threat !== null && world.isAlive(ai.threat) ? ai.threat : null;
          if (threat) {
            const tt = world.req(threat, Transform);
            const d = Math.max(0.1, Math.hypot(t.x - tt.x, t.z - tt.z));
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
            if (outOfRange) {
              mover.targetX = tt.x;
              mover.targetZ = tt.z;
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
            const bx = lt.x - Math.cos(lt.heading) * SUPPORT_TRAIL + ai.rallyOffsetX * 0.3;
            const bz = lt.z + Math.sin(lt.heading) * SUPPORT_TRAIL + ai.rallyOffsetZ * 0.3;
            moveTo(mover, t, bx, bz, lt.x + Math.cos(lt.heading) * 10, lt.z - Math.sin(lt.heading) * 10);
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
        const outpost = via?.kind === 'outpost' ? ctx.outposts[via.index] : null;
        const ours = outpost !== null && ctx.sides.allied(outpost.owner, faction);

        // On auto, an attack is called off while the side's own base can't hold (Sides.recalling).
        const recalled = ctx.sides.recalling[faction];
        const auto = orders.stance === 'auto' && !recalled && ctx.offensive.attacking(faction, world.time);
        const attacking = target >= 0 && (orders.stance === 'attack' || auto);
        if (!attacking) {
          // Form up at the player's flag; else hold this lane's outpost (unless the base itself
          // is under attack); else meet an attack on the base (or an ally's); else in front of
          // the base, leaning toward this squad's lane.
          const home = ctx.field.baseSites[faction];
          const defend = orders.rally ? null : ctx.sides.defencePoint(faction);
          if (!orders.rally && outpost && holdsOutposts(ai.squad, armies.outpostHold) && !ctx.sides.underAttack(faction)) {
            const p = patrolPoint(outpost, ai.squad, world.time);
            moveTo(mover, t, p.x + ai.rallyOffsetX * 0.4, p.z + ai.rallyOffsetZ * 0.4, ours ? p.x * 2 - outpost.x : outpost.x, ours ? p.z * 2 - outpost.z : outpost.z);
            continue;
          }
          const rally = orders.rally ?? defend ?? (target >= 0 ? ctx.lanes.rally(faction, target, ai.lane) : home);
          let rx = rally.x + ai.rallyOffsetX;
          let rz = rally.z + ai.rallyOffsetZ;
          if (!ctx.navs.for(mover.move).terrainAllowsAt(rx, rz)) {
            rx = rally.x;
            rz = rally.z;
          }
          // Hold near the rally point facing the next enemy; small tolerance so units settle rather than jostle.
          const facing = defend?.face ?? (target >= 0 ? ctx.field.baseSites[target] : { x: 0, z: 0 });
          moveTo(mover, t, rx, rz, facing.x, facing.z);
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

        // Artillery keeps behind the frontline pushing the same attack, rather than leading it.
        if (role === 'artillery') {
          if (lookAround) ai.lead = frontlineProgress(world, ctx, e, faction, target);
          const lead = ai.lead;
          const here = ctx.lanes.progress(faction, target, t.x, t.z);
          const a = ctx.field.baseSites[faction];
          const b = ctx.field.baseSites[target];
          if (lead !== null && here > lead - ARTILLERY_HANG_BACK / Math.max(1, Math.hypot(b.x - a.x, b.z - a.z))) {
            mover.targetX = mover.targetZ = null;
            mover.faceX = b.x;
            mover.faceZ = b.z;
            continue;
          }
        }

        // March down the lane, then into the enemy base.
        const waypoint = ctx.lanes.nextWaypoint(faction, target, ai.lane, t.x, t.z);
        if (waypoint) {
          // Squads spread out a little around the waypoint rather than queueing for one spot.
          mover.targetX = waypoint.x + ai.rallyOffsetX * 0.6;
          mover.targetZ = waypoint.z + ai.rallyOffsetZ * 0.6;
          mover.faceX = mover.targetX;
          mover.faceZ = mover.targetZ;
          continue;
        }
        if (Math.hypot(ai.objectiveX - t.x, ai.objectiveZ - t.z) < 3) {
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

/**
 * How far along the way to `target` (see Lanes.progress) the furthest allied
 * frontline unit nearby has got on the same attack, or null if there's none
 * within ESCORT_RANGE (artillery on its own just carries on).
 */
function frontlineProgress(world: World, ctx: SimContext, e: Entity, faction: number, target: number): number | null {
  const t = world.req(e, Transform);
  let lead: number | null = null;
  ctx.grid.forEachNear(t.x, t.z, ESCORT_RANGE, (other) => {
    if (other === e || !isFrontline(world, other)) return;
    if (!ctx.sides.allied(faction, world.req(other, Faction).id) || world.get(other, Ai)?.target !== target) return;
    const ot = world.req(other, Transform);
    const p = ctx.lanes.progress(faction, target, ot.x, ot.z);
    if (lead === null || p > lead) lead = p;
  });
  return lead;
}

/** Whether an entity is within `range` of an outpost's post. */
function near(world: World, e: Entity, post: Outpost, range: number): boolean {
  const t = world.req(e, Transform);
  return Math.hypot(t.x - post.x, t.z - post.z) <= range;
}

/** A squad's current spot on its walk round an outpost; squads are spread round the ring. */
function patrolPoint(outpost: Outpost, squad: number, time: number): { x: number; z: number } {
  const angle = squad * 2.399 + time * PATROL_SPEED;
  return { x: outpost.x + Math.cos(angle) * PATROL_RADIUS, z: outpost.z + Math.sin(angle) * PATROL_RADIUS };
}

/** Head for a spot and face a point; stop when close so units settle rather than jostle. */
function moveTo(mover: Mover, t: Transform, x: number, z: number, faceX: number, faceZ: number): void {
  mover.faceX = faceX;
  mover.faceZ = faceZ;
  const close = Math.hypot(x - t.x, z - t.z) < 2.5;
  mover.targetX = close ? null : x;
  mover.targetZ = close ? null : z;
}
