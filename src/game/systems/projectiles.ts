import { Entity, System, World } from '../../core/ecs';
import { Faction, Health, Projectile, Transform, Unit } from '../components';
import { SimContext } from '../context';

export function applyDamage(world: World, e: Entity, amount: number): void {
  const h = world.get(e, Health);
  const def = world.get(e, Unit)?.def;
  if (!h || !def) return;
  h.hp -= amount * (1 - def.armor);
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
        // Direct hit on the intended target if it's still where the shot landed.
        if (p.target !== null && world.has(p.target, Unit)) {
          const tt = world.req(p.target, Transform);
          const r = world.req(p.target, Unit).def.radius + 0.4;
          if ((tt.x - p.ex) ** 2 + (tt.z - p.ez) ** 2 <= r * r) {
            applyDamage(world, p.target, w.damage);
            hit.add(p.target);
          }
        }
        if (w.splash > 0) {
          ctx.grid.forEachNear(p.ex, p.ez, w.splash, (other, d2) => {
            if (hit.has(other) || !world.has(other, Unit)) return;
            if (world.req(other, Faction).id === p.faction) return;
            applyDamage(world, other, w.damage * (1 - 0.6 * (Math.sqrt(d2) / w.splash)));
          });
        }
        ctx.events.emit('impact', { x: p.ex, y: p.ey, z: p.ez, kind: p.kind, splash: w.splash });
        world.destroy(e);
      }
    },
  };
}
