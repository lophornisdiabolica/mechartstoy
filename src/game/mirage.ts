import { Armed, Building, Construction, Decoy, Faction, Guard, Transform, Unit } from './components';
import { Entity, System, World } from '../core/ecs';
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
 *
 * A projector only projects in a fight: a truck or the Fata Morgana when it
 * can see an enemy, and the mirror array (back at base) beside one of
 * Mirage's units that's shooting at something. The holograms go up a few
 * metres out in front, between the projector and the enemy, so they're the
 * first thing the enemy sees.
 */

/** How far out in front, towards the enemy, holograms go up. */
const AHEAD = 7;
/** How long a fighting unit counts as fighting after its last shot, for the mirror array. */
const FIGHTING = 4;

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
        const at = world.has(e, Unit) ? inSight(world, ctx, e, faction) : beside(world, ctx, faction);
        if (!at) {
          timers.set(e, 0);
          continue;
        }
        timers.set(e, projects.every * ctx.rng.range(0.9, 1.1));
        const { x, z } = world.req(at.from, Transform);
        const f = world.req(at.foe, Transform);
        const d = D.hypot(f.x - x, f.z - z) || 1;
        const ahead = Math.min(AHEAD, d * 0.5);
        const ux = (f.x - x) / d;
        const uz = (f.z - z) / d;
        const squad = newSquad(ctx);
        for (let i = 0; i < projects.count; i++) {
          const id = projects.units[i % projects.units.length] as UnitId;
          const def = ctx.units[id];
          // Spread across the line to the enemy, a little ragged.
          const side = (i - (projects.count - 1) / 2) * 2.6 + ctx.rng.range(-0.6, 0.6);
          const fwd = ahead + ctx.rng.range(-1, 1);
          const spot = spawnSpot(ctx, x + ux * fwd - uz * side, z + uz * fwd + ux * side, def.radius, def.move);
          if (!spot) continue;
          const holo = spawnUnit(world, ctx, def, faction, spot.x, spot.z, squad);
          world.add(holo, Decoy, { until: world.time + (def.decoy?.lasts ?? 20) * ctx.rng.range(0.85, 1.15) });
          ctx.events.emit('fizzle', { x: spot.x, y: world.req(holo, Transform).y, z: spot.z, radius: def.radius });
        }
      }
    },
  };
}

/** The nearest enemy unit a projecting unit can see, if any. */
function inSight(world: World, ctx: SimContext, e: Entity, faction: number): { from: Entity; foe: Entity } | null {
  const t = world.req(e, Transform);
  const sight = world.req(e, Unit).def.sight;
  let best: Entity | null = null;
  let bestD = Infinity;
  ctx.grid.forEachNear(t.x, t.z, sight, (o) => {
    const f = world.get(o, Faction);
    if (!f || !world.has(o, Unit) || world.has(o, Decoy) || !ctx.sides.hostile(faction, f.id)) return;
    const ot = world.req(o, Transform);
    const d = D.hypot(ot.x - t.x, ot.z - t.z);
    if (d <= sight && d < bestD) {
      bestD = d;
      best = o;
    }
  });
  return best === null ? null : { from: e, foe: best };
}

/** One of `faction`'s real units that's fighting just now, and what it's shooting at (for the mirror array). */
function beside(world: World, ctx: SimContext, faction: number): { from: Entity; foe: Entity } | null {
  const fighting: { from: Entity; foe: Entity }[] = [];
  for (const u of world.query(Unit, Armed, Faction)) {
    if (world.req(u, Faction).id !== faction || world.has(u, Decoy)) continue;
    const arm = world.req(u, Armed);
    if (arm.target === null || !world.isAlive(arm.target) || world.time - arm.firedAt > FIGHTING) continue;
    if (!world.has(arm.target, Unit)) continue;
    fighting.push({ from: u, foe: arm.target });
  }
  return fighting.length ? fighting[ctx.rng.int(0, fighting.length - 1)] : null;
}
