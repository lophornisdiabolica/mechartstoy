import { Entity, System, World } from '../../core/ecs';
import { restartSuperBuilds } from './production';
import {
  Ai,
  Ammo,
  Armed,
  Falling,
  Building,
  Collider,
  Faction,
  GroundFollow,
  Guard,
  Health,
  Hit,
  makeTransform,
  Mover,
  OutpostPart,
  Renderable,
  Rubble,
  Targetable,
  Transform,
  Unit,
  Wreck,
} from '../components';
import { SimContext } from '../context';
import { applyDamage } from './projectiles';
import * as D from '../../core/dmath';
import { MOVE_RULES } from '../../world/moveClasses';

/** Seconds a wreck spends sinking into the ground before it's removed. */
const SINK_TIME = 3;
/** How fast a shot-down aircraft falls, world units per second; and a plane, which glides down. */
const FALL_SPEED = 7;
const GLIDE_SPEED = 3;

/**
 * Handles anything at 0 hp. Units become wrecks (or vanish); buildings are
 * replaced by a rubble entity that the rebuild system later turns back into
 * a construction site.
 */
export function deathSystem(ctx: SimContext): System {
  return {
    name: 'death',
    update(world) {
      for (const e of world.query(Health, Transform)) {
        if (world.req(e, Health).hp > 0) continue;
        const t = world.req(e, Transform);
        const faction = world.req(e, Faction).id;
        const killer = world.req(e, Health).lastHit;

        const unit = world.get(e, Unit);
        if (unit) {
          ctx.events.emit('unitDestroyed', { entity: e, x: t.x, y: t.y, z: t.z, def: unit.def, faction, killer });
          // Losing a super unit is a real setback: the next one takes a full build from now.
          if (unit.def.category === 'super' && faction >= 0 && !world.has(e, Guard)) restartSuperBuilds(world, ctx, faction);
          // Fuel tanks go up, and the spilt fuel burns (see UnitDef.explodes).
          if (unit.def.explodes) {
            explode(world, ctx, t, unit.def.explodes, killer, e);
            ctx.fire.add(t.x, t.z, unit.def.explodes.radius * 0.6, 1, faction, unit.def.id);
          }
          if (unit.def.wreckTime <= 0) {
            world.destroy(e);
            continue;
          }
          // A shot-down aircraft keeps flying on as it falls (planes most of all), and blows up where it comes down.
          const mover = world.get(e, Mover);
          if (mover && MOVE_RULES[mover.move].flies) {
            const d = unit.def;
            const speed = d.fixedWing ? d.speed * 0.8 : d.speed * 0.45;
            world.add(e, Falling, { vx: D.cos(t.heading) * speed, vz: -D.sin(t.heading) * speed, spin: d.fixedWing ? 0 : ((e % 2) * 2 - 1) * (d.radius > 2 ? 0.3 : 2.5), damage: 15 + d.hp * 0.08, radius: 1.5 + d.radius });
          }
          for (const c of [Unit, Health, Armed, Ai, Mover, Collider, Targetable, Ammo]) world.remove(e, c);
          world.add(e, Wreck, { removeAt: world.time + unit.def.wreckTime });
          continue;
        }

        const building = world.get(e, Building);
        if (building) {
          const def = building.def;
          const part = world.get(e, OutpostPart);
          ctx.events.emit('buildingDestroyed', { entity: e, x: t.x, y: t.y, z: t.z, def, faction, killer });
          world.destroy(e);
          if (def.explodes) explode(world, ctx, t, def.explodes, killer);
          // What engineers put up is gone for good (see BuildingDef.field).
          if (def.field) continue;
          const r = world.create();
          world.add(r, Transform, makeTransform(t.x, t.y, t.z, t.heading));
          world.add(r, Renderable, { model: 'rubble', scale: def.radius });
          world.add(r, Rubble, { def, faction, heading: t.heading, rebuildAt: world.time + def.rebuildDelay });
          if (part) world.add(r, OutpostPart, { outpost: part.outpost });
        }
      }
    },
  };
}

/**
 * A building or unit going up (a fuel depot, a Firestorm unit's tanks): hurts everything round it, its own
 * side's units and buildings too, falling off toward the edge like splash.
 * The kills go to whoever destroyed the building.
 */
function explode(world: World, ctx: SimContext, at: Transform, blast: { damage: number; radius: number }, killer: Hit | null, self: Entity | null = null): void {
  ctx.grid.forEachNear(at.x, at.z, blast.radius + 3, (other, d2) => {
    if (other === self || !world.has(other, Targetable) || world.req(other, Health).hp <= 0) return;
    // Aircraft overhead are out of reach, as with any ground burst.
    const edge = D.hypot(Math.max(0, Math.sqrt(d2) - world.req(other, Collider).radius), Math.max(0, world.req(other, Transform).y - at.y));
    if (edge > blast.radius) return;
    applyDamage(world, ctx, other, blast.damage * (1 - 0.6 * (edge / blast.radius)), killer);
  });
  ctx.events.emit('impact', { x: at.x, y: at.y + 1, z: at.z, kind: 'artillery', splash: blast.radius });
}

export function wreckSystem(ctx?: SimContext): System {
  return {
    name: 'wrecks',
    update(world, dt) {
      for (const e of world.query(Wreck)) {
        const wreck = world.req(e, Wreck);
        const g = world.get(e, GroundFollow);
        // Shot-down aircraft fall out of the sky first, flying on as they go, and explode where they hit.
        const falling = world.get(e, Falling);
        if (falling && g) {
          const t = world.req(e, Transform);
          t.x += falling.vx * dt;
          t.z += falling.vz * dt;
          t.heading += falling.spin * dt;
          g.offset = Math.max(0, g.offset - dt * (falling.spin === 0 ? GLIDE_SPEED : FALL_SPEED));
          if (g.offset <= 0) {
            world.remove(e, Falling);
            if (ctx) explode(world, ctx, t, { damage: falling.damage, radius: falling.radius }, null);
          }
          continue;
        }
        if (g && g.offset > 0 && world.time < wreck.removeAt - SINK_TIME) g.offset = Math.max(0, g.offset - dt * FALL_SPEED);
        if (world.time >= wreck.removeAt) {
          world.destroy(e);
        } else if (world.time >= wreck.removeAt - SINK_TIME) {
          if (g) g.offset -= dt * 0.7;
        }
      }
    },
  };
}
