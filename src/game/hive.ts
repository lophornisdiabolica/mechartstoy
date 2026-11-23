import { Entity, System, World } from '../core/ecs';
import { Building, Construction, Faction, Guard, Transform, Unit } from './components';
import { SimContext } from './context';
import { canBuild, capCost, countByCategory } from './caps';
import { newSquad, spawnUnit } from './spawn';
import { spawnSpot } from './systems/production';
import { recordSquad } from './territory';
import { UnitId } from './units';
import { MOVE_RULES } from '../world/moveClasses';
import * as D from '../core/dmath';

/*
 * Hive: a swarm grown from wreckage.
 *
 * Fabricators (UnitDef.eats, and the Recycler building and the Hive Mother)
 * chew the wreckage round them, the visible junk heaps first and then the
 * salvage buried under old battlefields (see WreckageField.salvage), and
 * turn what they've eaten into mites and gun mites that crawl out beside
 * them, right at the front. So a long, bloody fight feeds the Hive, and a
 * side that kills its fabricators starves it. The brakes are the wreck
 * supply and the mites' own cap (they're infantry, a fraction of a slot
 * each); mites last until they're killed.
 */

/** Seconds between bites. */
const TICK = 0.5;

/** Per fabricator: salvage eaten and not yet turned into anything, and which batch is next. */
interface Gut {
  store: number;
  next: number;
}

/** The fabricators at work: chewing, and making mites. */
export function hiveSystem(ctx: SimContext): System {
  const guts = new Map<Entity, Gut>();
  let acc = 0;
  return {
    name: 'hive',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const spell = acc;
      acc = 0;
      let counts: ReturnType<typeof countByCategory> | null = null;
      for (const e of guts.keys()) if (!world.isAlive(e) || (!world.has(e, Unit) && !world.has(e, Building))) guts.delete(e);
      for (const e of world.query(Transform, Faction)) {
        const eats = world.get(e, Unit)?.def.eats ?? world.get(e, Building)?.def.eats;
        if (!eats || world.has(e, Construction) || world.has(e, Guard)) continue;
        const faction = world.req(e, Faction).id;
        if (faction < 0) continue;
        const t = world.req(e, Transform);
        let gut = guts.get(e);
        if (!gut) guts.set(e, (gut = { store: 0, next: 0 }));
        const batch = eats.makes[gut.next % eats.makes.length];
        // Full up: it waits until there's room for what it makes next before it chews more.
        if (gut.store < batch.cost * 2) {
          const bite = ctx.wreckage.salvage(t.x, t.z, eats.radius, eats.rate * spell);
          if (bite > 0) {
            gut.store += bite;
            ctx.events.emit('chewed', { x: t.x, y: t.y, z: t.z, faction });
          }
        }
        if (gut.store < batch.cost) continue;
        counts ??= countByCategory(world, ctx.sides.count);
        const def = ctx.units[batch.unit as UnitId];
        if (!canBuild(ctx, counts, faction, def)) continue;
        gut.store -= batch.cost;
        gut.next++;
        hatch(world, ctx, e, t, faction, batch.unit as UnitId, batch.count, counts);
      }
    },
  };
}

/** A batch crawling out beside its maker, as a squad of their own. */
function hatch(world: World, ctx: SimContext, from: Entity, t: Transform, faction: number, unit: UnitId, count: number, counts: ReturnType<typeof countByCategory>): void {
  const def = ctx.units[unit];
  const r = (world.get(from, Unit)?.def.radius ?? world.get(from, Building)?.def.radius ?? 1) + 0.8;
  const squad = newSquad(ctx);
  const lineUp: UnitId[] = [];
  for (let i = 0; i < count; i++) {
    const a = ctx.rng.range(0, Math.PI * 2);
    const x = t.x + D.cos(a) * r;
    const z = t.z + D.sin(a) * r;
    const spot = MOVE_RULES[def.move].flies ? (ctx.field.contains(x, z, 1) ? { x, z } : null) : spawnSpot(ctx, x, z, def.radius, def.move);
    if (!spot) continue;
    spawnUnit(world, ctx, def, faction, spot.x, spot.z, squad);
    counts[faction][def.category] += capCost(def);
    lineUp.push(unit);
  }
  if (lineUp.length === 0) return;
  recordSquad(ctx, squad, faction, lineUp);
  ctx.events.emit('squadDropped', { carrier: from, x: t.x, y: t.y, z: t.z, count: lineUp.length });
}
