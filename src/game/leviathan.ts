import { Entity, System, World } from '../core/ecs';
import { Armed, Arsenal, Collider, Faction, Health, Renderable, Transform, Unit } from './components';
import { WeaponDef } from './units';
import { SimContext } from './context';

/*
 * Leviathan: one giant creature and its cult.
 *
 * The Leviathan (UnitDef.grows) eats the wrecks round it as it goes, and
 * grows with what it eats: bigger, tougher (more health, its wounds
 * stretched with it), longer in the reach and harder in the bite, up to
 * `most` times the size it hatched at. It hatches small, so the early
 * fight is the cult's, and it can only grow so fast (`perMinute`), however
 * much it eats, so it has to live a while to grow big. Beaten, it falls
 * back to its shrine to mend (UnitDef.retreats, see retreat.ts).
 */

/** Seconds between bites. */
const TICK = 0.5;

/** The Leviathan feeding and growing. */
export function leviathanSystem(ctx: SimContext): System {
  let acc = 0;
  /** When each hatched. */
  const hatched = new Map<number, number>();
  return {
    name: 'leviathan',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const spell = acc;
      acc = 0;
      for (const e of hatched.keys()) if (!world.isAlive(e) || !world.has(e, Unit)) hatched.delete(e);
      for (const e of world.query(Unit, Renderable, Transform, Faction)) {
        const def = world.req(e, Unit).def;
        const grows = def.grows;
        if (!grows) continue;
        const r = world.req(e, Renderable);
        // It hatches small.
        if (!hatched.has(e)) {
          hatched.set(e, world.time);
          size(world, e, grows.from);
        }
        // As big as it's allowed to be yet.
        const most = Math.min(grows.most, grows.from + (grows.perMinute * (world.time - hatched.get(e)!)) / 60);
        if (r.scale >= most) continue;
        const t = world.req(e, Transform);
        const bite = ctx.wreckage.take(t.x, t.z, grows.radius * r.scale, grows.rate * spell);
        if (bite <= 0) continue;
        ctx.events.emit('chewed', { x: t.x, y: t.y, z: t.z, faction: world.req(e, Faction).id });
        const scale = Math.min(most, r.scale + bite * grows.perWreck);
        size(world, e, scale);
      }
    },
  };
}

/** Set a growing creature's size: its model, footprint, health and bite all scale with it. */
export function size(world: World, e: Entity, scale: number): void {
  const def = world.req(e, Unit).def;
  const r = world.req(e, Renderable);
  const was = r.scale;
  world.req(e, Renderable).scale = scale;
  const c = world.get(e, Collider);
  if (c) c.radius = def.radius * scale;
  const h = world.get(e, Health);
  if (h) {
    const share = h.hp / h.max;
    h.max = def.hp * scale * scale;
    h.hp = share * h.max;
  }
  if (was === scale) return;
  const armed = world.get(e, Armed);
  if (armed) armed.weapon = grown(def.weapon, scale);
  const arms = world.get(e, Arsenal)?.arms;
  if (arms && def.mounts) arms.forEach((a, i) => (a.weapon = grown(def.mounts![i].weapon, scale)));
}

/** A weapon grown with its creature: harder hitting, and the short-reach ones (bite, breath, spines) longer in the reach. */
function grown(w: WeaponDef, scale: number): WeaponDef {
  return { ...w, damage: w.damage * scale, range: w.range < 10 ? w.range * scale : w.range, muzzleHeight: w.muzzleHeight * scale };
}
