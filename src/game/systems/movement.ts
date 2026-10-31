import { System } from '../../core/ecs';
import { Battlefield } from '../../world/battlefield';
import { Building, Collider, Faction, GroundFollow, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Rotate `from` toward `to` by at most `maxStep` radians. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const diff = wrapAngle(to - from);
  return wrapAngle(from + Math.max(-maxStep, Math.min(maxStep, diff)));
}

/** Detour angles tried, in order, when the straight path runs into water. */
const DETOURS = [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5];

/**
 * Turn toward the target, then drive forward. Ground units steer around
 * water by trying progressively wider detours. Arrival clears the target.
 * (Proper pathfinding can replace the detour probe later without touching AI.)
 */
export function movementSystem(field: Battlefield): System {
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

        let desired = Math.atan2(-dz, dx);
        if (!m.canCrossWater) {
          const probe = Math.min(dist, 3);
          for (const detour of DETOURS) {
            const a = desired + detour;
            if (!field.isWater(t.x + Math.cos(a) * probe, t.z - Math.sin(a) * probe)) {
              desired = a;
              break;
            }
          }
        }

        const diff = wrapAngle(desired - t.heading);
        t.heading = turnToward(t.heading, desired, m.turnRate * dt);
        // Slow down while facing away so units arc rather than strafe.
        const throttle = Math.max(0, Math.cos(diff));
        const stepLen = Math.min(dist, m.speed * throttle * dt);
        const nx = t.x + Math.cos(t.heading) * stepLen;
        const nz = t.z - Math.sin(t.heading) * stepLen;
        if (m.canCrossWater || !field.isWater(nx, nz)) {
          t.x = nx;
          t.z = nz;
        }
      }
    },
  };
}

/** Pushes overlapping units apart, and out of buildings, so they don't stack up. */
export function separationSystem(ctx: SimContext): System {
  return {
    name: 'separation',
    update(world) {
      for (const e of world.query(Unit, Transform, Collider)) {
        const t = world.req(e, Transform);
        const r = world.req(e, Collider).radius;
        const myFaction = world.req(e, Faction).id;
        ctx.grid.forEachNear(t.x, t.z, r + 4, (other, d2) => {
          if (other === e || d2 < 1e-6) return;
          const ot = world.req(other, Transform);
          const minDist = r + world.req(other, Collider).radius;
          const d = Math.sqrt(d2);
          if (d >= minDist) return;
          // Buildings don't budge, so the unit takes the whole overlap. Between units each
          // moves part of it; enemies push a little harder so lines hold.
          const share = world.has(other, Building) ? 1 : world.req(other, Faction).id === myFaction ? 0.25 : 0.35;
          const push = ((minDist - d) / d) * share;
          const nx = t.x + (t.x - ot.x) * push;
          const nz = t.z + (t.z - ot.z) * push;
          if (!ctx.field.isWater(nx, nz)) {
            t.x = nx;
            t.z = nz;
          }
        });
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
