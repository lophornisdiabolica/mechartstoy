import { Entity, System, World } from '../core/ecs';
import { Building, Construction, Faction, Health, Nomad, Producer, Transform, Unit } from './components';
import { SimContext } from './context';
import { spawnBuilding, spawnUnit } from './spawn';
import { spawnSpot } from './systems/production';
import { BuildingId } from './buildings';
import { UnitId } from './units';
import * as D from '../core/dmath';

/*
 * Nomad: a base that walks.
 *
 * Its HQ stays put, but its factories are crawlers (UnitDef.deploys): huge
 * slow tracked rigs that drive out and set up camp a set way behind the
 * army's middle. Unfolding takes a while (the camp goes up as a building
 * under construction), and so does packing up again. Set up, a crawler is a
 * production building (see BuildingDef.production) with territory round it,
 * so units are made close to the fight and the wounded heal there; packed,
 * it's a vehicle again. When the army's middle moves on far enough, forward
 * or back, the camp packs up and drives after it. A crawler never sets up
 * behind the start (nearer home than the base's edge plus a margin).
 *
 * New crawlers come out of the side's crawler yard (its signature building),
 * up to MOST of them at a time, set up or not.
 */

/** A camp's territory, for healing (see inTerritory). */
export interface Camp {
  x: number;
  z: number;
  faction: number;
}

/** Most crawlers a side has at once, set up or not. */
const MOST = 3;
/** Seconds between new crawlers from the yard. */
const YARD_EVERY = 50;
/** How far behind the army's middle camps set up. */
const BEHIND = 16;
/** Least distance from home a camp sets up: the base's edge plus this. */
const PAST_HOME = 10;
/** How far apart side by side a side's camps set up. */
const SPACING = 10;
/** How far the place it wants has to have moved on, forward or back, before a camp packs up. */
const FORWARD_SLACK = 18;
const BACK_SLACK = 9;
/** Seconds a camp keeps still after it's hit before it'll pack up and leave. */
const HELD_DOWN = 6;
/** How close a crawler has to be to its place to set up. */
const ARRIVED = 6;
/** Seconds between checks. */
const TICK = 0.5;

/** Where a side's crawler in this slot should set up. */
export function campSpot(ctx: SimContext, faction: number, slot: number): { x: number; z: number; dirX: number; dirZ: number } | null {
  const home = ctx.field.baseSites[faction];
  if (!home) return null;
  const pic = ctx.commander.sides[faction];
  const least = home.radius + PAST_HOME;
  let dirX = 0;
  let dirZ = 0;
  let d = least;
  if (pic && pic.armyX !== null && pic.armyZ !== null) {
    const ax = pic.armyX - home.x;
    const az = pic.armyZ - home.z;
    const ad = Math.hypot(ax, az);
    if (ad > 1) {
      dirX = ax / ad;
      dirZ = az / ad;
      d = Math.max(least, ad - BEHIND);
    }
  }
  if (dirX === 0 && dirZ === 0) {
    // No army out yet: face the middle of the map.
    const md = Math.hypot(home.x, home.z) || 1;
    dirX = -home.x / md;
    dirZ = -home.z / md;
  }
  // Slots side by side across the line, the outer ones a little further back.
  const across = slot === 0 ? 0 : slot % 2 === 1 ? 1 : -1;
  const back = slot === 0 ? 0 : 4;
  const x = home.x + dirX * (d - back) - dirZ * across * SPACING;
  const z = home.z + dirZ * (d - back) + dirX * across * SPACING;
  return { x, z, dirX, dirZ };
}

