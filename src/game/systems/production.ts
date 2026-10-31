import { System, World } from '../../core/ecs';
import { Building, Construction, Faction, Producer, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { spawnUnit } from '../spawn';
import { tide } from '../tide';

/** Units alive per faction (index 0 and 1). */
export function countUnits(world: World): number[] {
  const alive = [0, 0];
  for (const e of world.query(Unit, Faction)) {
    const f = world.req(e, Faction).id;
    if (f >= 0) alive[f]++;
  }
  return alive;
}

/**
 * Production buildings turn out units on their own timers. Two things scale
 * the rate: the tide (see tide.ts), and (in Eternal mode) a mild rubber band
 * that helps a badly outnumbered side recover. The settings' production multiplier and unit cap
 * apply on top.
 */
export function productionSystem(ctx: SimContext): System {
  return {
    name: 'production',
    update(world, dt) {
      const alive = countUnits(world);
      const { armies } = ctx.settings;
      for (const e of world.query(Producer, Building, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const faction = world.req(e, Faction).id;
        const producer = world.req(e, Producer);
        // Ratio > 1 means this side is outnumbered.
        const ratio = (alive[1 - faction] + 6) / (alive[faction] + 6);
        // Conquest needs a winner, so it skips the rubber band and lets an advantage snowball.
        const band = ctx.settings.mode === 'conquest' ? 1 : Math.min(1.8, Math.max(0.75, ratio));
        producer.timer -= dt * armies.production * band * tide(world.time, faction ^ ctx.tideOrder, armies);
        if (producer.timer > 0) continue;
        producer.timer = producer.interval * ctx.rng.range(0.9, 1.1);
        if (alive[faction] >= armies.unitCap) continue;

        const total = producer.table.reduce((s, p) => s + p.weight, 0);
        let roll = ctx.rng.range(0, total);
        const entry = producer.table.find((p) => (roll -= p.weight) <= 0) ?? producer.table[0];

        // Units roll out of the front door.
        const t = world.req(e, Transform);
        const r = world.req(e, Building).def.radius + 1.2;
        const doorX = t.x + Math.cos(t.heading) * r;
        const doorZ = t.z - Math.sin(t.heading) * r;
        for (let n = 0; n < entry.count; n++) {
          const x = doorX + ctx.rng.range(-1.2, 1.2);
          const z = doorZ + ctx.rng.range(-1.2, 1.2);
          if (!ctx.field.isWater(x, z) && ctx.field.contains(x, z, 1)) {
            spawnUnit(world, ctx, ctx.units[entry.unit], faction, x, z);
            alive[faction]++;
          }
        }
      }
    },
  };
}
