import { Entity, System, World } from '../../core/ecs';
import { Armed, Building, Collider, Construction, Faction, makeTransform, Mover, Projectile, Renderable, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { turnToward, wrapAngle } from './movement';
import { distanceToTarget, effectiveRange } from './targeting';
import { MOVE_RULES } from '../../world/moveClasses';

/** How closely the weapon must point at the target before firing, radians. */
const AIM_TOLERANCE = 0.12;

function fire(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity): void {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const w = armed.weapon;

  const sx = t.x + Math.cos(armed.aim) * armed.muzzleOffset;
  const sz = t.z - Math.sin(armed.aim) * armed.muzzleOffset;
  const sy = t.y + w.muzzleHeight;

  const targetRadius = world.get(target, Collider)?.radius ?? 0.5;
  const dist = Math.hypot(tt.x - sx, tt.z - sz);
  // Miss distance grows with range; sqrt keeps the scatter evenly spread over the disc.
  const missR = w.spread * dist * Math.sqrt(ctx.rng.next());
  const missA = ctx.rng.range(0, Math.PI * 2);
  const ex = tt.x + Math.cos(missA) * missR;
  const ez = tt.z + Math.sin(missA) * missR;
  // Shots at aircraft go to the aircraft's height; everything else lands on the ground at the impact point.
  const tm = world.get(target, Mover);
  const ey = (tm && MOVE_RULES[tm.move].flies ? tt.y : ctx.field.surfaceAt(ex, ez)) + Math.min(1.5, targetRadius * 0.6);

  const p = world.create();
  world.add(p, Transform, makeTransform(sx, sy, sz, armed.aim));
  world.add(p, Renderable, { model: `projectile:${w.projectile}`, scale: 1 });
  world.add(p, Projectile, {
    kind: w.projectile,
    weapon: w,
    faction: world.req(e, Faction).id,
    source: world.get(e, Unit)?.def.id ?? world.get(e, Building)?.def.id ?? 'unknown',
    target,
    sx,
    sy,
    sz,
    ex,
    ey,
    ez,
    arcHeight: w.arc ? Math.max(2, dist * 0.35) : 0,
    elapsed: 0,
    duration: Math.max(0.05, dist / w.speed),
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
        const desired = Math.atan2(-(tt.z - t.z), tt.x - t.x);
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
          fire(world, ctx, e, armed, target);
          armed.burstLeft = armed.weapon.burst - 1;
          armed.burstTimer = armed.weapon.burstGap;
          armed.cooldown = armed.weapon.cooldown;
        }
      }
    },
  };
}
