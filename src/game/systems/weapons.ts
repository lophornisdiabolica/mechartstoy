import { reloadPace } from '../hacking';
import { Entity, System, World } from '../../core/ecs';
import { Ammo, Armed, Arsenal, Building, Collider, Construction, Faction, makeTransform, Mover, Projectile, Renderable, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { turnToward, wrapAngle } from './movement';
import { aimPoint, clearShot, elevationFor, hullPose, mountFor, traceShot, weaponMuzzle } from '../lineOfFire';
import { barrelDirection, Mount } from '../mounts';
import { distanceToTarget, effectiveRange, volleyWeapon } from './targeting';
import { Health } from '../components';
import type { WeaponDef } from '../units';
import { MOVE_RULES } from '../../world/moveClasses';
import * as D from '../../core/dmath';
import { SCRAP_REACH, scrapHeft } from '../lodestar';
import { strike } from './melee';
import { domeOver } from '../shields';
import { hazeSpread } from '../smoke';

/** How high above its mark an orbital strike starts. */
const ORBIT_HEIGHT = 70;

/** Call an orbital strike down on (x, y, z): a projectile that waits overhead, its ring on the ground (see zenith.ts). */
function orbitalStrike(world: World, ctx: SimContext, e: Entity, w: WeaponDef, faction: number, from: { x: number; y: number; z: number }, x: number, y: number, z: number): void {
  const delay = w.orbital!.delay;
  const p = world.create();
  world.add(p, Transform, makeTransform(x, y + ORBIT_HEIGHT, z, 0));
  world.add(p, Renderable, { model: 'projectile:orbital', scale: 1 });
  world.add(p, Projectile, {
    kind: 'orbital',
    weapon: w,
    faction,
    source: world.get(e, Unit)?.def.id ?? world.get(e, Building)?.def.id ?? 'unknown',
    target: null,
    sx: x,
    sy: y + ORBIT_HEIGHT,
    sz: z,
    ex: x,
    ey: y,
    ez: z,
    arcHeight: 0,
    elapsed: 0,
    duration: delay,
  });
  ctx.strikes.add({ x, z, radius: w.splash, faction, calledAt: world.time, at: world.time + delay });
  ctx.events.emit('strikeCalled', { x, y, z, radius: w.splash, delay, fromX: from.x, fromY: from.y, fromZ: from.z, faction });
  ctx.events.emit('fired', { entity: e, x: from.x, y: from.y, z: from.z, heading: D.atan2(-(z - from.z), x - from.x), climb: 0, kind: 'orbital' });
}

/** How closely the weapon must point at the target before firing, radians. */
const AIM_TOLERANCE = 0.12;

/** How closely the barrels must be pitched to where they're meant to be before firing, radians. */
const ELEV_TOLERANCE = 0.1;
/** How fast barrels pitch up and down, radians per second. */
const ELEV_RATE = 1.4;

/** How far past its target a direct-fire shot that misses carries on, as a multiple of the weapon's range. */
const OVERSHOOT = 1.3;
/** A shot that would only just scrape past a building (most of a burst would hit it) counts as blocked. */
const FIRE_ROOM = 0.5;

/**
 * One shot, from the mount's next muzzle (see mounts.ts): barrels take
 * turns, so a twin-gunned tank fires left, right, left.
 */
function fire(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity, mount: Mount | undefined, w: WeaponDef = armed.weapon, at?: Spot): void {
  const tt = at ? { x: at.x, y: ctx.field.surfaceAt(at.x, at.z), z: at.z } : world.req(target, Transform);
  const faction = world.req(e, Faction).id;
  const index = armed.shot++;
  const muzzle = weaponMuzzle(world, e, armed, armed.aim, armed.elev, index, ctx);
  const { x: sx, y: sy, z: sz } = muzzle;

  const targetRadius = at ? 0.5 : (world.get(target, Collider)?.radius ?? 0.5);
  const dist = D.hypot(tt.x - sx, tt.z - sz);
  // Miss distance grows with range; sqrt keeps the scatter evenly spread over the disc. Through another side's haze it goes wild (see smoke.ts).
  const missR = (w.spread + hazeSpread(ctx, sx, sz, tt.x, tt.z, faction)) * dist * Math.sqrt(ctx.rng.next());
  const missA = ctx.rng.range(0, Math.PI * 2);
  let ex = tt.x + D.cos(missA) * missR;
  let ez = tt.z + D.sin(missA) * missR;
  let ey: number;
  let struck: Entity | null = at ? null : target;
  let dome: Entity | undefined;
  if (w.orbital) {
    // From orbit (see zenith.ts): a ring marks the spot, and the beam comes down there a few seconds later.
    const ground = ctx.field.surfaceAt(ex, ez);
    orbitalStrike(world, ctx, e, w, faction, muzzle, ex, ground, ez);
    return;
  } else if (w.arc || w.projectile === 'flame') {
    // Lobbed, or flame (which licks round corners a little): lands at the impact point, on the ground or at an aircraft's height.
    const tm = at ? undefined : world.get(target, Mover);
    ey = (tm && MOVE_RULES[tm.move].flies ? tt.y : ctx.field.surfaceAt(ex, ez)) + Math.min(1.5, targetRadius * 0.6);
    // Lobbed missiles come down on an enemy dome's skin, not under it (shells and flame fall through: see shields.ts).
    if (w.projectile === 'missile' && ctx.domes.list.length > 0) {
      const over = domeOver(ctx, muzzle, ex, ez, faction);
      if (over && over.y > ey) {
        ey = over.y;
        struck = null;
        dome = over.dome.entity;
      }
    }
  } else {
    // Direct fire: aimed at the body, and stopped by the first thing in the way (see lineOfFire.ts).
    const aim = aimPoint(world, target);
    const trace = traceShot(world, ctx, muzzle, { x: ex, y: aim.y, z: ez }, w.range * OVERSHOOT, e, faction, target);
    ex = trace.x;
    ey = trace.y;
    ez = trace.z;
    struck = trace.hit;
    dome = trace.dome;
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
    ...(dome !== undefined ? { dome } : {}),
  });
  // The flash and smoke go the way the barrel points.
  const dir = mount ? barrelDirection(mount, hullPose(world, e), armed.aim, armed.elev) : { heading: armed.aim, climb: 0 };
  ctx.events.emit('fired', { entity: e, x: sx, y: sy, z: sz, heading: dir.heading, climb: dir.climb, kind: w.projectile });
}

