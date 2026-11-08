import { Entity, System, World } from '../../core/ecs';
import { Building, Collider, Faction, Health, Hit, Projectile, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { entityHeight, inTrench, UNIT_HIT_SLACK } from '../lineOfFire';
import * as D from '../../core/dmath';

/** The least share of a hit that gets through armour, however thick: small arms still chip away, slowly. */
export const MIN_DAMAGE_SHARE = 0.1;

/** Share of a burst outside the trench that reaches soldiers in it. */
const TRENCH_SPLASH = 0.5;

/** Damage a hit of `amount` does through `armor`: the armour (less the share `pierce` goes through) is taken off, down to MIN_DAMAGE_SHARE of the hit. */
export function damageThrough(amount: number, armor: number, pierce = 0): number {
  return Math.max(amount * MIN_DAMAGE_SHARE, amount - armor * (1 - pierce));
}

export function applyDamage(world: World, ctx: SimContext, e: Entity, amount: number, by: Hit | null = null, pierce = 0): void {
  const h = world.get(e, Health);
  if (!h) return;
  const before = h.hp;
  const building = world.get(e, Building);
  // As a battle escalates, sieges bite harder so a won field turns into a won battle.
  if (building) amount *= 1 + ctx.escalation.siege;
  const through = damageThrough(amount, h.armor, pierce);
  h.hp -= through;
  h.hurtAt = world.time;
  if (before > 0) {
    const unit = world.get(e, Unit);
    ctx.events.emit('damaged', {
      victim: unit ? unit.def.id : building ? building.def.id : 'unknown',
      category: unit ? unit.def.category : 'building',
      faction: world.get(e, Faction)?.id ?? -1,
      amount: Math.min(through, before),
      by,
    });
  }
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
        t.heading = D.atan2(-(p.ez - p.sz), p.ex - p.sx);
        if (k < 1) continue;

        const hit = new Set<Entity>();
        const w = p.weapon;
        const by: Hit = { source: p.source, faction: p.faction };
        // Direct hit on what the shot was heading for, if it's still where the shot landed. Shots that
        // end on an allied building (direct fire it was in the way of) just spark off it.
        if (p.target !== null && world.has(p.target, Targetable)) {
          const tt = world.req(p.target, Transform);
          // Direct fire stops at the edge of what it hits, so it gets a little more room.
          const r = world.req(p.target, Collider).radius + (w.arc ? 0.4 : UNIT_HIT_SLACK + 0.5);
          const friendly = ctx.sides.allied(world.req(p.target, Faction).id, p.faction);
          if (!friendly && D.sq(tt.x - p.ex) + D.sq(tt.z - p.ez) <= r * r) {
            applyDamage(world, ctx, p.target, w.damage, by, w.pierce ?? 0);
            hit.add(p.target);
          }
        }
        // Splash hurts anything not on the shooter's team, including the civilian town. It reaches
        // as far up and down as it does sideways, so a shell bursting on the ground doesn't touch
        // aircraft overhead, and flak bursting round an aircraft doesn't touch the ground below.
        if (w.splash > 0) {
          ctx.grid.forEachNear(p.ex, p.ez, w.splash + 3, (other, d2) => {
            if (hit.has(other) || !world.has(other, Targetable)) return;
            if (ctx.sides.allied(world.req(other, Faction).id, p.faction)) return;
            const ot = world.req(other, Transform);
            const top = ot.y + entityHeight(world, other);
            const dy = p.ey < ot.y ? ot.y - p.ey : p.ey > top ? p.ey - top : 0;
            const edge = D.hypot(Math.max(0, Math.sqrt(d2) - world.req(other, Collider).radius), dy);
            if (edge > w.splash) return;
            // Soldiers down in a trench take half a burst outside it (one that lands in the trench gets them all).
            const cover = inTrench(world, ctx, other) && ctx.field.groundAt(p.ex, p.ez).id !== 'trench' ? TRENCH_SPLASH : 1;
            applyDamage(world, ctx, other, w.damage * (1 - 0.6 * (edge / w.splash)) * cover, by);
          });
        }
        // Trees in a dense forest take the hit too, whether the shot ran into one or burst among them.
        ctx.field.woods.damage(p.ex, p.ez, p.ey, Math.max(w.splash, 0.6), w.damage, { x: p.sx, z: p.sz });
        ctx.events.emit('impact', { x: p.ex, y: p.ey, z: p.ez, kind: p.kind, splash: w.splash });
        world.destroy(e);
      }
    },
  };
}
