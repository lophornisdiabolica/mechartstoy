import { Entity, System, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Ai, Ammo, Armed, Building, Collider, Construction, Faction, Health, Mover, Targetable, Transform, Unit } from '../components';
import { damageThrough } from './projectiles';
import { aimPoint, clearShot, elevationFor, mountFor, Point3, weaponMuzzle } from '../lineOfFire';
import { pivotHeight } from '../mounts';
import { SimContext } from '../context';
import type { WeaponDef } from '../units';
import * as D from '../../core/dmath';
import { doctrineOf } from '../doctrines';
import { UnitId } from '../units';

const RETARGET_INTERVAL = 0.5;
/** Buildings count as this much further away, so units shoot units first. Siege units invert it. */
const BUILDING_PENALTY = 8;
/**
 * Targets a weapon is wasted on count as up to this much further away, so
 * each weapon goes for what it's good against: rifles shoot infantry rather
 * than sparking off tanks, and AT rockets go for vehicles rather than
 * spending a whole rocket on one soldier. See hitWorth.
 */
const WASTE_PENALTY = 10;
/** A hunted gun counts as this much nearer to its hunters. */
const HUNT_PULL = 20;
/** Extra range per world unit of height above the target, as a fraction of the weapon's range, and the most it can add. */
const HEIGHT_RANGE_PER_UNIT = 0.03;
const HEIGHT_RANGE_MAX = 0.15;

/** Whether a weapon that hits `targets` can shoot at this entity (aircraft need an anti-air weapon). */
export function canHit(world: World, armed: Armed, target: Entity): boolean {
  const m = world.get(target, Mover);
  const air = m !== undefined && MOVE_RULES[m.move].flies;
  return armed.weapon.targets === 'both' || (armed.weapon.targets === 'air') === air;
}

/**
 * A weapon's reach against a target: its range, plus up to 15% from higher
 * ground (3% per unit of height above the target). Shooting uphill costs
 * nothing extra; the low side just can't reach as far as the high side.
 */
export function effectiveRange(world: World, e: Entity, armed: Armed, target: Entity): number {
  const dh = world.req(e, Transform).y - world.req(target, Transform).y;
  return armed.weapon.range * (1 + Math.max(0, Math.min(HEIGHT_RANGE_MAX, dh * HEIGHT_RANGE_PER_UNIT)));
}

/**
 * How much of a weapon's hit counts against a target, 0 to 1: what gets
 * through its armour, and no more than the target can take (a rocket that
 * kills a soldier with half its damage wasted half of it).
 */
export function hitWorth(world: World, armed: Armed, target: Entity): number {
  const h = world.get(target, Health);
  if (!h) return 1;
  const w = volleyWeapon(armed.weapon, h.armor);
  if (w.damage <= 0) return 1;
  return Math.min(damageThrough(w.damage, h.armor, w.pierce ?? 0), h.max) / w.damage;
}

/** The round a weapon fires at a target with this much armour: its heavy round if it has one and the armour calls for it (see WeaponDef.heavy). */
export function volleyWeapon(weapon: WeaponDef, armor: number): WeaponDef {
  return weapon.heavy && armor >= (weapon.heavyAt ?? 0) ? weapon.heavy : weapon;
}

/** How many of the best-scoring targets to check for a clear shot before settling for one behind cover. */
const SIGHT_CHECKS = 3;

/**
 * Muzzle position for a shot at `target`, with the weapon swung round to
 * face it and its barrels pitched to bear, or null if they can't pitch
 * far enough (see elevationFor).
 */
function muzzleToward(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity): Point3 | null {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const aim = D.atan2(-(tt.z - t.z), tt.x - t.x);
  const mount = mountFor(world, e);
  const pitch = mount ? elevationFor(world, e, mount, armed, aim, target) : null;
  if (pitch && !pitch.reach) return null;
  return weaponMuzzle(world, e, armed, aim, pitch?.elev ?? armed.elev, armed.shot, ctx);
}