/**
 * A trigger pull's or a burst's next shot, and with a mount whose barrels
 * fire together, one from each of the others too, out of the same burst.
 */
function volley(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity, mount: Mount | undefined, w: WeaponDef = armed.weapon, at?: Spot): void {
  // A ring of shots all round (WeaponDef.nova): the Leviathan's spines, each flying at the nearest enemy its way, if there is one.
  if (w.nova) {
    const t = world.req(e, Transform);
    const faction = world.req(e, Faction).id;
    const slice = (Math.PI * 2) / w.nova;
    const reach = w.range * NOVA_REACH;
    // Every enemy unit in reach, and its bearing (in heading terms) and distance.
    const near: { x: number; z: number; a: number; d: number }[] = [];
    ctx.grid.forEachNear(t.x, t.z, reach, (other, d2) => {
      if (world.get(other, Targetable)?.kind !== 'unit' || !ctx.sides.hostile(faction, world.req(other, Faction).id)) return;
      const m = world.get(other, Mover);
      if (m && MOVE_RULES[m.move].flies) return;
      const ot = world.req(other, Transform);
      near.push({ x: ot.x, z: ot.z, a: D.atan2(-(ot.z - t.z), ot.x - t.x), d: Math.sqrt(d2) });
    });
    for (let k = 0; k < w.nova; k++) {
      const a = t.heading + k * slice;
      let best: { x: number; z: number; d: number } | null = null;
      for (const o of near) if (Math.abs(wrapAngle(o.a - a)) <= slice * NOVA_SEEK && (!best || o.d < best.d)) best = o;
      const at = best ?? { x: t.x + D.cos(a) * w.range * 0.9, z: t.z - D.sin(a) * w.range * 0.9 };
      fire(world, ctx, e, armed, target, mount, w, { x: at.x, z: at.z });
    }
    return;
  }
  fire(world, ctx, e, armed, target, mount, w, at);
  if (mount?.salvo !== 'together') return;
  for (let k = 1; k < mount.muzzles.length && armed.burstLeft > 0; k++) {
    fire(world, ctx, e, armed, target, mount, w, at);
    armed.burstLeft--;
  }
}

