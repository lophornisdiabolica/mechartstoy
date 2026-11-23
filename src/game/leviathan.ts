import { Entity, System, World } from '../core/ecs';
import { Armed, Collider, Faction, Health, Renderable, Transform, Unit } from './components';
import { SimContext } from './context';

/*
 * Leviathan: one giant creature and its cult.
 *
 * The Leviathan (UnitDef.grows) eats the wrecks round it as it goes, and
 * grows with what it eats: bigger, tougher (more health, its wounds
 * stretched with it), longer in the reach and harder in the bite, up to
 * `most` times the size it hatched at. It hatches small, so the early
 * fight is the cult's.
 */

/** Seconds between bites. */
const TICK = 0.5;

/** The Leviathan feeding and growing. */
export function leviathanSystem(ctx: SimContext): System {
  let acc = 0;
  const hatched = new Set<number>();
  return {
    name: 'leviathan',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const spell = acc;
      acc = 0;
      for (const e of hatched) if (!world.isAlive(e) || !world.has(e, Unit)) hatched.delete(e);
      for (const e of world.query(Unit, Renderable, Transform, Faction)) {
        const def = world.req(e, Unit).def;
        const grows = def.grows;
        if (!grows) continue;
        const r = world.req(e, Renderable);
        // It hatches small.
        if (!hatched.has(e)) {
          hatched.add(e);
          size(world, e, grows.from);
        }
        if (r.scale >= grows.most) continue;
        const t = world.req(e, Transform);
        const bite = ctx.wreckage.take(t.x, t.z, grows.radius * r.scale, grows.rate * spell);
        if (bite <= 0) continue;
        ctx.events.emit('chewed', { x: t.x, y: t.y, z: t.z, faction: world.req(e, Faction).id });
        const scale = Math.min(grows.most, r.scale + bite * grows.perWreck);
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
  const armed = world.get(e, Armed);
  if (armed && was !== scale) {
    armed.weapon = { ...def.weapon, damage: def.weapon.damage * scale, range: def.weapon.range * scale, muzzleHeight: def.weapon.muzzleHeight * scale };
  }
}
