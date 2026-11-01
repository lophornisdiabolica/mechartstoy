import { System } from '../../core/ecs';
import { Ai, Armed, Faction, Mover, Transform } from '../components';
import { SimContext } from '../context';
import { enemyObjective } from '../spawn';
import { attackNumber, isAttacking } from '../tide';
import { distanceToTarget } from './targeting';

/**
 * Unit movement decisions. With a target: close to weapon range and hold.
 * Without: on the offensive, march down the squad's lane (centre or a
 * flank, see lanes.ts) and into the enemy base; otherwise, mass at the
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
        const slot = faction ^ ctx.tideOrder;
        // Each attack, the squad gets its lane for that attack (and the build-up before it).
        const attack = attackNumber(world.time, slot, armies);
        if (ai.laneAttack !== attack) {
          ai.lane = ctx.lanes.laneFor(faction, attack, ai.squad, armies.flanking);
          ai.laneAttack = attack;
        }

        const attacking = orders.stance === 'attack' || (orders.stance === 'auto' && isAttacking(world.time, slot, armies));
        if (!attacking) {
          // Form up at the player's flag, or in front of the base leaning toward this squad's lane.
          const rally = orders.rally ?? ctx.lanes.rally(faction, ai.lane);
          let rx = rally.x + ai.rallyOffsetX;
          let rz = rally.z + ai.rallyOffsetZ;
          if (ctx.field.isWater(rx, rz)) {
            rx = rally.x;
            rz = rally.z;
          }
          // Hold near the rally point facing the enemy; small tolerance so units settle rather than jostle.
          const enemy = ctx.field.baseSites.find((s) => s.faction !== faction)!;
          mover.faceX = enemy.x;
          mover.faceZ = enemy.z;
          const near = Math.hypot(rx - t.x, rz - t.z) < 2.5;
          mover.targetX = near ? null : rx;
          mover.targetZ = near ? null : rz;
          continue;
        }

        // March down the lane, then into the enemy base.
        const waypoint = ctx.lanes.nextWaypoint(faction, ai.lane, t.x);
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
          const next = enemyObjective(ctx, faction);
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