/** How far past its range a nova shot reaches for an enemy, and how wide either side of its own line it looks, in slices. */
const NOVA_REACH = 1.3;
const NOVA_SEEK = 1.5;

/** Move `from` toward `to` by at most `step`. */
function approach(from: number, to: number, step: number): number {
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step);
}

interface Spot {
  x: number;
  z: number;
}

/** How long before it's ready to fire a screening weapon starts aiming for a screen. */
const SCREEN_LOOK = 0.8;
/** How close to the enemy a frontline ally has to be for a screen to go down on it. */
const SCREEN_NEAR = 22;
/** How far out in front of that ally, towards the enemy, the canister is aimed. */
const SCREEN_AHEAD = 2.5;

/**
 * Where a screening weapon's canister should land (WeaponDef.screens): just
 * in front of the frontline ally, within its reach, that's closest to an
 * enemy unit, if one's within SCREEN_NEAR of it and it isn't already in
 * its side's haze. Null if none is (and it shoots at enemies as usual).
 */
function screenSpot(world: World, ctx: SimContext, e: Entity): Spot | null {
  const t = world.req(e, Transform);
  const armed = world.req(e, Armed);
  const faction = world.req(e, Faction).id;
  const reach = armed.weapon.range;
  let best: { x: number; z: number; fx: number; fz: number; d: number } | null = null;
  ctx.grid.forEachNear(t.x, t.z, reach, (other) => {
    if (other === e || world.get(other, Unit)?.def.role !== 'frontline') return;
    const f = world.get(other, Faction);
    if (!f || !ctx.sides.allied(faction, f.id)) return;
    const ot = world.req(other, Transform);
    const from = D.hypot(ot.x - t.x, ot.z - t.z);
    if (from > reach || from < armed.weapon.minRange + SCREEN_AHEAD) return;
    if (ctx.smoke.ownAt(ctx, ot.x, ot.z, faction)) return;
    let foe: { x: number; z: number; d: number } | null = null;
    ctx.grid.forEachNear(ot.x, ot.z, SCREEN_NEAR, (o) => {
      const of = world.get(o, Faction);
      if (!of || !world.has(o, Unit) || !ctx.sides.hostile(faction, of.id)) return;
      const tt = world.req(o, Transform);
      const d = D.hypot(tt.x - ot.x, tt.z - ot.z);
      if (d < SCREEN_NEAR && (!foe || d < foe.d)) foe = { x: tt.x, z: tt.z, d };
    });
    const near = foe as { x: number; z: number; d: number } | null;
    if (near && (!best || near.d < best.d)) best = { x: ot.x, z: ot.z, fx: near.x, fz: near.z, d: near.d };
  });
  const b = best as { x: number; z: number; fx: number; fz: number; d: number } | null;
  if (!b) return null;
  const ahead = Math.min(SCREEN_AHEAD, b.d * 0.5) / (b.d || 1);
  return { x: b.x + (b.fx - b.x) * ahead, z: b.z + (b.fz - b.z) * ahead };
}

const screenRounds = new Map<WeaponDef, WeaponDef>();
/** A screening weapon's canister for its own side: harmless, and a wider cloud. */
function screenRound(w: WeaponDef): WeaponDef {
  let round = screenRounds.get(w);
  if (!round) screenRounds.set(w, (round = { ...w, damage: 0, splash: w.screens ?? w.splash }));
  return round;
}

