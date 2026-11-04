import { System, World } from '../../core/ecs';
import {
  Ai,
  Armed,
  Building,
  Collider,
  Faction,
  GroundFollow,
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

/** Seconds a wreck spends sinking into the ground before it's removed. */
const SINK_TIME = 3;
/** How fast a shot-down aircraft falls, world units per second. */
const FALL_SPEED = 7;

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
          if (unit.def.wreckTime <= 0) {
            world.destroy(e);
            continue;
          }
          for (const c of [Unit, Health, Armed, Ai, Mover, Collider, Targetable]) world.remove(e, c);
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
          // Engineers' fortifications are gone for good (see BuildingDef.lasts).
          if (def.lasts) continue;
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
 * A building going up (a fuel depot): hurts everything round it, its own
 * side's units and buildings too, falling off toward the edge like splash.
 * The kills go to whoever destroyed the building.
 */
function explode(world: World, ctx: SimContext, at: Transform, blast: { damage: number; radius: number }, killer: Hit | null): void {
  ctx.grid.forEachNear(at.x, at.z, blast.radius + 3, (other, d2) => {
    if (!world.has(other, Targetable) || world.req(other, Health).hp <= 0) return;
    // Aircraft overhead are out of reach, as with any ground burst.
    const edge = Math.hypot(Math.max(0, Math.sqrt(d2) - world.req(other, Collider).radius), Math.max(0, world.req(other, Transform).y - at.y));
    if (edge > blast.radius) return;
    applyDamage(world, ctx, other, blast.damage * (1 - 0.6 * (edge / blast.radius)), killer);
  });
  ctx.events.emit('impact', { x: at.x, y: at.y + 1, z: at.z, kind: 'artillery', splash: blast.radius });
}

export function wreckSystem(): System {
  return {
    name: 'wrecks',
    update(world, dt) {
      for (const e of world.query(Wreck)) {
        const wreck = world.req(e, Wreck);
        const g = world.get(e, GroundFollow);
        // Shot-down aircraft fall out of the sky first.
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
