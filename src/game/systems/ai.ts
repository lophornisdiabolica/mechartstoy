import { Entity, System, World } from '../../core/ecs';
import { Ai, Armed, Faction, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';

const THINK_INTERVAL = 0.5;

function findTarget(world: World, ctx: SimContext, e: Entity): Entity | null {
  const t = world.req(e, Transform);
  const faction = world.req(e, Faction).id;
  const def = world.req(e, Unit).def;
  let best: Entity | null = null;
  let bestScore = Infinity;
  ctx.grid.forEachNear(t.x, t.z, def.sight, (other, d2) => {
    if (world.req(other, Faction).id === faction) return;
    if (d2 < def.weapon.minRange ** 2) return;
    if (d2 < bestScore) {
      bestScore = d2;
      best = other;
    }
  });
  return best;
}

/**
 * Per-unit battlefield brain. Picks the nearest enemy in sight; closes to
 * weapon range and holds; otherwise advances on the enemy base.
 */
export function aiSystem(ctx: SimContext): System {
  return {
    name: 'ai',
    update(world) {
      for (const e of world.query(Ai, Armed, Mover, Transform, Unit)) {
        const ai = world.req(e, Ai);
        const armed = world.req(e, Armed);
        const mover = world.req(e, Mover);
        const t = world.req(e, Transform);

        // A dead target triggers an immediate re-think; otherwise re-think on a timer.
        if (armed.target !== null && !world.has(armed.target, Unit)) {
          armed.target = null;
          ai.nextThinkAt = world.time;
        }
        if (world.time >= ai.nextThinkAt) {
          ai.nextThinkAt = world.time + THINK_INTERVAL;
          armed.target = findTarget(world, ctx, e);
        }

        if (armed.target !== null) {
          const tt = world.req(armed.target, Transform);
          const d = Math.hypot(tt.x - t.x, tt.z - t.z);
          if (d > armed.weapon.range * 0.85) {
            mover.targetX = tt.x;
            mover.targetZ = tt.z;
          } else {
            mover.targetX = mover.targetZ = null;
          }
          continue;
        }

        const d = Math.hypot(ai.objectiveX - t.x, ai.objectiveZ - t.z);
        if (d < 3) {
          // Reached the objective: mill about inside the enemy base.
          const base = ctx.field.baseSites.find((s) => s.faction !== world.req(e, Faction).id)!;
          ai.objectiveX = base.x + ctx.rng.range(-0.7, 0.7) * base.radius;
          ai.objectiveZ = base.z + ctx.rng.range(-0.7, 0.7) * base.radius;
        }
        mover.targetX = ai.objectiveX;
        mover.targetZ = ai.objectiveZ;
      }
    },
  };
}