/** A screening weapon turning to, and lobbing a canister at, a spot by its own side's tanks (see screenSpot). */
function lobScreen(world: World, ctx: SimContext, e: Entity, armed: Armed, mount: Mount | undefined, at: Spot, dt: number): void {
  const t = world.req(e, Transform);
  const desired = D.atan2(-(at.z - t.z), at.x - t.x);
  armed.aim = armed.turret ? turnToward(armed.aim, desired, armed.turnRate * dt) : t.heading;
  if (armed.cooldown > 0 || Math.abs(wrapAngle(desired - armed.aim)) >= AIM_TOLERANCE) return;
  fire(world, ctx, e, armed, e, mount, screenRound(armed.weapon), at);
  armed.firedAt = world.time;
  armed.firedOn = null;
  armed.cooldown = armed.weapon.cooldown;
}

/** How closely a melee weapon must face its target to strike, radians: a blow lands on what it's up against. */
const MELEE_TOLERANCE = 0.6;

/**
 * Aims turrets (or hulls), manages cooldowns and bursts, and launches
 * projectiles (or lands blows, for melee weapons: see melee.ts), for every
 * weapon a unit or building has: its main one and any on mounts of their own.
 */
export function weaponSystem(ctx: SimContext): System {
  return {
    name: 'weapons',
    update(world, dt) {
      for (const e of world.query(Armed, Transform)) {
        if (world.has(e, Construction)) continue;
        operate(world, ctx, e, world.req(e, Armed), dt, true);
        const arsenal = world.get(e, Arsenal);
        if (arsenal) for (const armed of arsenal.arms) operate(world, ctx, e, armed, dt, false);
      }
    },
  };
}

/**
 * One weapon's tick. Only the main weapon turns a turret-less unit's body
 * to aim, and only its trigger pulls use up an aircraft's ammunition; a
 * fixed weapon on a mount of its own fires when the body happens to face
 * its target.
 */
