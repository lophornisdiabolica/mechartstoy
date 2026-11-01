import { System } from '../../core/ecs';
import { Ai, Armed, Faction, Mover, Transform } from '../components';
import { SimContext } from '../context';
import { objectiveIn } from '../spawn';
import { attackNumber, isAttacking } from '../tide';
import { distanceToTarget } from './targeting';

/**
 * Unit movement decisions. With a target: close to weapon range and hold.
 * Without: on the offensive, march down the squad's lane (centre or a
 * flank, see lanes.ts) toward the enemy side its team is attacking this
 * time (see Sides.target) and into that base; otherwise, mass at the
 * lane's rally point until the next attack. The faction's orders can force
 * the stance and move the rally point.
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

        if (armed.target !== null && world.isAlive(armed.target)) {
          const tt = world.req(armed.target, Transform);
          // Square up to whatever we're fighting.
          mover.faceX = tt.x;
          mover.faceZ = tt.z;
          if (distanceToTarget(world, e, armed.target) > armed.weapon.range * 0.85) {
            mover.targetX = tt.x;
            mover.targetZ = tt.z;
          } else {
            mover.targetX = mover.targetZ = null;
          }
          continue;
        }

        const orders = ctx.orders[faction];
        const { armies } = ctx.settings;
        const phase = ctx.sides.phase[faction];
        // Each attack, the squad gets its target and lane for that attack (and the build-up before it).
        const attack = attackNumber(world.time, phase, ctx.tide);
        const target = ctx.sides.target(faction, attack) ?? -1;
        if (ai.laneAttack !== attack || ai.target !== target) {
          ai.lane = ctx.lanes.laneFor(faction, attack, ai.squad, armies.flanking);
          ai.laneAttack = attack;
          ai.target = target;
          if (target >= 0) {
            const objective = objectiveIn(ctx, target);
            ai.objectiveX = objective.x;
            ai.objectiveZ = objective.z;
          }
        }

        // On auto, an attack is called off while the side's own base can't hold (Sides.recalling).
        const auto = orders.stance === 'auto' && !ctx.sides.recalling[faction] && isAttacking(world.time, phase, ctx.tide);
        const attacking = target >= 0 && (orders.stance === 'attack' || auto);
        if (!attacking) {
          // Form up at the player's flag; else meet an attack on the base (or an ally's);
          // else in front of the base, leaning toward this squad's lane.
          const home = ctx.field.baseSites[faction];
          const defend = orders.rally ? null : ctx.sides.defencePoint(faction);
          const rally = orders.rally ?? defend ?? (target >= 0 ? ctx.lanes.rally(faction, target, ai.lane) : home);
          let rx = rally.x + ai.rallyOffsetX;
          let rz = rally.z + ai.rallyOffsetZ;
          if (ctx.field.isWater(rx, rz)) {
            rx = rally.x;
            rz = rally.z;
          }
          // Hold near the rally point facing the next enemy; small tolerance so units settle rather than jostle.
          const facing = defend?.face ?? (target >= 0 ? ctx.field.baseSites[target] : { x: 0, z: 0 });
          mover.faceX = facing.x;
          mover.faceZ = facing.z;
          const near = Math.hypot(rx - t.x, rz - t.z) < 2.5;
          mover.targetX = near ? null : rx;
          mover.targetZ = near ? null : rz;
          continue;
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
