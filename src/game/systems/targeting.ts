import { Entity, System, World } from '../../core/ecs';
import { Armed, Collider, Construction, Faction, Targetable, Transform } from '../components';
import { SimContext } from '../context';

const RETARGET_INTERVAL = 0.5;
/** Buildings count as this much further away, so units shoot units first. Siege units invert it. */
const BUILDING_PENALTY = 8;

function findTarget(world: World, ctx: SimContext, e: Entity, armed: Armed): Entity | null {
  const t = world.req(e, Transform);
  const faction = world.req(e, Faction).id;
  let best: Entity | null = null;
  let bestScore = Infinity;
  ctx.grid.forEachNear(t.x, t.z, armed.sight, (other, d2) => {
    const otherFaction = world.req(other, Faction).id;
    // Only enemies; nobody aims at the civilian town (it only suffers stray fire).
    if (!ctx.sides.hostile(faction, otherFaction)) return;
    const d = Math.sqrt(d2);
    if (d < armed.weapon.minRange) return;
    const isBuilding = world.req(other, Targetable).kind === 'building';
    const score = d + (isBuilding ? (armed.siege ? -BUILDING_PENALTY * 3 : BUILDING_PENALTY) : 0);
    if (score < bestScore) {
      bestScore = score;
      best = other;
    }
  });
  return best;
}

/** Every armed entity (units and towers) picks the best enemy in sight. */
export function targetingSystem(ctx: SimContext): System {
  return {
    name: 'targeting',
    update(world) {
      for (const e of world.query(Armed, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const armed = world.req(e, Armed);
        // A dead target triggers an immediate re-think; otherwise re-think on a timer.
        if (armed.target !== null && !world.has(armed.target, Targetable)) {
          armed.target = null;
          armed.nextTargetAt = world.time;
        }
        if (world.time < armed.nextTargetAt) continue;
        armed.nextTargetAt = world.time + RETARGET_INTERVAL;
        armed.target = findTarget(world, ctx, e, armed);
      }
    },
  };
}

/** Edge-to-edge distance from an entity to its target, so big buildings count as in range sooner. */
export function distanceToTarget(world: World, e: Entity, target: Entity): number {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const r = world.get(target, Collider)?.radius ?? 0;
  return Math.max(0, Math.hypot(tt.x - t.x, tt.z - t.z) - r);
}
