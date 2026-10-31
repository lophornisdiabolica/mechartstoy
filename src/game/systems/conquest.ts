import { System } from '../../core/ecs';
import { Faction, Producer } from '../components';
import { SimContext } from '../context';

/** Seconds between checks; losing a building doesn't need to register on the exact tick. */
const CHECK_INTERVAL = 0.5;

/**
 * Conquest rules: a side is beaten once its last production building (the HQ
 * counts) is destroyed. Records the outcome once; the battle keeps running
 * afterwards so the survivors can mop up while the result is shown.
 */
export function conquestSystem(ctx: SimContext): System {
  let nextCheck = 0;
  return {
    name: 'conquest',
    update(world) {
      if (ctx.settings.mode !== 'conquest' || ctx.outcome || world.time < nextCheck) return;
      nextCheck = world.time + CHECK_INTERVAL;
      const standing = [0, 0];
      for (const e of world.query(Producer, Faction)) {
        const f = world.req(e, Faction).id;
        if (f >= 0) standing[f]++;
      }
      const alive = standing.map((n) => n > 0);
      if (alive[0] && alive[1]) return;
      ctx.outcome = { winner: alive[0] ? 0 : alive[1] ? 1 : null, time: world.time };
      ctx.events.emit('battleOver', ctx.outcome);
    },
  };
}
