import { Entity, System, World } from '../../core/ecs';
import { Building, Collider, Faction, Health, Hit, Projectile, Targetable, Transform } from '../components';
import { SimContext } from '../context';

export function applyDamage(world: World, ctx: SimContext, e: Entity, amount: number, by: Hit | null = null): void {
  const h = world.get(e, Health);
  if (!h) return;
  const before = h.hp;
  const building = world.get(e, Building);
  // As a battle escalates, sieges bite harder so a won field turns into a won battle.
  if (building) amount *= 1 + ctx.escalation;
  h.hp -= amount * (1 - h.armor);
  // Only the blow that lands while it's still standing counts.
  if (by && before > 0) h.lastHit = by;
  if (building && before > h.max / 2 && h.hp <= h.max / 2 && h.hp > 0) {
    const t = world.req(e, Transform);
    ctx.events.emit('buildingDamaged', { entity: e, x: t.x, y: t.y, z: t.z, def: building.def });
  }
}

/** Flies projectiles along their fixed path and applies damage on arrival. */
export function projectileSystem(ctx: SimContext): System {
  return {
    name: 'projectiles',
    update(world, dt) {
      for (const e of world.query(Projectile, Transform)) {
        const p = world.req(e, Projectile);
        const t = world.req(e, Transform);
        p.elapsed += dt;
        const k = Math.min(1, p.elapsed / p.duration);
        t.x = p.sx + (p.ex - p.sx) * k;
        t.z = p.sz + (p.ez - p.sz) * k;
        t.y = p.sy + (p.ey - p.sy) * k + p.arcHeight * 4 * k * (1 - k);
        t.heading = Math.atan2(-(p.ez - p.sz), p.ex - p.sx);
        if (k < 1) continue;

        const hit = new Set<Entity>();
        const w = p.weapon;
        const by: Hit = { source: p.source, faction: p.faction };
        // Direct hit on the intended target if it's still where the shot landed.
        if (p.target !== null && world.has(p.target, Targetable)) {
          const tt = world.req(p.target, Transform);
          const r = world.req(p.target, Collider).radius + 0.4;
          if ((tt.x - p.ex) ** 2 + (tt.z - p.ez) ** 2 <= r * r) {
            applyDamage(world, ctx, p.target, w.damage, by);
            hit.add(p.target);
          }
        }
        // Splash hurts anything not on the shooter's side, including the civilian town.
        if (w.splash > 0) {
          ctx.grid.forEachNear(p.ex, p.ez, w.splash + 3, (other, d2) => {
            if (hit.has(other) || !world.has(other, Targetable)) return;
            if (world.req(other, Faction).id === p.faction) return;
            const edge = Math.max(0, Math.sqrt(d2) - world.req(other, Collider).radius);
            if (edge > w.splash) return;
            applyDamage(world, ctx, other, w.damage * (1 - 0.6 * (edge / w.splash)), by);
          });
        }
        ctx.events.emit('impact', { x: p.ex, y: p.ey, z: p.ez, kind: p.kind, splash: w.splash });
        world.destroy(e);
      }
    },
  };
}
