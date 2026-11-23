import { System } from '../core/ecs';
import { Building, Construction, Decoy, Faction, Guard, Transform, Unit } from './components';
import { SimContext } from './context';
import { newSquad, spawnUnit } from './spawn';
import { spawnSpot } from './systems/production';
import { UnitId } from './units';
import * as D from '../core/dmath';

/*
 * Mirage: holograms.
 *
 * Projectors (UnitDef.projects and BuildingDef.projects: the projector
 * truck, the mirror array, the Fata Morgana) throw up hologram copies of
 * Mirage's units now and then (UnitDef.decoy). A hologram moves and fights
 * like the real thing and its shots fly, but they do no harm. It draws the
 * enemy's fire until it's shot apart or its time runs out, and then it
 * fizzles away, leaving no wreck. Holograms cost no cap.
 */

/** Seconds between checks. */
const TICK = 0.5;

/** Projectors throwing up holograms, and holograms fizzling out when their time's up. */
export function mirageSystem(ctx: SimContext): System {
  let acc = 0;
  const timers = new Map<number, number>();
  return {
    name: 'mirage',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const spell = acc;
      acc = 0;
      for (const e of world.query(Decoy, Transform)) {
        if (world.time < world.req(e, Decoy).until) continue;
        const t = world.req(e, Transform);
        ctx.events.emit('fizzle', { x: t.x, y: t.y, z: t.z, radius: world.get(e, Unit)?.def.radius ?? 1 });
        world.destroy(e);
      }
      for (const k of timers.keys()) if (!world.isAlive(k)) timers.delete(k);
      for (const e of world.query(Transform, Faction)) {
        const projects = world.get(e, Unit)?.def.projects ?? world.get(e, Building)?.def.projects;
        if (!projects || world.has(e, Construction) || world.has(e, Guard) || world.has(e, Decoy)) continue;
        const faction = world.req(e, Faction).id;
        if (faction < 0) continue;
        const left = (timers.get(e) ?? projects.every * ctx.rng.range(0.3, 1)) - spell;
        if (left > 0) {
          timers.set(e, left);
          continue;
        }
        timers.set(e, projects.every * ctx.rng.range(0.9, 1.1));
        const t = world.req(e, Transform);
        const r = (world.get(e, Unit)?.def.radius ?? world.get(e, Building)?.def.radius ?? 1) + 2;
        const squad = newSquad(ctx);
        for (let i = 0; i < projects.count; i++) {
          const id = projects.units[i % projects.units.length] as UnitId;
          const def = ctx.units[id];
          const a = ctx.rng.range(0, Math.PI * 2);
          const spot = spawnSpot(ctx, t.x + D.cos(a) * r, t.z + D.sin(a) * r, def.radius, def.move);
          if (!spot) continue;
          const holo = spawnUnit(world, ctx, def, faction, spot.x, spot.z, squad);
          world.add(holo, Decoy, { until: world.time + (def.decoy?.lasts ?? 20) * ctx.rng.range(0.85, 1.15) });
          ctx.events.emit('fizzle', { x: spot.x, y: world.req(holo, Transform).y, z: spot.z, radius: def.radius });
        }
      }
    },
  };
}