/**
 * The best enemy in sight: closest first, buildings after units (before,
 * for siege units), and ones the weapon is wasted on later (see hitWorth). Direct-fire weapons prefer one they have a clear shot
 * at; if none of the best few is in the open, they take the best anyway
 * and are marked blocked (see Armed.blocked).
 */
function findTarget(world: World, ctx: SimContext, e: Entity, armed: Armed, spotters: Spotter[]): Entity | null {
  const t = world.req(e, Transform);
  const faction = world.req(e, Faction).id;
  const candidates: { e: Entity; score: number }[] = [];
  // A weapon that outranges its own sight can use an allied spotter's eyes for the difference.
  const ours = armed.weapon.range > armed.sight ? spotters.filter((s) => ctx.sides.allied(s.faction, faction) && D.hypot(s.x - t.x, s.z - t.z) < s.radius + armed.weapon.range) : [];
  const reach = ours.length > 0 ? armed.weapon.range : armed.sight;
  // Walkers step over walls and spiders climb them, so they don't waste shots on them (see MoveRules.over).
  const over = MOVE_RULES[world.get(e, Mover)?.move ?? 'tracked'].over;
  // A squad hunting a gun shoots it before anything else in reach (see commander/hunts.ts).
  const squad = world.get(e, Ai)?.squad;
  const hunt = squad !== undefined ? ctx.commander.hunts.forSquad(squad) : undefined;
  const prey = hunt && hunt.side === faction ? hunt.gun : null;
  // Engineers at work on a way across and the other side's engineers leave each other be (see Engineers.onCrossing).
  const engineers = ctx.commander.engineers;
  const builder = world.get(e, Unit)?.def.builds === true;
  const crossing = builder && engineers.onCrossing(e);
  ctx.grid.forEachNear(t.x, t.z, reach, (other, d2, body) => {
    if (over !== 'none' && body.building?.def.low) return;
    const otherFaction = world.req(other, Faction).id;
    // Only enemies; nobody aims at the civilian town (it only suffers stray fire).
    if (!ctx.sides.hostile(faction, otherFaction)) return;
    if (builder && world.get(other, Unit)?.def.builds === true && (crossing || engineers.onCrossing(other))) return;
    if (!canHit(world, armed, other)) return;
    const d = Math.sqrt(d2);
    if (d < armed.weapon.minRange) return;
    if (d > armed.sight) {
      const ot = world.req(other, Transform);
      if (!ours.some((s) => D.sq(s.x - ot.x) + D.sq(s.z - ot.z) <= s.radius * s.radius)) return;
    }
    const isBuilding = world.req(other, Targetable).kind === 'building';
    const waste = WASTE_PENALTY * (1 - hitWorth(world, armed, other));
    candidates.push({ e: other, score: d + waste + (isBuilding ? (armed.siege ? -BUILDING_PENALTY * 3 : BUILDING_PENALTY) : 0) - (other === prey ? HUNT_PULL : 0) });
  });
  armed.blocked = false;
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.score - b.score || a.e - b.e);
  if (armed.weapon.arc || armed.weapon.projectile === 'flame') return candidates[0].e;
  for (const c of candidates.slice(0, SIGHT_CHECKS)) {
    const muzzle = muzzleToward(world, ctx, e, armed, c.e);
    if (muzzle && clearShot(world, ctx, muzzle, c.e, e, faction)) return c.e;
  }
  armed.blocked = true;
  return candidates[0].e;
}

/** How far a firing spot's line of fire has to clear buildings by, so scattered shots don't hit them. */
const SPOT_ROOM = 0.9;
/** Bearings (radians either side of the line from the target to the unit) tried when looking for a firing spot. */
const SPOT_ANGLES = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4];

/**
 * A spot near the unit with a clear shot at its target: on a ring round the
 * target at a bit inside weapon range, starting from the unit's own side
 * and working round. Null if there's none (the unit then just closes in).
 */
