import { Entity, System, World } from '../../core/ecs';
import { Ai, Ammo, Armed, Building, Construction, FallingBack, Faction, GroundFollow, Guard, Health, Mover, Nomad, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { CAPTURE_RADIUS, Outpost } from '../outposts';
import { objectiveIn } from '../spawn';
import { hillOf } from '../hill';
import { Role } from '../units';
import { distanceToTarget, effectiveRange } from './targeting';
import { MOVE_RULES, MoveClass } from '../../world/moveClasses';
import type { NavGrid } from '../../world/navGrid';
import { threatKindOf } from '../commander/threats';
import type { Earthwork } from '../commander/engineers';
import * as D from '../../core/dmath';
import { escapeFrom, strikeDanger } from '../zenith';
import { campSpot } from '../nomad';
import { mendingPlace } from '../retreat';
import { presenting } from '../alternate';

/** How far an outpost's guards chase from the post before going back. */
const GUARD_LEASH = CAPTURE_RADIUS + 12;
/** Radians per second squads walk round an outpost they're holding. */
const PATROL_SPEED = 0.09;
/** Distance from the post that squads holding an outpost patrol at. */
const PATROL_RADIUS = CAPTURE_RADIUS - 2;
/** How far around itself a support unit looks for a frontline ally to follow. */
const ESCORT_RANGE = 24;
/** How far behind a frontline ally a support unit follows. */
const SUPPORT_TRAIL = 4;
/**
 * How far a frontline ally that goes where a support unit can't (see
 * outreaches) has to be from any such ground for the support unit to follow
 * it: a spider at a channel's edge is about to wade across it.
 */
const ESCORT_CLEAR = 6;
/** How far ahead round its circle an aircraft fighting something aims, radians. */
const ORBIT_STEP = 0.7;
/** How far a desperate unit looks for an enemy to drive at (see UnitDef.desperate). */
const CHARGE_RANGE = 30;
/** Seconds between an artillery or support unit's looks around (see Ai.roleCheckAt). */
const ROLE_CHECK = 0.5;
/** Massing infantry man trenches within this distance of their rally point. */
const TRENCH_MUSTER = 16;
/** Room each soldier takes along a trench, which holds two ranks; soldiers past what the trenches near the rally point hold wait at the rally point. */
const TRENCH_ROOM = 1.2;
const TRENCH_RANK = 0.35;
/** Hunters going for a gun stop to fight only what's within this of it. */
const HUNT_GUARD = 12;
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
      // Places taken in each trench this tick (see trenchPlace).
      const manned = new Map<Earthwork, Uint8Array>();
      for (const e of world.query(Ai, Armed, Mover, Transform)) {
        const ai = world.req(e, Ai);
        const armed = world.req(e, Armed);
        const mover = world.req(e, Mover);
        const t = world.req(e, Transform);
        const faction = world.req(e, Faction).id;
        const guard = world.get(e, Guard);
        const post = guard ? ctx.outposts[guard.outpost] : null;
        const def = world.get(e, Unit)?.def;
        // A charge lasts only while the AI keeps calling it (see the melee notes below).
        if (mover.surge) mover.surge = undefined;
        if (mover.pace) mover.pace = undefined;
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
        // Nomad's crawlers drive to where they'll set up camp (see nomad.ts).
        if (def?.deploys) {
          const nomad = world.get(e, Nomad);
          const spot = nomad ? campSpot(ctx, faction, nomad.slot) : null;
          if (spot) moveTo(mover, t, spot.x, spot.z, spot.x + spot.dirX * 10, spot.z + spot.dirZ * 10);
          continue;
        }
        // Under an enemy's orbital strike ring: get out from under it, whatever else is going on (see zenith.ts).
        if (ctx.strikes.list.length > 0 && !MOVE_RULES[mover.move].flies) {
          const strike = strikeDanger(ctx, faction, t.x, t.z, world.time);
          if (strike) {
            const out = escapeFrom(strike, t.x, t.z);
            mover.targetX = out.x;
            mover.targetZ = out.z;
            mover.faceX = out.x;
            mover.faceZ = out.z;
            continue;
          }
        }
        // Beaten: falling back home to mend (see retreat.ts), fighting only what it passes.
        if (world.has(e, FallingBack)) {
          const home = mendingPlace(world, ctx, faction, t.x, t.z);
          const enemy = ctx.sides.target(faction, ctx.offensive.attack(faction, world.time));
          const face = enemy !== null ? ctx.field.baseSites[enemy] : { x: t.x, z: t.z };
          moveTo(mover, t, home.x + ai.rallyOffsetX * 0.3, home.z + ai.rallyOffsetZ * 0.3, face.x, face.z);
          continue;
        }
        // Out of ammunition: home to the airpad, set down, and wait to be loaded again (see Ammo).
        const ammo = world.get(e, Ammo);
        if (ammo?.rearming && armed.burstLeft === 0) {
          rearm(world, ctx, e, ammo, mover, t, faction);
          continue;
        }
        // Low on health, a unit carrying fuel breaks off and drives at the nearest enemy (see UnitDef.desperate).
        if (def?.desperate && !post) {
          const h = world.get(e, Health);
          if (h && h.hp < h.max * def.desperate) {
            if (world.time >= ai.roleCheckAt) {
              ai.roleCheckAt = world.time + ROLE_CHECK;
              ai.threat = nearestEnemyUnit(world, ctx, e, faction, CHARGE_RANGE, true);
            }
            const prey = ai.threat !== null && world.isAlive(ai.threat) && world.has(ai.threat, Targetable) ? ai.threat : null;
            if (prey !== null) {
              const pt = world.req(prey, Transform);
              mover.targetX = pt.x;
              mover.targetZ = pt.z;
              mover.faceX = pt.x;
              mover.faceZ = pt.z;
              continue;
            }
          }
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

        // Hunting a long-range gun (see commander/hunts.ts): round the flank point first without stopping to
        // fight, then at the gun, fighting only what's guarding it. The flag and stances override it.
        const hunt = !post && ctx.orders[faction].stance === 'auto' && !ctx.orders[faction].rally ? ctx.commander.hunts.forSquad(ai.squad) : undefined;
        if (hunt && hunt.side === faction) {
          if (hunt.stage === 'flank' && hunt.flankX !== null && hunt.flankZ !== null) {
            moveTo(mover, t, hunt.flankX + ai.rallyOffsetX * 0.4, hunt.flankZ + ai.rallyOffsetZ * 0.4, hunt.x, hunt.z);
            continue;
          }
          const onGuard = armed.target !== null && world.isAlive(armed.target) && D.hypot(world.req(armed.target, Transform).x - hunt.x, world.req(armed.target, Transform).z - hunt.z) < HUNT_GUARD;
          if (!onGuard) {
            moveTo(mover, t, hunt.x + ai.rallyOffsetX * 0.2, hunt.z + ai.rallyOffsetZ * 0.2, hunt.x, hunt.z);
            continue;
          }
        }
        const melee = armed.weapon.melee;
        if (armed.target !== null && world.isAlive(armed.target) && (!post || near(world, armed.target, post, GUARD_LEASH))) {
          const tt = world.req(armed.target, Transform);
          const reach = effectiveRange(world, e, armed, armed.target);
          // A unit whose weapons point different ways (see alternate.ts): it closes until the one it's bringing
          // to bear reaches, then stops and swings round to face its target with it (the weapons system turns it).
          const turning = def?.alternates ? presenting(world, e) : null;
          if (turning) {
            const pt = world.req(turning.target, Transform);
            if (!turning.inReach) {
              if (turning.armed.weapon.melee?.charge) mover.surge = turning.armed.weapon.melee.charge;
              mover.faceX = mover.targetX = pt.x;
              mover.faceZ = mover.targetZ = pt.z;
            } else {
              mover.targetX = mover.targetZ = null;
              mover.faceX = t.x + D.cos(turning.heading) * 10;
              mover.faceZ = t.z - D.sin(turning.heading) * 10;
            }
            continue;
          }
          // Melee units fight up against their target: they close on it at a run, and keep pressing in (see melee.ts).
          if (melee) {
            const closing = distanceToTarget(world, e, armed.target) > reach;
            if (closing && melee.charge) mover.surge = melee.charge;
            mover.faceX = tt.x;
            mover.faceZ = tt.z;
            mover.targetX = tt.x;
            mover.targetZ = tt.z;
            continue;
          }
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
            } else if (def?.fixedWing) {
              attackRun(ai, mover, t, tt, world.time);
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

        // A charge the Commander called for this squad, at enemies just out of its sight (see commander/charges.ts).
        const charge = !post && ctx.orders[faction].stance === 'auto' && !ctx.orders[faction].rally ? ctx.commander.charges.forSquad(ai.squad) : undefined;
        if (charge && charge.side === faction) {
          if (melee?.charge) mover.surge = melee.charge;
          mover.targetX = charge.x + ai.rallyOffsetX * 0.3;
          mover.targetZ = charge.z + ai.rallyOffsetZ * 0.3;
          mover.faceX = charge.x;
          mover.faceZ = charge.z;
          continue;
        }

        // Support units tag along a little behind the nearest frontline ally.
        if (role === 'support' && !post) {
          const escorts = def?.escorts;
          if (lookAround) ai.escort = nearestFrontline(world, ctx, e, faction, escorts?.alone ?? false);
          const lead = ai.escort !== null && world.isAlive(ai.escort) ? ai.escort : null;
          if (lead !== null) {
            const lt = world.req(lead, Transform);
            const trail = escorts?.trail ?? SUPPORT_TRAIL;
            const slack = escorts?.trail !== undefined ? 0.1 : 0.3;
            const bx = lt.x - D.cos(lt.heading) * trail + ai.rallyOffsetX * slack;
            const bz = lt.z + D.sin(lt.heading) * trail + ai.rallyOffsetZ * slack;
            moveTo(mover, t, bx, bz, lt.x + D.cos(lt.heading) * 10, lt.z - D.sin(lt.heading) * 10);
            continue;
          }
        }

        if (post) {
          // Walk the outpost's perimeter, ready for whoever comes.
          patrol(mover, t, post, ai.squad, world.time, 0, 0);
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
        // Not when the team has gone all in for the hill: it's win there or lose anyway.
        const recalled = ctx.sides.recalling[faction] && !ctx.offensive.allIn(faction);
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
            if (force.kind === 'take') {
              const p = patrolPoint(o, ai.squad, world.time);
              moveTo(mover, t, o.x + (p.x - o.x) * 0.5 + ai.rallyOffsetX * 0.3, o.z + (p.z - o.z) * 0.5 + ai.rallyOffsetZ * 0.3, o.x, o.z);
            } else patrol(mover, t, o, ai.squad, world.time, ai.rallyOffsetX * 0.3, ai.rallyOffsetZ * 0.3);
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
          // King of the hill: a team holding the hill keeps its army round it between attacks.
          const hill = naval || orders.rally || defend ? null : hillOf(ctx);
          if (hill && ctx.sides.allied(hill.owner, faction)) {
            patrol(mover, t, hill, ai.squad, world.time, ai.rallyOffsetX * 0.4, ai.rallyOffsetZ * 0.4);
            continue;
          }
          if (!orders.rally && outpost && holdsOutposts(ai.squad, armies.outpostHold) && !ctx.sides.underAttack(faction)) {
            if (ours) patrol(mover, t, outpost, ai.squad, world.time, ai.rallyOffsetX * 0.4, ai.rallyOffsetZ * 0.4);
            else {
              const p = patrolPoint(outpost, ai.squad, world.time);
              moveTo(mover, t, p.x + ai.rallyOffsetX * 0.4, p.z + ai.rallyOffsetZ * 0.4, outpost.x, outpost.z);
            }
            continue;
          }
          const rally = orders.rally ?? defend ?? (target >= 0 ? ctx.lanes.rally(faction, target, ai.lane) : home);
          const facing = defend?.face ?? (target >= 0 ? ctx.field.baseSites[target] : { x: 0, z: 0 });
          // Infantry squads man the trenches their engineers dug near the rally point (see commander/engineers.ts).
          if (def?.class === 'infantry' && !orders.rally && !defend) {
            const trenches = ctx.commander.engineers.trenchesNear(faction, rally.x, rally.z, TRENCH_MUSTER);
            const place = trenches.length > 0 ? trenchPlace(manned, trenches, ai.squad, e) : null;
            if (place) {
              const { x, z } = place;
              // Right into the trench, not just near it.
              const there = D.hypot(x - t.x, z - t.z) < 0.5;
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

        // King of the hill: attacks are for the hill. Into its ring to take it, or round it to hold it.
        const hill = naval || orders.rally ? null : hillOf(ctx);
        if (hill) {
          const p = patrolPoint(hill, ai.squad, world.time);
          if (ctx.sides.allied(hill.owner, faction)) {
            patrol(mover, t, hill, ai.squad, world.time, ai.rallyOffsetX * 0.4, ai.rallyOffsetZ * 0.4);
          } else {
            mover.targetX = hill.x + (p.x - hill.x) * 0.5 + ai.rallyOffsetX * 0.3;
            mover.targetZ = hill.z + (p.z - hill.z) * 0.5 + ai.rallyOffsetZ * 0.3;
            mover.faceX = hill.x;
            mover.faceZ = hill.z;
          }
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

/** How close a plane gets to its target before it pulls through, and how far past it it flies before coming round. */
const RUN_CLOSE = 3;
const RUN_EXTEND = 10;

/**
 * A plane's attack run (see UnitDef.fixedWing): straight at the target,
 * guns or bombs on it as it lines up, on over it and out the other side,
 * then round for another pass. The turn is the plane's own (see cruise in movement.ts).
 */
function attackRun(ai: Ai, mover: Mover, t: Transform, tt: Transform, time: number): void {
  if (ai.runUntil !== undefined && time < ai.runUntil) {
    mover.targetX = ai.runX!;
    mover.targetZ = ai.runZ!;
    return;
  }
  if (D.hypot(tt.x - t.x, tt.z - t.z) < RUN_CLOSE) {
    ai.runX = t.x + D.cos(t.heading) * RUN_EXTEND;
    ai.runZ = t.z - D.sin(t.heading) * RUN_EXTEND;
    ai.runUntil = time + RUN_EXTEND / Math.max(1, mover.speed);
    mover.targetX = ai.runX;
    mover.targetZ = ai.runZ;
    return;
  }
  mover.targetX = tt.x;
  mover.targetZ = tt.z;
}

/** Seconds an aircraft sits on its airpad being loaded, and how near the pad counts as on it. */
const REARM_TIME = 5;
const PAD_REACH = 3;

/**
 * Back to the nearest of its side's (finished) airpads or forward helipads to rearm, or to its
 * base if it has none. Helicopters set down on the pad; planes, which can't,
 * circle low over it. Once loaded it goes back to the fight.
 */
function rearm(world: World, ctx: SimContext, e: Entity, ammo: Ammo, mover: Mover, t: Transform, faction: number): void {
  let pad: { x: number; z: number } | null = null;
  let best = Infinity;
  for (const b of world.query(Building, Transform, Faction)) {
    if (!world.req(b, Building).def.rearms || world.has(b, Construction) || world.req(b, Faction).id !== faction) continue;
    const bt = world.req(b, Transform);
    const d = D.hypot(bt.x - t.x, bt.z - t.z);
    if (d < best) {
      best = d;
      pad = { x: bt.x, z: bt.z };
    }
  }
  pad ??= ctx.field.baseSites[faction] ?? { x: t.x, z: t.z };
  const g = world.get(e, GroundFollow);
  const there = D.hypot(pad.x - t.x, pad.z - t.z) < (mover.cruise ? PAD_REACH * 4 : PAD_REACH);
  mover.targetX = there ? null : pad.x;
  mover.targetZ = there ? null : pad.z;
  mover.faceX = pad.x;
  mover.faceZ = pad.z;
  if (mover.cruise) {
    mover.loiterX = pad.x;
    mover.loiterZ = pad.z;
  }
  if (g) g.landing = there;
  if (!there) return;
  ammo.readyAt ??= world.time + REARM_TIME;
  if (world.time < ammo.readyAt) return;
  ammo.left = ammo.max;
  ammo.rearming = false;
  ammo.readyAt = null;
  if (g) g.landing = false;
}

/** The closest enemy unit (not building) within `range`, if any; with `ground`, not counting aircraft. */
function nearestEnemyUnit(world: World, ctx: SimContext, e: Entity, faction: number, range: number, ground = false): Entity | null {
  if (range <= 0) return null;
  const t = world.req(e, Transform);
  let best: Entity | null = null;
  let bestD2 = range * range;
  ctx.grid.forEachNear(t.x, t.z, range, (other, d2) => {
    if (d2 >= bestD2 || world.get(other, Targetable)?.kind !== 'unit') return;
    if (!ctx.sides.hostile(faction, world.req(other, Faction).id)) return;
    if (ground) {
      const m = world.get(other, Mover);
      if (m && MOVE_RULES[m.move].flies) return;
    }
    best = other;
    bestD2 = d2;
  });
  return best;
}

/** Whether a unit leads the fighting (frontline role, and not an outpost's guard). */
function isFrontline(world: World, e: Entity): boolean {
  return world.get(e, Unit)?.def.role === 'frontline' && !world.has(e, Guard);
}

/**
 * The closest allied frontline unit within ESCORT_RANGE, if any. `alone`:
 * the closest one no other unit of `e`'s kind is following (UnitDef.escorts),
 * or failing that the closest one anyway.
 */
function nearestFrontline(world: World, ctx: SimContext, e: Entity, faction: number, alone = false): Entity | null {
  const t = world.req(e, Transform);
  let taken: Set<Entity> | null = null;
  if (alone) {
    const kind = world.req(e, Unit).def.id;
    const seen = new Set<Entity>();
    ctx.grid.forEachNear(t.x, t.z, ESCORT_RANGE * 2, (other) => {
      if (other === e || world.get(other, Unit)?.def.id !== kind) return;
      const lead = world.get(other, Ai)?.escort;
      if (lead !== null && lead !== undefined) seen.add(lead);
    });
    taken = seen;
  }
  let best: Entity | null = null;
  let fallback: Entity | null = null;
  let bestD2 = ESCORT_RANGE * ESCORT_RANGE;
  let fallbackD2 = bestD2;
  // Only a lead it can keep up with. A spider or a wading walker crosses a channel (or scales a
  // cliff) a truck can't, and would draw it to the water's edge to pile up there with the rest of
  // its kind: one that can go where this can't is only followed while it's well clear of any such ground.
  const move = world.get(e, Mover)?.move;
  const grid = move && !MOVE_RULES[move].flies ? ctx.navs.for(move) : null;
  ctx.grid.forEachNear(t.x, t.z, ESCORT_RANGE, (other, d2) => {
    if (other === e || d2 >= ESCORT_RANGE * ESCORT_RANGE || !isFrontline(world, other)) return;
    if (!ctx.sides.allied(faction, world.req(other, Faction).id)) return;
    if (grid && move) {
      const lead = world.get(other, Mover)?.move;
      if (lead && outreaches(lead, move)) {
        const ot = world.req(other, Transform);
        if (!grid.connected(t, ot) || !clearAround(grid, ot.x, ot.z, ESCORT_CLEAR)) return;
      }
    }
    if (taken?.has(other)) {
      if (d2 < fallbackD2) {
        fallback = other;
        fallbackD2 = d2;
      }
      return;
    }
    if (d2 < bestD2) {
      best = other;
      bestD2 = d2;
    }
  });
  return best ?? fallback;
}

/** Whether a mover of class `a` can go anywhere one of class `b` can't: deeper water, up cliffs, or into the air. */
function outreaches(a: MoveClass, b: MoveClass): boolean {
  const ra = MOVE_RULES[a];
  const rb = MOVE_RULES[b];
  return (ra.flies && !rb.flies) || ra.maxDepth > rb.maxDepth || (ra.scales && !rb.scales);
}

/** Whether a class can be at a point and everywhere round it out to `room` (8 points on the circle). */
function clearAround(grid: NavGrid, x: number, z: number, room: number): boolean {
  if (!grid.terrainAllowsAt(x, z)) return false;
  for (let a = 0; a < 8; a++) if (!grid.terrainAllowsAt(x + D.cos((a / 8) * Math.PI * 2) * room, z + D.sin((a / 8) * Math.PI * 2) * room)) return false;
  return true;
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

/** Seconds ahead round the circle a patrolling unit steers for, so its goal stays well ahead of it. */
const PATROL_LEAD = 8;
/** How far ahead that is, round the circle. */
const PATROL_AHEAD = 2 * PATROL_RADIUS * D.sin((PATROL_SPEED * PATROL_LEAD) / 2);
/** The patrol's own walking pace (its place's speed round the circle). */
const PATROL_WALK = PATROL_SPEED * PATROL_RADIUS;
/** Slowest a patroller walks while it's ahead of its place: still fast enough not to count as stuck. */
const PATROL_SLOWEST = 0.75;

/**
 * Walk an outpost's (or the hill's) perimeter, facing outward when stopped.
 * Steering for the squad's place on the circle a little ahead (not where
 * it is now), at the patrol's own pace (a little faster when it has fallen
 * behind, slower when it's ahead), keeps a unit walking smoothly round,
 * where going to its place now made it hurry there, stop, wait for the
 * place to move on, and go again. Units far from their place (on their way
 * to it, or after a fight) catch up at up to full speed.
 */
function patrol(mover: Mover, t: Transform, o: Outpost, squad: number, time: number, offX: number, offZ: number): void {
  const ahead = patrolPoint(o, squad, time + PATROL_LEAD);
  mover.targetX = ahead.x + offX;
  mover.targetZ = ahead.z + offZ;
  mover.faceX = ahead.x * 2 - o.x;
  mover.faceZ = ahead.z * 2 - o.z;
  const toGoal = D.hypot(mover.targetX - t.x, mover.targetZ - t.z);
  // Behind its place (farther from the goal than the lead), it speeds up in proportion; ahead, it slows.
  const want = PATROL_WALK * Math.max(PATROL_SLOWEST, toGoal / PATROL_AHEAD);
  if (mover.speed > 0 && want < mover.speed) mover.pace = want / mover.speed;
}

/** Head for a spot and face a point; stop when close so units settle rather than jostle. */
/**
 * A soldier's own place in one of the trenches near its rally point: each
 * trench holds two ranks, a soldier apart, and each soldier keeps to the
 * same place while it's free (picked by entity), so a squad files in along
 * the trench instead of crowding one spot. Null when they're all full.
 */
function trenchPlace(manned: Map<Earthwork, Uint8Array>, trenches: Earthwork[], squad: number, e: Entity): { x: number; z: number } | null {
  for (let n = 0; n < trenches.length; n++) {
    const w = trenches[(squad + n) % trenches.length];
    const len = D.hypot(w.bx - w.ax, w.bz - w.az);
    const perRank = Math.max(1, Math.floor(len / TRENCH_ROOM));
    const places = perRank * 2;
    let taken = manned.get(w);
    if (!taken) manned.set(w, (taken = new Uint8Array(places)));
    for (let p = 0; p < places; p++) {
      const k = (e * 7 + p) % places;
      if (taken[k]) continue;
      taken[k] = 1;
      const along = ((k % perRank) + 0.5) / perRank;
      const rank = k < perRank ? -TRENCH_RANK : TRENCH_RANK;
      const ux = (w.bx - w.ax) / Math.max(1e-6, len);
      const uz = (w.bz - w.az) / Math.max(1e-6, len);
      return { x: w.ax + (w.bx - w.ax) * along - uz * rank, z: w.az + (w.bz - w.az) * along + ux * rank };
    }
  }
  return null;
}

function moveTo(mover: Mover, t: Transform, x: number, z: number, faceX: number, faceZ: number): void {
  mover.faceX = faceX;
  mover.faceZ = faceZ;
  const close = D.hypot(x - t.x, z - t.z) < 2.5;
  mover.targetX = close ? null : x;
  mover.targetZ = close ? null : z;
}
