import { System } from '../../core/ecs';
import { Rng } from '../../core/rng';
import { Battlefield } from '../../world/battlefield';
import { Mover, Transform, Wander } from '../components';

/** Step-1 placeholder behaviour: drift between random dry-land points. */
export function wanderSystem(field: Battlefield, rng: Rng): System {
  return {
    name: 'wander',
    update(world) {
      for (const e of world.query(Transform, Mover, Wander)) {
        const m = world.req(e, Mover);
        const w = world.req(e, Wander);
        if (m.targetX !== null && world.time < w.nextPickAt) continue;
        const t = world.req(e, Transform);
        for (let tries = 0; tries < 8; tries++) {
          const x = field.clampX(t.x + rng.range(-18, 18), 2);
          const z = field.clampZ(t.z + rng.range(-18, 18), 2);
          if (field.isWater(x, z)) continue;
          m.targetX = x;
          m.targetZ = z;
          break;
        }
        w.nextPickAt = world.time + rng.range(4, 10);
      }
    },
  };
}