export function firingSpot(world: World, ctx: SimContext, e: Entity, armed: Armed, target: Entity): { x: number; z: number } | null {
  const mover = world.get(e, Mover);
  if (!mover) return null;
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const faction = world.req(e, Faction).id;
  const grid = ctx.navs.for(mover.move);
  const radius = world.get(e, Collider)?.radius ?? 0.5;
  const dist = D.hypot(t.x - tt.x, t.z - tt.z);
  const ring = Math.max(armed.weapon.minRange + 1, Math.min(dist, armed.weapon.range * 0.7));
  const base = D.atan2(t.z - tt.z, t.x - tt.x);
  const mount = mountFor(world, e);
  for (const da of SPOT_ANGLES) {
    const a = base + da;
    const x = tt.x + D.cos(a) * ring;
    const z = tt.z + D.sin(a) * ring;
    if (!grid.terrainAllowsAt(x, z) || !grid.fitsAt(x, z, radius)) continue;
    const ground = grid.rules.flies ? t.y : ctx.field.surfaceAt(x, z);
    const from = { x, y: ground + (mount ? pivotHeight(mount) : armed.weapon.muzzleHeight), z };
    // Not perched so high above it (or so far below) that the barrels can't pitch to bear.
    if (mount?.elev && !armed.weapon.arc) {
      const climb = D.atan2(aimPoint(world, target).y - from.y, ring);
      if (climb < mount.elev[0] || climb > mount.elev[1]) continue;
    }
    if (clearShot(world, ctx, from, target, e, faction, SPOT_ROOM)) return { x, z };
  }
  return null;
}

/** Something that spots for its side's long-range weapons (see BuildingDef.spots and UnitDef.spots). */
interface Spotter {
  x: number;
  z: number;
  radius: number;
  faction: number;
}

/** Every spotter on the field this tick: finished buildings and live units with a spotting radius. */
function spotters(world: World, ctx: SimContext): Spotter[] {
  const out: Spotter[] = [];
  for (const e of world.query(Building, Transform, Faction)) {
    const radius = world.req(e, Building).def.spots;
    if (radius && !world.has(e, Construction)) out.push({ ...xz(world, e), radius, faction: world.req(e, Faction).id });
  }
  for (const e of world.query(Unit, Transform, Faction)) {
    const def = world.req(e, Unit).def;
    const faction = world.req(e, Faction).id;
    // Some doctrines have units spot that don't for anyone else (Bastion's scout copters).
    const radius = def.spots ?? (faction >= 0 ? doctrineOf(ctx, faction).spotters?.[def.id as UnitId] : undefined);
    if (radius) out.push({ ...xz(world, e), radius, faction });
  }
  return out;
}

function xz(world: World, e: Entity): { x: number; z: number } {
  const t = world.req(e, Transform);
  return { x: t.x, z: t.z };
}

/**
 * Every armed entity (units and towers) picks the best enemy in sight, or
 * (for weapons that outrange their sight) spotted by an ally.
 */
export function targetingSystem(ctx: SimContext): System {
  return {
    name: 'targeting',
    update(world) {
      const spotting = spotters(world, ctx);
      for (const e of world.query(Armed, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const armed = world.req(e, Armed);
        // A dead target triggers an immediate re-think; otherwise re-think on a timer.
        if (armed.target !== null && !world.has(armed.target, Targetable)) {
          armed.target = null;
          armed.nextTargetAt = world.time;
        }
        if (world.time < armed.nextTargetAt) continue;
        armed.nextTargetAt = world.time + RETARGET_INTERVAL;
        // Flying home to rearm: nothing to shoot with (see Ammo).
        if (world.get(e, Ammo)?.rearming && armed.burstLeft === 0) {
          armed.target = null;
          continue;
        }
        armed.target = findTarget(world, ctx, e, armed, spotting);
        const spot = armed.blocked && armed.target !== null ? firingSpot(world, ctx, e, armed, armed.target) : null;
        armed.spotX = spot?.x ?? null;
        armed.spotZ = spot?.z ?? null;
      }
    },
  };
}

/** Edge-to-edge distance from an entity to its target, so big buildings count as in range sooner. */
export function distanceToTarget(world: World, e: Entity, target: Entity): number {
  const t = world.req(e, Transform);
  const tt = world.req(target, Transform);
  const r = world.get(target, Collider)?.radius ?? 0;
  return Math.max(0, D.hypot(tt.x - t.x, tt.z - t.z) - r);
}
