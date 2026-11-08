import { Entity, System, World } from '../../core/ecs';
import { Armed, Building, Collider, Construction, Faction, makeTransform, Mover, Projectile, Renderable, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { turnToward, wrapAngle } from './movement';
import { aimPoint, clearShot, muzzlePoint, traceShot } from '../lineOfFire';
import { distanceToTarget, effectiveRange, volleyWeapon } from './targeting';
import { Health } from '../components';
import type { WeaponDef } from '../units';
import { MOVE_RULES } from '../../world/moveClasses';
import * as D from '../../core/dmath';

/** How closely the weapon must point at the target before firing, radians. */
const AIM_TOLERANCE = 0.12;

/** How far past its target a direct-fire shot that misses carries on, as a multiple of the weapon's range. */
const OVERSHOOT = 1.3;
/** A shot that would only just scrape past a building (most of a burst would hit it) counts as blocked. */
const FIRE_ROOM = 0.5;

function fire(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity, w: WeaponDef = armed.weapon): void {
  const tt = world.req(target, Transform);
  const faction = world.req(e, Faction).id;
  const muzzle = muzzlePoint(world, e, armed.aim, armed.muzzleOffset, w.muzzleHeight, ctx);
  const { x: sx, y: sy, z: sz } = muzzle;

  const targetRadius = world.get(target, Collider)?.radius ?? 0.5;
  const dist = D.hypot(tt.x - sx, tt.z - sz);
  // Miss distance grows with range; sqrt keeps the scatter evenly spread over the disc.
  const missR = w.spread * dist * Math.sqrt(ctx.rng.next());
  const missA = ctx.rng.range(0, Math.PI * 2);
  let ex = tt.x + D.cos(missA) * missR;
  let ez = tt.z + D.sin(missA) * missR;
  let ey: number;
  let struck: Entity | null = target;
  if (w.arc || w.projectile === 'flame') {
    // Lobbed, or flame (which licks round corners a little): lands at the impact point, on the ground or at an aircraft's height.
    const tm = world.get(target, Mover);
    ey = (tm && MOVE_RULES[tm.move].flies ? tt.y : ctx.field.surfaceAt(ex, ez)) + Math.min(1.5, targetRadius * 0.6);
  } else {
    // Direct fire: aimed at the body, and stopped by the first thing in the way (see lineOfFire.ts).
    const aim = aimPoint(world, target);
    const trace = traceShot(world, ctx, muzzle, { x: ex, y: aim.y, z: ez }, w.range * OVERSHOOT, e, faction, target);
    ex = trace.x;
    ey = trace.y;
    ez = trace.z;
    struck = trace.hit;
  }
  const flight = D.hypot(ex - sx, ez - sz);
  // Bombs dropped from aircraft just fall; everything else lobbed goes up and over.
  const shooterMover = world.get(e, Mover);
  const dropped = shooterMover !== undefined && MOVE_RULES[shooterMover.move].flies;

  const p = world.create();
  world.add(p, Transform, makeTransform(sx, sy, sz, armed.aim));
  world.add(p, Renderable, { model: `projectile:${w.projectile}`, scale: 1 });
  world.add(p, Projectile, {
    kind: w.projectile,
    weapon: w,
    faction,
    source: world.get(e, Unit)?.def.id ?? world.get(e, Building)?.def.id ?? 'unknown',
    target: struck,
    sx,
    sy,
    sz,
    ex,
    ey,
    ez,
    arcHeight: w.arc && !dropped ? Math.max(2, dist * 0.35) : w.projectile === 'flame' ? 0.4 : 0,
    elapsed: 0,
    duration: Math.max(0.05, flight / w.speed),
  });
  ctx.events.emit('fired', { entity: e, x: sx, y: sy, z: sz, heading: armed.aim, kind: w.projectile });
}

/** Aims turrets (or hulls), manages cooldowns and bursts, and launches projectiles. */
export function weaponSystem(ctx: SimContext): System {
  return {
    name: 'weapons',
    update(world, dt) {
      for (const e of world.query(Armed, Transform)) {
        if (world.has(e, Construction)) continue;
        const armed = world.req(e, Armed);
        const t = world.req(e, Transform);
        armed.cooldown -= dt;

        const target = armed.target !== null && world.has(armed.target, Targetable) ? armed.target : null;
        if (target === null) {
          armed.burstLeft = 0;
          // Turrets drift back to face forward when idle.
          armed.aim = armed.turret ? turnToward(armed.aim, t.heading, armed.turnRate * dt) : t.heading;
          continue;
        }

        const tt = world.req(target, Transform);
        const desired = D.atan2(-(tt.z - t.z), tt.x - t.x);
        if (armed.turret) {
          armed.aim = turnToward(armed.aim, desired, armed.turnRate * dt);
        } else {
          // Turret-less units turn the whole body once they've stopped to shoot.
          const mover = world.get(e, Mover);
          if (!mover || mover.targetX === null) t.heading = turnToward(t.heading, desired, armed.turnRate * dt);
          armed.aim = t.heading;
        }

        if (armed.burstLeft > 0) {
          armed.burstTimer -= dt;
          if (armed.burstTimer <= 0) {
            fire(world, ctx, e, armed, target);
            armed.burstLeft--;
            armed.burstTimer = armed.weapon.burstGap;
          }
          continue;
        }

        const d = distanceToTarget(world, e, target);
        const inRange = d <= effectiveRange(world, e, armed, target) && d >= armed.weapon.minRange;
        const aligned = Math.abs(wrapAngle(desired - armed.aim)) < AIM_TOLERANCE;
        if (armed.cooldown <= 0 && inRange && aligned) {
          // Direct fire holds while a building or the ground is in the way; the AI looks for a better spot.
          if (!armed.weapon.arc && armed.weapon.projectile !== 'flame') {
            const muzzle = muzzlePoint(world, e, armed.aim, armed.muzzleOffset, armed.weapon.muzzleHeight, ctx);
            armed.blocked = !clearShot(world, ctx, muzzle, target, e, world.req(e, Faction).id, FIRE_ROOM);
            if (armed.blocked) continue;
          }
          // A heavy round for armour (guard towers' AP shells): one shot on its own, slower cooldown.
          const w = volleyWeapon(armed.weapon, world.get(target, Health)?.armor ?? 0);
          fire(world, ctx, e, armed, target, w);
          armed.firedAt = world.time;
          armed.burstLeft = w.burst - 1;
          armed.burstTimer = w.burstGap;
          armed.cooldown = w.cooldown;
        }
      }
    },
  };
}
