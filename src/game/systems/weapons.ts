import { Entity, System, World } from '../../core/ecs';
import { Armed, Faction, makeTransform, Mover, Projectile, Renderable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { turnToward, wrapAngle } from './movement';

/** How closely the weapon must point at the target before firing, radians. */
const AIM_TOLERANCE = 0.12;

function fire(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity): void {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const def = world.req(e, Unit).def;
  const w = armed.weapon;

  const sx = t.x + Math.cos(armed.aim) * def.radius * 0.8;
  const sz = t.z - Math.sin(armed.aim) * def.radius * 0.8;
  const sy = t.y + w.muzzleHeight;

  const dist = Math.hypot(tt.x - sx, tt.z - sz);
  // Miss distance grows with range; sqrt keeps the scatter evenly spread over the disc.
  const missR = w.spread * dist * Math.sqrt(ctx.rng.next());
  const missA = ctx.rng.range(0, Math.PI * 2);
  const ex = tt.x + Math.cos(missA) * missR;
  const ez = tt.z + Math.sin(missA) * missR;
  const targetDef = world.get(target, Unit)?.def;
  const ey = ctx.field.surfaceAt(ex, ez) + (targetDef ? Math.min(1, targetDef.radius * 0.6) : 0.3);

  const p = world.create();
  world.add(p, Transform, makeTransform(sx, sy, sz, armed.aim));
  world.add(p, Renderable, { model: `projectile:${w.projectile}`, scale: 1 });
  world.add(p, Projectile, {
    kind: w.projectile,
    weapon: w,
    faction: world.req(e, Faction).id,
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
      for (const e of world.query(Armed, Transform, Unit)) {
        const armed = world.req(e, Armed);
        const t = world.req(e, Transform);
        const def = world.req(e, Unit).def;
        armed.cooldown -= dt;

        const target = armed.target !== null && world.has(armed.target, Unit) ? armed.target : null;
        if (target === null) {
          armed.burstLeft = 0;
          // Turrets drift back to face forward when idle.
          armed.aim = def.turret ? turnToward(armed.aim, t.heading, def.turretTurnRate * dt) : t.heading;
          continue;
        }

        const tt = world.req(target, Transform);
        const desired = Math.atan2(-(tt.z - t.z), tt.x - t.x);
        if (def.turret) {
          armed.aim = turnToward(armed.aim, desired, def.turretTurnRate * dt);
        } else {
          // Turret-less units turn the whole body once they've stopped to shoot.
          const mover = world.get(e, Mover);
          if (!mover || mover.targetX === null) t.heading = turnToward(t.heading, desired, def.turnRate * dt);
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

        const d = Math.hypot(tt.x - t.x, tt.z - t.z);
        const inRange = d <= armed.weapon.range && d >= armed.weapon.minRange;
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
