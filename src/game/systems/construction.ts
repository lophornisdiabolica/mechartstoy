import { System } from '../../core/ecs';
import { Construction, Faction, Health, NEUTRAL, Rubble, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { spawnBuilding } from '../spawn';

/** Seconds to wait before checking again when enemies are standing on a rubble site. */
const BLOCKED_RETRY = 5;

/**
 * Keeps the destruction cycle going: rubble becomes a construction site once
 * the area is clear of hostile units, and sites rise until complete. In
 * Conquest mode nothing is rebuilt, so ruins stay ruins.
 */
export function constructionSystem(ctx: SimContext): System {
  return {
    name: 'construction',
    update(world, dt) {
      const rebuild = ctx.settings.mode === 'eternal';
      for (const e of world.query(Rubble, Transform)) {
        if (!rebuild) break;
        const rubble = world.req(e, Rubble);
        if (world.time < rubble.rebuildAt) continue;
        const t = world.req(e, Transform);
        let blocked = false;
        ctx.grid.forEachNear(t.x, t.z, rubble.def.radius + 10, (other) => {
          if (!world.has(other, Unit)) return;
          const f = world.req(other, Faction).id;
          // Civilians won't rebuild under anyone's guns; factions only mind enemies.
          if (rubble.faction === NEUTRAL || ctx.sides.hostile(f, rubble.faction)) blocked = true;
        });
        if (blocked) {
          rubble.rebuildAt = world.time + BLOCKED_RETRY;
          continue;
        }
        world.destroy(e);
        spawnBuilding(world, ctx, rubble.def, rubble.faction, t.x, t.z, rubble.heading, true);
      }

      for (const e of world.query(Construction, Health)) {
        const c = world.req(e, Construction);
        const h = world.req(e, Health);
        c.elapsed += dt;
        // Health fills in as the structure goes up (from the 30% it starts at).
        h.hp = Math.min(h.max, h.hp + ((h.max * 0.7) / c.duration) * dt);
        if (c.elapsed >= c.duration) world.remove(e, Construction);
      }
    },
  };
}
