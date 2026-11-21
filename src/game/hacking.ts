import { Entity, System, World } from '../core/ecs';
import { Ai, Armed, Arsenal, Building, Carrier, Construction, Faction, Guard, Hacked, Health, Mover, Transform, Unit } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';
import type { JamDef } from './units';

/**
 * Cipher's hacking. A hack weapon (WeaponDef.hack) that lands on an enemy
 * vehicle turns it to the shooter's side for a few seconds: its Faction
 * becomes the hacker's and its AI is set aside, so it stops dead and turns
 * its guns on whatever is near it, its old friends included, and they on it.
 * Then it comes back to itself, and can't be turned again for a while.
 * Kills it makes while turned count for the hacker; if it dies turned, it
 * dies as its own side's.
 *
 * Jammers (UnitDef.jam, BuildingDef.jam) slow the enemy weapons round them:
 * they reload at a share of their usual rate (see Armed.jammed).
 */

/** Seconds after it comes back that a hacked vehicle can't be turned again. */
export const HACK_PROOF = 12;
/** A pulse jams for this much longer than the time to the jammer's next one, so it doesn't flicker. */
const JAM_HOLD = 0.3;

/** Whether a hack can turn this entity now: an army vehicle (not a super unit, a carrier, an engineer or an outpost guard) that isn't turned already or just back. */
export function hackable(world: World, e: Entity): boolean {
  const unit = world.get(e, Unit);
  if (!unit || unit.def.category !== 'vehicle' || unit.def.builds) return false;
  if (!world.has(e, Ai) || world.has(e, Guard) || world.has(e, Carrier) || world.has(e, Hacked)) return false;
  return (world.get(e, Health)?.hp ?? 0) > 0;
}

/** Turn `e` to side `by` for `seconds` (see hackable). */
export function hack(world: World, ctx: SimContext, e: Entity, by: number, seconds: number): void {
  if (!hackable(world, e)) return;
  const faction = world.req(e, Faction);
  const home = faction.id;
  if (!ctx.sides.hostile(by, home)) return;
  const ai = world.req(e, Ai);
  world.add(e, Hacked, { home, turned: true, until: world.time + seconds, proofUntil: world.time + seconds + HACK_PROOF, ai });
  world.remove(e, Ai);
  faction.id = by;
  stop(world, e);
  forgetAbout(world, e);
  const t = world.req(e, Transform);
  ctx.events.emit('hacked', { entity: e, x: t.x, y: t.y, z: t.z, faction: by, home, back: false });
}

/** Bring a turned vehicle back to its own side. */
function release(world: World, ctx: SimContext, e: Entity, h: Hacked): void {
  const by = world.req(e, Faction).id;
  world.req(e, Faction).id = h.home;
  h.turned = false;
  if (h.ai && (world.get(e, Health)?.hp ?? 0) > 0) world.add(e, Ai, h.ai);
  h.ai = null;
  if (world.has(e, Armed)) stop(world, e);
  forgetAbout(world, e);
  const t = world.req(e, Transform);
  ctx.events.emit('hacked', { entity: e, x: t.x, y: t.y, z: t.z, faction: by, home: h.home, back: true });
}

/** It stands where it is and looks again for something to shoot. */
function stop(world: World, e: Entity): void {
  const m = world.get(e, Mover);
  if (m) {
    m.targetX = null;
    m.targetZ = null;
    m.nav.path = null;
  }
  const retarget = (a: Armed) => {
    a.target = null;
    a.nextTargetAt = world.time;
    a.burstLeft = 0;
  };
  retarget(world.req(e, Armed));
  for (const a of world.get(e, Arsenal)?.arms ?? []) retarget(a);
}

/** Everyone aiming at it looks again: its old friends and enemies have swapped round. */
function forgetAbout(world: World, e: Entity): void {
  for (const other of world.query(Armed)) {
    const a = world.req(other, Armed);
    if (a.target === e) {
      a.target = null;
      a.nextTargetAt = world.time;
    }
    for (const arm of world.get(other, Arsenal)?.arms ?? []) {
      if (arm.target === e) {
        arm.target = null;
        arm.nextTargetAt = world.time;
      }
    }
  }
}

/**
 * Brings turned vehicles back when their time is up (or when they die, so
 * they die as their own side's), and runs the jammers: each sends out a
 * pulse every `every` seconds that jams the enemy guns it reaches until
 * the next one. Before the death system.
 */
export function hackSystem(ctx: SimContext): System {
  /** When each jammer next pulses. */
  const pulseAt = new Map<Entity, number>();
  return {
    name: 'hacking',
    update(world) {
      for (const e of world.query(Hacked, Faction)) {
        const h = world.req(e, Hacked);
        const hp = world.get(e, Health)?.hp ?? 0;
        if (h.turned && (world.time >= h.until || hp <= 0)) release(world, ctx, e, h);
        else if (!h.turned && world.time >= h.proofUntil) world.remove(e, Hacked);
      }
      const pulse = (e: Entity, jam: JamDef) => {
        const at = pulseAt.get(e);
        if (at === undefined) {
          // Each starts a little out of step with the others, by its id, so a row of jammers doesn't pulse as one.
          pulseAt.set(e, world.time + (e % 7) * (jam.every / 7));
          return;
        }
        if (world.time < at) return;
        pulseAt.set(e, at + jam.every);
        jamAround(world, ctx, e, jam);
      };
      for (const e of world.query(Unit, Transform, Faction)) {
        const jam = world.req(e, Unit).def.jam;
        if (jam && (world.get(e, Health)?.hp ?? 0) > 0) pulse(e, jam);
      }
      for (const e of world.query(Building, Transform, Faction)) {
        const jam = world.req(e, Building).def.jam;
        if (jam && !world.has(e, Construction)) pulse(e, jam);
      }
      for (const e of pulseAt.keys()) if (!world.isAlive(e) || !world.has(e, Transform)) pulseAt.delete(e);
    },
  };
}

function jamAround(world: World, ctx: SimContext, e: Entity, jam: JamDef): void {
  const t = world.req(e, Transform);
  const side = world.req(e, Faction).id;
  // Jammed until a little after the next pulse, so a jammer's steady work doesn't flicker on and off.
  const until = world.time + jam.every + JAM_HOLD;
  ctx.grid.forEachNear(t.x, t.z, jam.radius, (other) => {
    if (!ctx.sides.hostile(side, world.req(other, Faction).id)) return;
    const ot = world.req(other, Transform);
    if (D.sq(ot.x - t.x) + D.sq(ot.z - t.z) > jam.radius * jam.radius) return;
    const armed = world.get(other, Armed);
    if (!armed) return;
    const jamArm = (a: Armed) => {
      // The strongest jam on it wins.
      if (a.jammed !== undefined && a.jammed > world.time && (a.jamPace ?? 1) < jam.pace) return;
      a.jammed = until;
      a.jamPace = jam.pace;
    };
    jamArm(armed);
    for (const arm of world.get(other, Arsenal)?.arms ?? []) jamArm(arm);
  });
}

/** How fast a weapon reloads now: slower while jammed. */
export function reloadPace(world: World, armed: Armed): number {
  return armed.jammed !== undefined && armed.jammed > world.time ? (armed.jamPace ?? 1) : 1;
}
