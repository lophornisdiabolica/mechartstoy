import { System } from '../../core/ecs';
import {
  Ai,
  Armed,
  Building,
  Collider,
  Faction,
  GroundFollow,
  Health,
  makeTransform,
  Mover,
  Renderable,
  Rubble,
  Targetable,
  Transform,
  Unit,
  Wreck,
} from '../components';
import { SimContext } from '../context';

/** Seconds a wreck spends sinking into the ground before it's removed. */
const SINK_TIME = 3;

/**
 * Handles anything at 0 hp. Units become wrecks (or vanish); buildings are
 * replaced by a rubble entity that the rebuild system later turns back into
 * a construction site.
 */
export function deathSystem(ctx: SimContext): System {
  return {
    name: 'death',
    update(world) {
      for (const e of world.query(Health, Transform)) {
        if (world.req(e, Health).hp > 0) continue;
        const t = world.req(e, Transform);
        const faction = world.req(e, Faction).id;
        const killer = world.req(e, Health).lastHit;

        const unit = world.get(e, Unit);
        if (unit) {
          ctx.events.emit('unitDestroyed', { entity: e, x: t.x, y: t.y, z: t.z, def: unit.def, faction, killer });
          if (unit.def.wreckTime <= 0) {
            world.destroy(e);
            continue;
          }
          for (const c of [Unit, Health, Armed, Ai, Mover, Collider, Targetable]) world.remove(e, c);
          world.add(e, Wreck, { removeAt: world.time + unit.def.wreckTime });
          continue;
        }

        const building = world.get(e, Building);
        if (building) {
          const def = building.def;
          ctx.events.emit('buildingDestroyed', { entity: e, x: t.x, y: t.y, z: t.z, def, faction, killer });
          world.destroy(e);
          const r = world.create();
          world.add(r, Transform, makeTransform(t.x, t.y, t.z, t.heading));
          world.add(r, Renderable, { model: 'rubble', scale: def.radius });
          world.add(r, Rubble, { def, faction, heading: t.heading, rebuildAt: world.time + def.rebuildDelay });
        }
      }
    },
  };
}

export function wreckSystem(): System {
  return {
    name: 'wrecks',
    update(world, dt) {
      for (const e of world.query(Wreck)) {
        const wreck = world.req(e, Wreck);
        if (world.time >= wreck.removeAt) {
          world.destroy(e);
        } else if (world.time >= wreck.removeAt - SINK_TIME) {
          const g = world.get(e, GroundFollow);
          if (g) g.offset -= dt * 0.7;
        }
      }
    },
  };
}
