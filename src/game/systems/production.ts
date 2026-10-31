import { System, World } from '../../core/ecs';
import { Building, Construction, Faction, Producer, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { spawnUnit } from '../spawn';
import { tide } from '../tide';

/**
 * The nearest spot to (x, z) with room for a unit of this radius, searching a
 * few rings outward. Keeps big units from rolling out wedged between buildings.
 */
export function spawnSpot(ctx: SimContext, x: number, z: number, radius: number): { x: number; z: number } | null {
  const ok = (px: number, pz: number) => ctx.field.contains(px, pz, 1) && ctx.nav.fitsAt(px, pz, radius);
  if (ok(x, z)) return { x, z };
  for (let ring = 1; ring <= 4; ring++) {
    const d = ring * 1.5;
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * d;
      const pz = z + Math.sin((a / 8) * Math.PI * 2) * d;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  // Nowhere roomy: anywhere dry will do.
  return !ctx.field.isWater(x, z) && ctx.field.contains(x, z, 1) ? { x, z } : null;
}

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
        const def = ctx.units[entry.unit];
        for (let n = 0; n < entry.count; n++) {
          const spot = spawnSpot(ctx, doorX + ctx.rng.range(-1.2, 1.2), doorZ + ctx.rng.range(-1.2, 1.2), def.radius);
          if (spot) {
            spawnUnit(world, ctx, def, faction, spot.x, spot.z);
            alive[faction]++;
          }
        }
      }
    },
  };
}
