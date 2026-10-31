import { System } from '../../core/ecs';
import { Ai, Armed, Faction, Mover, Transform } from '../components';
import { SimContext } from '../context';
import { enemyObjective } from '../spawn';
import { isAttacking } from '../tide';
import { distanceToTarget } from './targeting';

/**
 * Unit movement decisions. With a target: close to weapon range and hold.
 * Without: on the offensive, push into the enemy base; otherwise, mass at
 * the rally point until the next attack. The faction's orders can force the
 * stance and move the rally point.
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
        const attacking = orders.stance === 'attack' || (orders.stance === 'auto' && isAttacking(world.time, faction));
        if (!attacking) {
          const custom = orders.rally;
          let rx = custom ? custom.x + ai.rallyOffsetX : ai.rallyX;
          let rz = custom ? custom.z + ai.rallyOffsetZ : ai.rallyZ;
          if (custom && ctx.field.isWater(rx, rz)) {
            rx = custom.x;
            rz = custom.z;
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
