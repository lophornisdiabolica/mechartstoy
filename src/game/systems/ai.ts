import { System } from '../../core/ecs';
import { Ai, Armed, Faction, Mover, Transform } from '../components';
import { SimContext } from '../context';
import { enemyObjective } from '../spawn';
import { isAttacking } from '../tide';
import { distanceToTarget } from './targeting';

/**
 * Unit movement decisions. With a target: close to weapon range and hold.
 * Without: on the offensive, push into the enemy base; otherwise, mass at
 * the rally point in front of our own base until the next attack.
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
          if (distanceToTarget(world, e, armed.target) > armed.weapon.range * 0.85) {
            const tt = world.req(armed.target, Transform);
            mover.targetX = tt.x;
            mover.targetZ = tt.z;
          } else {
            mover.targetX = mover.targetZ = null;
          }
          continue;
        }

        if (!isAttacking(world.time, faction)) {
          // Hold near the rally point; small tolerance so units settle rather than jostle.
          const near = Math.hypot(ai.rallyX - t.x, ai.rallyZ - t.z) < 2.5;
          mover.targetX = near ? null : ai.rallyX;
          mover.targetZ = near ? null : ai.rallyZ;
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
      }
    },
  };
}
