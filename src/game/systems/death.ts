import { System } from '../../core/ecs';
import { Ai, Armed, Collider, Faction, GroundFollow, Health, Mover, Transform, Unit, Wreck } from '../components';
import { SimContext } from '../context';

/** Seconds a wreck spends sinking into the ground before it's removed. */
const SINK_TIME = 3;

/** Turns units at 0 hp into wrecks (or removes them), and announces it. */
export function deathSystem(ctx: SimContext): System {
  return {
    name: 'death',
    update(world) {
      for (const e of world.query(Unit, Health)) {
        if (world.req(e, Health).hp > 0) continue;
        const t = world.req(e, Transform);
        const def = world.req(e, Unit).def;
        ctx.events.emit('unitDestroyed', { entity: e, x: t.x, y: t.y, z: t.z, def, faction: world.req(e, Faction).id });
        if (def.wreckTime <= 0) {
          world.destroy(e);
          continue;
        }
        for (const c of [Unit, Health, Armed, Ai, Mover, Collider]) world.remove(e, c);
        world.add(e, Wreck, { removeAt: world.time + def.wreckTime });
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
