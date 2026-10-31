import { System } from '../../core/ecs';
import { Transform } from '../components';

/** Runs first each tick: remember last positions for render interpolation. */
export const snapshotSystem: System = {
  name: 'snapshot',
  update(world) {
    for (const e of world.query(Transform)) {
      const t = world.req(e, Transform);
      t.px = t.x;
      t.py = t.y;
      t.pz = t.z;
      t.pheading = t.heading;
    }
  },
};
