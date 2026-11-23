import { System } from '../core/ecs';
import { Construction, Faction, Guard, Transform, Unit } from './components';
import { SimContext } from './context';
import { spawnBuilding } from './spawn';
import { spawnSpot } from './systems/production';
import * as D from '../core/dmath';

/*
 * Lodestar: magnets and scrap.
 *
 * Its magnet cranes fling wrecks (WeaponDef.flings): each throw takes that
 * much of the wreckage lying round the crane (see WreckageField.take), and a
 * crane with no wrecks in reach can't throw (it has a machine gun for that),
 * and the more wreckage there is in reach, the harder it throws (scrapHeft).
 * And now and then a crane with a heap of wrecks in reach drags it together
 * into a scrap wall (UnitDef.walls) a little way ahead of itself: low cover
 * for its own side that crumbles after a while.
 */

/** How far round itself a crane reaches for wrecks to throw or drag. */
export const SCRAP_REACH = 12;
/** Wreckage in reach (tank-sized wrecks are about 1.5) at which a throw hits its hardest. */
const HEAP_FULL = 8;
/** What a throw's damage is multiplied by with next to nothing in reach, and with a full heap. */
const HEFT_LEAST = 0.5;
const HEFT_MOST = 1.25;

/**
 * How hard a throw hits for the wreckage lying in reach (WeaponDef.flings):
 * scraps early on, whole hulks once the field's littered, so Lodestar hits
 * harder the longer a fight goes on.
 */
export function scrapHeft(heap: number): number {
  return HEFT_LEAST + (HEFT_MOST - HEFT_LEAST) * Math.min(1, heap / HEAP_FULL);
}
/** Salvage a scrap wall takes, in tank-sized wrecks. */
const WALL_COST = 1;
/** How far ahead of the crane it drags the wall together. */
const WALL_AHEAD = 5;
/** Seconds between checks. */
const TICK = 1;

/** Cranes dragging wrecks into walls. */
export function lodestarSystem(ctx: SimContext): System {
  let acc = 0;
  const next = new Map<number, number>();
  return {
    name: 'lodestar',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      acc = 0;
      for (const k of next.keys()) if (!world.isAlive(k)) next.delete(k);
      for (const e of world.query(Unit, Transform, Faction)) {
        const def = world.req(e, Unit).def;
        if (!def.walls || world.has(e, Guard)) continue;
        const due = next.get(e);
        if (due === undefined) {
          next.set(e, world.time + def.walls * ctx.rng.range(0.3, 1));
          continue;
        }
        if (world.time < due) continue;
        const t = world.req(e, Transform);
        const faction = world.req(e, Faction).id;
        // Not enough scrap in reach: look again in a bit.
        if (ctx.wreckage.near(t.x, t.z, SCRAP_REACH) < WALL_COST) {
          next.set(e, world.time + 4);
          continue;
        }
        const wall = ctx.buildings.scrapWall;
        const ax = t.x + D.cos(t.heading) * WALL_AHEAD;
        const az = t.z - D.sin(t.heading) * WALL_AHEAD;
        const spot = spawnSpot(ctx, ax, az, wall.radius + 0.3);
        if (!spot || ctx.field.isWater(spot.x, spot.z)) {
          next.set(e, world.time + 4);
          continue;
        }
        ctx.wreckage.take(t.x, t.z, SCRAP_REACH, WALL_COST);
        // Across the way the crane faces.
        const b = spawnBuilding(world, ctx, wall, faction, spot.x, spot.z, t.heading + Math.PI / 2, true);
        const c = world.get(b, Construction);
        if (c) c.duration = wall.buildTime;
        ctx.events.emit('scrapWall', { x: spot.x, y: world.req(b, Transform).y, z: spot.z, fromX: t.x, fromZ: t.z });
        next.set(e, world.time + def.walls * ctx.rng.range(0.9, 1.1));
      }
    },
  };
}
