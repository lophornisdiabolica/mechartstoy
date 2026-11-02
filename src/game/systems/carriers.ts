import { System } from '../../core/ecs';
import { Ai, Armed, Carrier, Faction, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { canBuild, countByCategory } from '../caps';
import { newSquad, spawnUnit } from '../spawn';
import { recordSquad } from '../territory';
import { UnitId } from '../units';
import { spawnSpot } from './production';
import { MOVE_RULES } from '../../world/moveClasses';

/** A loaded carrier drops its squad once an enemy it's after is this close. */
export const DROP_RANGE = 16;
/** ...or once it's this close to the point it's pushing for. */
const DROP_AT_OBJECTIVE = 10;
/** Seconds between checks. */
const TICK = 0.5;

/**
 * Carriers (UnitDef.carries) bring a squad with them and drop it off at the
 * fight: when an enemy they're after is within DROP_RANGE, or they reach
 * their objective. The soldiers pile out beside the carrier and fight as a
 * normal squad (and can be refilled in territory like one). A carrier that
 * turns out squads of its own (`every` > 0, the Siege Crawler) is loaded
 * again that many seconds later. Dropped soldiers count against the
 * infantry cap; a carrier with no room keeps its squad aboard.
 */
export function carrierSystem(ctx: SimContext): System {
  let acc = 0;
  return {
    name: 'carriers',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      acc = 0;
      let counts: ReturnType<typeof countByCategory> | null = null;
      for (const e of world.query(Carrier, Unit, Transform, Faction)) {
        const c = world.req(e, Carrier);
        const carries = world.req(e, Unit).def.carries!;
        if (!c.loaded) {
          if (carries.every > 0 && world.time >= c.reloadAt) c.loaded = true;
          continue;
        }
        const t = world.req(e, Transform);
        const armed = world.get(e, Armed);
        let drop = false;
        if (armed?.target != null && world.has(armed.target, Transform)) {
          const tt = world.req(armed.target, Transform);
          drop = (tt.x - t.x) ** 2 + (tt.z - t.z) ** 2 <= DROP_RANGE ** 2;
        }
        const ai = world.get(e, Ai);
        if (!drop && ai && ai.target >= 0) drop = (ai.objectiveX - t.x) ** 2 + (ai.objectiveZ - t.z) ** 2 <= DROP_AT_OBJECTIVE ** 2;
        if (!drop) continue;

        const faction = world.req(e, Faction).id;
        counts ??= countByCategory(world, ctx.sides.count);
        const lineUp = carries.squad.flatMap((m) => new Array<UnitId>(m.count).fill(m.unit as UnitId));
        const squad = newSquad(ctx);
        let dropped = 0;
        // Out of the back, spread a little either side.
        const back = t.heading + Math.PI;
        for (const id of lineUp) {
          const def = ctx.units[id];
          if (!canBuild(ctx, counts, faction, def)) break;
          const side = ctx.rng.range(-1.2, 1.2);
          const r = world.req(e, Unit).def.radius + 0.8;
          const x = t.x + Math.cos(back) * r - Math.sin(back) * side;
          const z = t.z - Math.sin(back) * r - Math.cos(back) * side;
          // Aircraft (drones off an airship) take off from where they are; soldiers need ground with room.
          const spot = MOVE_RULES[def.move].flies ? (ctx.field.contains(x, z, 1) ? { x, z } : null) : spawnSpot(ctx, x, z, def.radius);
          if (!spot) continue;
          spawnUnit(world, ctx, def, faction, spot.x, spot.z, squad);
          counts[faction][def.category]++;
          dropped++;
        }
        if (dropped === 0) continue;
        recordSquad(ctx, squad, faction, lineUp);
        ctx.events.emit('squadDropped', { carrier: e, x: t.x, y: t.y, z: t.z, count: dropped });
        c.loaded = false;
        c.reloadAt = world.time + carries.every;
      }
    },
  };
}
