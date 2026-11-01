import { System } from '../../core/ecs';
import { Faction, Producer } from '../components';
import { SimContext } from '../context';

/** Seconds between checks; losing a building doesn't need to register on the exact tick. */
const CHECK_INTERVAL = 0.5;

/**
 * Conquest rules: a side is knocked out once its last production building
 * (the HQ counts) is destroyed, and the battle is over when every side still
 * standing is on one team. The winners are that whole team, including allies
 * knocked out along the way. Records the outcome once; the battle keeps
 * running afterwards so the survivors can mop up while the result is shown.
 */
export function conquestSystem(ctx: SimContext): System {
  let nextCheck = 0;
  return {
    name: 'conquest',
    update(world) {
      if (ctx.settings.mode !== 'conquest' || ctx.outcome || world.time < nextCheck) return;
      nextCheck = world.time + CHECK_INTERVAL;
      const { sides } = ctx;
      const producers = new Array<number>(sides.count).fill(0);
      for (const e of world.query(Producer, Faction)) {
        const f = world.req(e, Faction).id;
        if (f >= 0) producers[f]++;
      }
      for (let f = 0; f < sides.count; f++) {
        if (sides.eliminated[f] || producers[f] > 0) continue;
        sides.eliminate(f, world.time);
        ctx.events.emit('sideEliminated', { faction: f, time: world.time });
      }
      const standing = sides.standing();
      const teams = new Set(standing.map((f) => sides.teams[f]));
      if (teams.size > 1) return;
      const team = standing.length > 0 ? sides.teams[standing[0]] : null;
      ctx.outcome = {
        team,
        winners: team === null ? [] : sides.teams.flatMap((t, f) => (t === team ? [f] : [])),
        time: world.time,
      };
      ctx.events.emit('battleOver', ctx.outcome);
    },
  };
}
