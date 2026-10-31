import { System } from '../../core/ecs';
import { Battlefield } from '../../world/battlefield';
import { GroundFollow, Mover, Transform } from '../components';

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Turn toward the target, then drive forward. Arrival clears the target. */
export function movementSystem(): System {
  return {
    name: 'movement',
    update(world, dt) {
      for (const e of world.query(Transform, Mover)) {
        const t = world.req(e, Transform);
        const m = world.req(e, Mover);
        if (m.targetX === null || m.targetZ === null) continue;
        const dx = m.targetX - t.x;
        const dz = m.targetZ - t.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.3) {
          m.targetX = m.targetZ = null;
          continue;
        }
        const desired = Math.atan2(-dz, dx);
        const diff = wrapAngle(desired - t.heading);
        const maxTurn = m.turnRate * dt;
        t.heading = wrapAngle(t.heading + Math.max(-maxTurn, Math.min(maxTurn, diff)));
        // Slow down while facing away so units arc rather than strafe.
        const throttle = Math.max(0, Math.cos(diff));
        const stepLen = Math.min(dist, m.speed * throttle * dt);
        t.x += Math.cos(t.heading) * stepLen;
        t.z -= Math.sin(t.heading) * stepLen;
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