function operate(world: World, ctx: SimContext, e: Entity, armed: Armed, dt: number, main: boolean): void {
  const t = world.req(e, Transform);
  armed.cooldown -= dt * reloadPace(world, armed);

  const mount = mountFor(world, e, armed);
  // A smoke truck about to fire lobs its canister onto its own side's tanks closing on the enemy, if any are (WeaponDef.screens).
  if (main && armed.weapon.screens && armed.cooldown <= SCREEN_LOOK && armed.burstLeft === 0) {
    const screen = screenSpot(world, ctx, e);
    if (screen) {
      lobScreen(world, ctx, e, armed, mount, screen, dt);
      return;
    }
  }
  const target = armed.target !== null && world.has(armed.target, Targetable) ? armed.target : null;
  if (target === null) {
    armed.burstLeft = 0;
    // Turrets drift back to face forward when idle, and barrels settle back to rest.
    armed.aim = armed.turret ? turnToward(armed.aim, t.heading, armed.turnRate * dt) : t.heading;
    if (mount?.pivot) armed.elev = approach(armed.elev, mount.rest ?? 0, ELEV_RATE * dt);
    return;
  }

  const tt = world.req(target, Transform);
  const desired = D.atan2(-(tt.z - t.z), tt.x - t.x);
  if (armed.turret) {
    armed.aim = turnToward(armed.aim, desired, armed.turnRate * dt);
    // A head on a neck turns only so far either side of the nose (Mount.yaw): past that it waits for the body to come round.
    if (mount?.yaw !== undefined) {
      const off = wrapAngle(armed.aim - t.heading);
      if (Math.abs(off) > mount.yaw) armed.aim = t.heading + Math.sign(off) * mount.yaw;
    }
  } else {
    // Turret-less units turn the whole body once they've stopped to shoot.
    const mover = world.get(e, Mover);
    // Planes can only aim by flying at it (see Mover.cruise).
    if (main && (!mover || (mover.targetX === null && !mover.cruise))) t.heading = turnToward(t.heading, desired, armed.turnRate * dt);
    armed.aim = t.heading;
  }

  // Barrels pitch toward the target as the turret comes round.
  const pitch = mount ? elevationFor(world, e, mount, armed, desired, target) : null;
  if (pitch && mount?.pivot) armed.elev = approach(armed.elev, pitch.elev, ELEV_RATE * dt);

  if (armed.burstLeft > 0) {
    armed.burstTimer -= dt;
    if (armed.burstTimer <= 0) {
      armed.burstLeft--;
      if (armed.weapon.melee) strike(world, ctx, e, armed, target);
      else volley(world, ctx, e, armed, target, mount);
      armed.burstTimer = armed.weapon.burstGap;
    }
    return;
  }

  const melee = armed.weapon.melee;
  const d = distanceToTarget(world, e, target);
  const inRange = d <= effectiveRange(world, e, armed, target) && d >= armed.weapon.minRange;
  const tolerance = melee ? MELEE_TOLERANCE : AIM_TOLERANCE;
  const aligned = Math.abs(wrapAngle(desired - armed.aim)) < tolerance && (!pitch || Math.abs(armed.elev - pitch.elev) < ELEV_TOLERANCE);
  if (armed.cooldown <= 0 && inRange && aligned && !world.get(e, Ammo)?.rearming) {
    // A blow: no barrels to bear and nothing in the way of what it's touching (see melee.ts).
    if (melee) {
      armed.burstLeft = armed.weapon.burst - 1;
      strike(world, ctx, e, armed, target);
      armed.firedAt = world.time;
      armed.firedOn = world.get(target, Faction)?.id ?? null;
      armed.burstTimer = armed.weapon.burstGap;
      armed.cooldown = armed.weapon.cooldown;
      return;
    }
    // Barrels that can't dip (or lift) far enough to bear hold fire too, and the AI moves the unit to where they can.
    if (pitch && !pitch.reach) {
      armed.blocked = true;
      return;
    }
    // Direct fire holds while a building or the ground is in the way; the AI looks for a better spot.
    if (!armed.weapon.arc && !armed.weapon.orbital && armed.weapon.projectile !== 'flame') {
      const muzzle = weaponMuzzle(world, e, armed, armed.aim, armed.elev, armed.shot, ctx);
      armed.blocked = !clearShot(world, ctx, muzzle, target, e, world.req(e, Faction).id, FIRE_ROOM);
      if (armed.blocked) return;
    }
    // A magnet crane throws wrecks, and with none in reach it can't (see lodestar.ts).
    // The bigger the heap round it, the heavier what it throws.
    let heft = 1;
    if (armed.weapon.flings !== undefined) {
      const t = world.req(e, Transform);
      heft = scrapHeft(ctx.wreckage.massNear(t.x, t.z, SCRAP_REACH));
      if (ctx.wreckage.take(t.x, t.z, SCRAP_REACH, armed.weapon.flings) < armed.weapon.flings * 0.5) {
        armed.cooldown = 1;
        return;
      }
    }
    // A heavy round for armour (guard towers' AP shells): one shot on its own, slower cooldown.
    const round = volleyWeapon(armed.weapon, world.get(target, Health)?.armor ?? 0);
    const w = heft === 1 ? round : { ...round, damage: round.damage * heft };
    armed.burstLeft = w.burst - 1;
    volley(world, ctx, e, armed, target, mount, w);
    armed.firedAt = world.time;
    armed.firedOn = world.get(target, Faction)?.id ?? null;
    // Aircraft that carry only so much go home to rearm once it's spent (see Ammo).
    const ammo = main ? world.get(e, Ammo) : undefined;
    if (ammo && --ammo.left <= 0) ammo.rearming = true;
    armed.burstTimer = w.burstGap;
    armed.cooldown = w.cooldown;
  }
}
