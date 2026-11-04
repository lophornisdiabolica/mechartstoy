import { Entity, System } from '../../core/ecs';
import { Building, Collider, Faction, Mover, Targetable, Transform } from '../components';
import { Body, SimContext } from '../context';

/** Rebuilds the grid of everything shootable so later systems can do neighbour queries. */
export function spatialIndexSystem(ctx: SimContext): System {
  const bodies = new Map<Entity, Body>();
  let listening = false;
  return {
    name: 'spatialIndex',
    update(world) {
      if (!listening) {
        world.onDestroy((e) => bodies.delete(e));
        listening = true;
      }
      ctx.grid.clear();
      for (const e of world.query(Targetable, Transform)) {
        let body = bodies.get(e);
        if (!body) {
          body = { t: world.req(e, Transform), collider: world.get(e, Collider), faction: world.get(e, Faction), mover: world.get(e, Mover), building: world.get(e, Building) };
          bodies.set(e, body);
        }
        ctx.grid.insert(e, body.t.x, body.t.z, body);
      }
    },
  };
}