/** Crawlers driving to their places, setting up, packing up; the yard turning out new ones. */
export function nomadSystem(ctx: SimContext): System {
  let acc = 0;
  const nextCrawler = new Map<number, number>();
  return {
    name: 'nomad',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      acc = 0;
      const camps: Camp[] = [];
      const taken = new Map<number, Set<number>>();
      const slots = (f: number) => {
        let s = taken.get(f);
        if (!s) taken.set(f, (s = new Set()));
        return s;
      };
      for (const e of world.query(Nomad, Faction, Transform)) slots(world.req(e, Faction).id).add(world.req(e, Nomad).slot);

      // Crawlers that have reached their place set up.
      for (const e of world.query(Unit, Nomad, Transform, Faction)) {
        const def = world.req(e, Unit).def;
        if (!def.deploys) continue;
        const faction = world.req(e, Faction).id;
        const nomad = world.req(e, Nomad);
        const t = world.req(e, Transform);
        const spot = campSpot(ctx, faction, nomad.slot);
        if (!spot || D.hypot(spot.x - t.x, spot.z - t.z) > ARRIVED) continue;
        const into = ctx.buildings[def.deploys.into as BuildingId];
        const room = spawnSpot(ctx, t.x, t.z, into.radius + 0.4);
        if (!room || ctx.field.isWater(room.x, room.z)) continue;
        const health = world.get(e, Health);
        const share = health ? health.hp / health.max : 1;
        world.destroy(e);
        const camp = spawnBuilding(world, ctx, into, faction, room.x, room.z, D.atan2(-spot.dirZ, spot.dirX), true);
        world.add(camp, Nomad, { slot: nomad.slot, packAt: null });
        // Unfolding doesn't mend it: it comes up to the share of health it drove in with.
        const c = world.get(camp, Construction);
        if (c) c.duration = def.deploys.time;
        const h = world.req(camp, Health);
        h.hp = h.max * share * 0.3;
        ctx.events.emit('camp', { x: room.x, y: t.y, z: room.z, up: true });
      }

      // Camps set up: pack up when the army has moved on; packed, drive off again.
      for (const e of world.query(Building, Nomad, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const faction = world.req(e, Faction).id;
        const nomad = world.req(e, Nomad);
        const t = world.req(e, Transform);
        if (nomad.packAt === null) {
          camps.push({ x: t.x, z: t.z, faction });
          const spot = campSpot(ctx, faction, nomad.slot);
          if (!spot) continue;
          const ahead = (spot.x - t.x) * spot.dirX + (spot.z - t.z) * spot.dirZ;
          const hurt = world.get(e, Health);
          if (hurt && world.time - hurt.hurtAt < HELD_DOWN) continue;
          if (ahead > FORWARD_SLACK || ahead < -BACK_SLACK) {
            nomad.packAt = world.time + (ctx.units.crawler.deploys?.time ?? 15);
            world.remove(e, Producer);
            ctx.events.emit('camp', { x: t.x, y: t.y, z: t.z, up: false });
          }
          continue;
        }
        if (world.time < nomad.packAt) continue;
        const crawler = crawlerFor(ctx, world.req(e, Building).def.id);
        if (!crawler) continue;
        const spot = spawnSpot(ctx, t.x, t.z, ctx.units[crawler].radius, ctx.units[crawler].move);
        if (!spot) continue;
        const h = world.get(e, Health);
        const share = h ? h.hp / h.max : 1;
        world.destroy(e);
        const unit = launch(world, ctx, crawler, faction, spot.x, spot.z, nomad.slot);
        const uh = world.get(unit, Health);
        if (uh) uh.hp = uh.max * share;
        ctx.events.emit('camp', { x: t.x, y: t.y, z: t.z, up: false });
      }
      ctx.camps = camps;

      // The yard turns out a new crawler now and then, while there's a slot free.
      for (const e of world.query(Building, Transform, Faction)) {
        const def = world.req(e, Building).def;
        if (!def.yard || world.has(e, Construction)) continue;
        const faction = world.req(e, Faction).id;
        if (faction < 0) continue;
        const due = nextCrawler.get(faction);
        if (due === undefined) {
          nextCrawler.set(faction, world.time + YARD_EVERY * 0.3);
          continue;
        }
        if (world.time < due) continue;
        const used = slots(faction);
        let slot = 0;
        while (used.has(slot)) slot++;
        if (slot >= MOST) continue;
        const t = world.req(e, Transform);
        const r = def.radius + 2.2;
        const spot = spawnSpot(ctx, t.x + D.cos(t.heading) * r, t.z - D.sin(t.heading) * r, ctx.units[def.yard].radius, ctx.units[def.yard].move);
        if (!spot) continue;
        launch(world, ctx, def.yard, faction, spot.x, spot.z, slot);
        used.add(slot);
        nextCrawler.set(faction, world.time + YARD_EVERY / Math.max(0.5, ctx.sides.strength[faction]));
      }
    },
  };
}

/** The crawler a camp packs up into. */
function crawlerFor(ctx: SimContext, camp: string): UnitId | null {
  for (const def of Object.values(ctx.units)) if (def.deploys?.into === camp) return def.id as UnitId;
  return null;
}

function launch(world: World, ctx: SimContext, id: UnitId, faction: number, x: number, z: number, slot: number): Entity {
  const e = spawnUnit(world, ctx, ctx.units[id], faction, x, z);
  world.add(e, Nomad, { slot, packAt: null });
  return e;
}
