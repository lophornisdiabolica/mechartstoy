import { Entity, System, World } from '../core/ecs';
import { Ai, DropPod, Faction, Guard, Health, Mover, Transform, Unit } from './components';
import { SimContext } from './context';
import { capCost, countByCategory } from './caps';
import { spawnBuilding, spawnUnit } from './spawn';
import { spawnSpot } from './systems/production';
import { UnitId } from './units';
import { MOVE_RULES } from '../world/moveClasses';
import { applyDamage } from './systems/projectiles';
import * as D from '../core/dmath';

/*
 * Zenith: drops and orbital strikes.
 *
 * Drops. Its barracks and drop control don't send squads out of the door:
 * they come down in pods by the side's beacon runners (fast little scouts
 * that keep with the army), or at an outpost it holds. A pod only lands at
 * or behind the army's middle, never out past it, so drops shorten the walk
 * to the fight rather than open a second front. The pod is a little
 * shelter: it lands with a thump, lets its squad out one at a time over a
 * few seconds, and crumbles. Shooting it down cuts the squad short. With no
 * runner alive and no outpost held, squads walk out of the door as usual.
 *
 * Strikes. An orbital weapon (WeaponDef.orbital) marks a ring on the
 * ground and a few seconds later a beam comes straight down there. Units of
 * every other side caught in a ring scatter out of it (after a moment to
 * notice; see strikeDanger), so the strikes mostly break up formations and
 * catch what's slow, dug in or busy: buildings, walkers, artillery.
 */

/** A strike on its way down. */
export interface PendingStrike {
  x: number;
  z: number;
  radius: number;
  faction: number;
  /** When it was called, and when it lands. */
  calledAt: number;
  at: number;
}

/** Strikes on their way down (see WeaponDef.orbital). */
export class Strikes {
  list: PendingStrike[] = [];

  add(s: PendingStrike): void {
    this.list.push(s);
  }

  /** Forget the ones that have landed. */
  prune(time: number): void {
    if (this.list.length > 0) this.list = this.list.filter((s) => s.at > time);
  }
}

/** Seconds a unit under a strike ring takes to notice it and start running. */
const NOTICE = 1.2;
/** How far past a ring's edge a unit running from it stops. */
const CLEAR = 2.5;

/** The enemy strike ring a point is under that a unit there would have noticed by now, if any. */
export function strikeDanger(ctx: SimContext, faction: number, x: number, z: number, time: number): PendingStrike | null {
  for (const s of ctx.strikes.list) {
    if (time < s.calledAt + NOTICE || s.at <= time) continue;
    if (ctx.sides.allied(s.faction, faction)) continue;
    if (D.sq(x - s.x) + D.sq(z - s.z) <= D.sq(s.radius + 1)) return s;
  }
  return null;
}

/** Where a unit running from a strike heads: straight out from its middle, past the edge. */
export function escapeFrom(s: PendingStrike, x: number, z: number): { x: number; z: number } {
  let dx = x - s.x;
  let dz = z - s.z;
  const d = D.hypot(dx, dz);
  if (d < 0.2) {
    // Right under it: any way out will do (the same way each time for the same spot).
    dx = D.cos(x * 7.1 + z * 3.3);
    dz = D.sin(x * 7.1 + z * 3.3);
  } else {
    dx /= d;
    dz /= d;
  }
  const r = s.radius + CLEAR;
  return { x: s.x + dx * r, z: s.z + dz * r };
}

/** How far past the army's middle (from home) a beacon may stand and still take drops. */
const FRONT_SLACK = 6;
/** How far from the beacon pods come down. */
const POD_SCATTER = 3;

/**
 * Where a side's next drop lands, or null to walk out of the door: by its
 * most forward beacon runner that's not out past its army, or at its most
 * forward held outpost if that's nearer the front.
 */
export function dropSite(world: World, ctx: SimContext, faction: number): { x: number; z: number } | null {
  const home = ctx.field.baseSites[faction];
  if (!home) return null;
  const pic = ctx.commander.sides[faction];
  const front = pic && pic.armyX !== null && pic.armyZ !== null ? D.hypot(pic.armyX - home.x, pic.armyZ - home.z) + FRONT_SLACK : 0;
  let best: { x: number; z: number } | null = null;
  let bestD = -1;
  const consider = (x: number, z: number) => {
    const d = D.hypot(x - home.x, z - home.z);
    if (d > front || d <= bestD) return;
    best = { x, z };
    bestD = d;
  };
  for (const e of world.query(Unit, Faction, Transform)) {
    if (world.req(e, Faction).id !== faction || world.req(e, Unit).def.id !== 'beaconRunner' || world.has(e, Guard)) continue;
    const t = world.req(e, Transform);
    consider(t.x, t.z);
  }
  for (const o of ctx.outposts) if (o.owner === faction) consider(o.x, o.z);
  // A drop barely out of the base isn't worth a pod.
  return best !== null && bestD > home.radius * 1.5 ? best : null;
}

