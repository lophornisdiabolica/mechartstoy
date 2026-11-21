import { Entity, System, World } from '../core/ecs';
import { Construction, Faction, Hit, Shield, Transform } from './components';
import { SimContext } from './context';
import type { ShieldDef } from './units';
import * as D from '../core/dmath';

/*
 * Energy domes (Aegis). A dome is a sphere round its emitter (a dome
 * truck, the Citadel walker, the shield pylon) that stops direct fire and
 * missiles coming in from outside it (the part above ground, which reaches
 * right down to it downhill as well as up): they burst on its skin, and it soaks
 * up their damage until it collapses. After a while it comes back, weaker,
 * and builds back up while nothing hits it. Shots from inside go out freely,
 * so the army under it fights on, and lobbed shells and flame fall straight
 * through it, which is how artillery, mortars and Firestorm crack an Aegis
 * push. It's a line-of-fire obstacle with hit points (see lineOfFire.ts).
 *
 * What a watcher sees: a pale bubble walking up the field, rippling where
 * shots burst on it, breathing pink as it weakens, and bursting when it goes.
 */

/** A dome that's up this tick, for line of fire (see Domes). */
export interface Dome {
  entity: Entity;
  x: number;
  y: number;
  z: number;
  radius: number;
  faction: number;
}

/** Share of its strength a collapsed dome comes back with. */
const COMES_BACK = 0.35;

/** A fresh dome for an emitter. */
export function makeShield(def: ShieldDef): Shield {
  return { def, hp: def.hp, downUntil: -Infinity, hitAt: -Infinity };
}

/** Every dome up this tick. Rebuilt each tick by shieldSystem, so a battle with no Aegis side has an empty list and pays nothing. */
export class Domes {
  list: Dome[] = [];

  /** The dome of this emitter, if it's up. */
  of(entity: Entity): Dome | undefined {
    return this.list.find((d) => d.entity === entity);
  }

  /** Whether a point is under a dome of this side or an ally's. */
  covers(ctx: SimContext, x: number, y: number, z: number, faction: number): boolean {
    for (const d of this.list) {
      if (ctx.sides.allied(d.faction, faction) && D.sq(x - d.x) + D.sq(y - d.y) + D.sq(z - d.z) < d.radius * d.radius) return true;
    }
    return false;
  }
}

/**
 * Where a straight shot from `from` (along ground direction ux, uz, climbing
 * `slope` per unit along) first enters a dome hostile to `faction` from
 * outside it, before `best` along: that distance and the dome, or null.
 */
export function domeInTheWay(
  ctx: SimContext,
  from: { x: number; y: number; z: number },
  ux: number,
  uz: number,
  slope: number,
  best: number,
  faction: number,
): { s: number; dome: Dome } | null {
  let hit: { s: number; dome: Dome } | null = null;
  for (const d of ctx.domes.list) {
    if (!ctx.sides.hostile(faction, d.faction)) continue;
    const ox = from.x - d.x;
    const oy = from.y - d.y;
    const oz = from.z - d.z;
    const c = ox * ox + oy * oy + oz * oz - d.radius * d.radius;
    // From inside: shots go out (and anything inside fights freely).
    if (c <= 0) continue;
    const a = 1 + slope * slope;
    const b = 2 * (ox * ux + oy * slope + oz * uz);
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const s = (-b - Math.sqrt(disc)) / (2 * a);
    if (s < 0.3 || s >= (hit?.s ?? best)) continue;
    hit = { s, dome: d };
  }
  return hit;
}

/** For a lobbed missile coming down at (x, z): the hostile dome it bursts on, if it lands under one it wasn't fired from inside of, and the height of the dome's skin there. */
export function domeOver(ctx: SimContext, from: { x: number; y: number; z: number }, x: number, z: number, faction: number): { dome: Dome; y: number } | null {
  for (const d of ctx.domes.list) {
    if (!ctx.sides.hostile(faction, d.faction)) continue;
    const flat2 = D.sq(x - d.x) + D.sq(z - d.z);
    if (flat2 >= d.radius * d.radius) continue;
    if (D.sq(from.x - d.x) + D.sq(from.y - d.y) + D.sq(from.z - d.z) <= d.radius * d.radius) continue;
    return { dome: d, y: d.y + Math.sqrt(d.radius * d.radius - flat2) };
  }
  return null;
}

/** A shot bursting on a dome: it soaks up the damage, and collapses if that's more than it has left. */
export function hitDome(world: World, ctx: SimContext, entity: Entity, damage: number, x: number, y: number, z: number, by: Hit | null): void {
  const shield = world.get(entity, Shield);
  if (!shield || shield.downUntil !== -Infinity) return;
  shield.hp -= damage;
  shield.hitAt = world.time;
  const faction = world.get(entity, Faction)?.id ?? -1;
  const t = world.req(entity, Transform);
  if (shield.hp > 0) {
    ctx.events.emit('shieldHit', { entity, faction, x, y, z, share: shield.hp / shield.def.hp });
    return;
  }
  shield.hp = 0;
  shield.downUntil = world.time + shield.def.downTime;
  ctx.domes.list = ctx.domes.list.filter((d) => d.entity !== entity);
  ctx.events.emit('shieldDown', { entity, faction, x: t.x, y: t.y, z: t.z, radius: shield.def.radius, by });
}

/**
 * Builds every dome back up a little (and brings collapsed ones back), and
 * lists the domes that are up for line of fire this tick.
 */
export function shieldSystem(ctx: SimContext): System {
  return {
    name: 'shields',
    update(world, dt) {
      const list: Dome[] = [];
      for (const e of world.query(Shield, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const s = world.req(e, Shield);
        if (s.downUntil !== -Infinity) {
          if (world.time < s.downUntil) continue;
          s.downUntil = -Infinity;
          s.hp = s.def.hp * COMES_BACK;
          s.hitAt = world.time;
        } else if (s.hp < s.def.hp && world.time - s.hitAt >= s.def.rest) {
          s.hp = Math.min(s.def.hp, s.hp + s.def.regen * dt);
        }
        const t = world.req(e, Transform);
        list.push({ entity: e, x: t.x, y: t.y, z: t.z, radius: s.def.radius, faction: world.req(e, Faction).id });
      }
      ctx.domes.list = list;
    },
  };
}
