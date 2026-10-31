import { System } from '../../core/ecs';
import { Targetable, Transform } from '../components';
import { SimContext } from '../context';

/** Rebuilds the grid of everything shootable so later systems can do neighbour queries. */
export function spatialIndexSystem(ctx: SimContext): System {
  return {
    name: 'spatialIndex',
    update(world) {
      ctx.grid.clear();
      for (const e of world.query(Targetable, Transform)) {
        const t = world.req(e, Transform);
        ctx.grid.insert(e, t.x, t.z);
      }
    },
  };
}