/** How high pods fall from, and how long they take to come down. */
const POD_HEIGHT = 45;
const POD_FALL = 1.8;
/** Seconds between soldiers coming out, after the first. */
const POD_STAGGER = 0.45;
/** Seconds an empty pod stands before it crumbles. */
const POD_LINGER = 4;
/** What a pod landing on enemies does to them. */
const POD_CRUSH = { damage: 40, radius: 1.4 };

/** Send a squad down in a pod near (x, z). Returns false if there's no room there. */
export function launchPod(world: World, ctx: SimContext, faction: number, x: number, z: number, aboard: UnitId[], squad: number): boolean {
  const a = ctx.rng.range(0, Math.PI * 2);
  const r = ctx.rng.range(0.5, POD_SCATTER);
  const spot = spawnSpot(ctx, x + D.cos(a) * r, z + D.sin(a) * r, 1.4);
  if (!spot || ctx.field.isWater(spot.x, spot.z)) return false;
  const home = ctx.field.baseSites[faction];
  const heading = home ? D.atan2(-(spot.z - home.z), spot.x - home.x) : 0;
  const pod = spawnBuilding(world, ctx, ctx.buildings.dropPod, faction, spot.x, spot.z, heading);
  const t = world.req(pod, Transform);
  const groundY = t.y;
  t.y = t.py = groundY + POD_HEIGHT;
  world.add(pod, DropPod, { aboard: [...aboard], squad, landAt: world.time + POD_FALL, nextAt: world.time + POD_FALL + 0.4, fromY: groundY + POD_HEIGHT, groundY, crumbleAt: Infinity });
  return true;
}

/** Pods falling, landing, letting their squads out and crumbling. */
export function dropPodSystem(ctx: SimContext): System {
  return {
    name: 'dropPods',
    update(world) {
      ctx.strikes.prune(world.time);
      let counts: ReturnType<typeof countByCategory> | null = null;
      for (const e of world.query(DropPod, Transform, Faction)) {
        const pod = world.req(e, DropPod);
        const t = world.req(e, Transform);
        if (world.time < pod.landAt) {
          // Falling: faster and faster.
          const k = 1 - (pod.landAt - world.time) / POD_FALL;
          t.y = pod.fromY + (pod.groundY - pod.fromY) * k * k;
          continue;
        }
        if (t.y !== pod.groundY) {
          t.y = pod.groundY;
          land(world, ctx, e, t);
        }
        const faction = world.req(e, Faction).id;
        if (pod.aboard.length > 0 && world.time >= pod.nextAt) {
          const id = pod.aboard.shift()!;
          const def = ctx.units[id];
          const out = t.heading + ctx.rng.range(-0.8, 0.8);
          const spot = spawnSpot(ctx, t.x + D.cos(out) * 1.6, t.z - D.sin(out) * 1.6, def.radius, def.move);
          if (spot) {
            spawnUnit(world, ctx, def, faction, spot.x, spot.z, pod.squad);
            counts ??= countByCategory(world, ctx.sides.count);
            counts[faction][def.category] += capCost(def);
          }
          pod.nextAt = world.time + POD_STAGGER;
          if (pod.aboard.length === 0) pod.crumbleAt = world.time + POD_LINGER;
        }
        if (world.time >= pod.crumbleAt) {
          ctx.events.emit('dropPod', { x: t.x, y: t.y, z: t.z, landed: false });
          world.destroy(e);
        }
      }
    },
  };
}

/** A pod hitting the ground: it crushes enemies under it, and kicks up dust. */
function land(world: World, ctx: SimContext, e: Entity, t: Transform): void {
  const faction = world.req(e, Faction).id;
  ctx.events.emit('dropPod', { x: t.x, y: t.y, z: t.z, landed: true });
  ctx.grid.forEachNear(t.x, t.z, POD_CRUSH.radius + 2, (other, d2) => {
    if (other === e || !world.has(other, Unit) || !ctx.sides.hostile(faction, world.req(other, Faction).id)) return;
    const m = world.get(other, Mover);
    if (m && MOVE_RULES[m.move].flies) return;
    if (d2 > D.sq(POD_CRUSH.radius + 0.5)) return;
    if ((world.get(other, Health)?.hp ?? 0) > 0) applyDamage(world, ctx, other, POD_CRUSH.damage, { source: 'dropPod', faction });
  });
}

/** Units of a side that run from strikes: everything on the ground with an AI (the units' own legs do the rest; see systems/ai.ts). */
export function dodges(world: World, e: Entity): boolean {
  const m = world.get(e, Mover);
  return world.has(e, Ai) && m !== undefined && !MOVE_RULES[m.move].flies;
}
