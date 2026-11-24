import { Entity, World } from '../core/ecs';
import { Armed, Arsenal, Targetable, Transform, Unit } from './components';
import { distanceToTarget, effectiveRange } from './systems/targeting';
import { wrapAngle } from './systems/movement';
import * as D from '../core/dmath';

/*
 * Weapons that point different ways, brought to bear in turn
 * (UnitDef.alternates, WeaponDef.faces). A unit with fixed weapons facing
 * off its nose at different bearings, like the Leviathan's fire breath in
 * front and tail whip behind, can only use one at a time: it picks the one
 * that will be ready soonest (not the one it just used, if another is close
 * to ready), stops, and swings its whole body round so that weapon points
 * at its target, then once that has gone off, swings round for the next.
 * What a watcher sees is the creature breathing fire, wheeling round to
 * lash its tail, and wheeling back.
 *
 * Only weapons with a `faces` bearing take part (the main weapon and any on
 * mounts of their own); the rest fire as usual whenever they bear.
 */

/** What a unit is presenting: the weapon, its target, and the heading the body should come round to. */
export interface Presenting {
  armed: Armed;
  target: Entity;
  /** The world heading that brings the weapon to bear on its target. */
  heading: number;
  /** Whether the target is close enough for it, so the unit should stop and turn rather than close in. */
  inReach: boolean;
}

/** Seconds of head start a weapon gets over the one that went off last: enough that they take turns. */
const TURN_ABOUT = 1.2;
/** A weapon whose target is this much further than its reach isn't worth turning for. */
const WORTH = 1.6;

/** The weapons that take part in turning about (see UnitDef.alternates): main first, then mounts. */
function contenders(world: World, e: Entity): Armed[] {
  const out: Armed[] = [];
  const main = world.get(e, Armed);
  if (main && main.weapon.faces !== undefined) out.push(main);
  const arsenal = world.get(e, Arsenal);
  if (arsenal) for (const a of arsenal.arms) if (a.weapon.faces !== undefined) out.push(a);
  return out;
}

/**
 * Which weapon a unit that alternates should be bringing to bear now, and
 * which way to face for it; null if it doesn't alternate or none of its
 * weapons has a target near enough to turn for.
 */
export function presenting(world: World, e: Entity): Presenting | null {
  const def = world.get(e, Unit)?.def;
  if (!def?.alternates) return null;
  const t = world.req(e, Transform);
  const arms = contenders(world, e);
  if (arms.length === 0) return null;
  // The one that went off last waits its turn, unless nothing else is near ready.
  let last: Armed | null = null;
  for (const a of arms) if (a.firedAt > -Infinity && (!last || a.firedAt > last.firedAt)) last = a;
  let best: { armed: Armed; target: Entity; score: number; d: number; reach: number } | null = null;
  for (const a of arms) {
    const target = a.target !== null && world.has(a.target, Targetable) ? a.target : null;
    if (target === null) continue;
    const d = distanceToTarget(world, e, target);
    const reach = effectiveRange(world, e, a, target);
    if (d > reach * WORTH + 2) continue;
    const score = Math.max(0, a.cooldown) + (a === last && arms.length > 1 ? TURN_ABOUT : 0) + (d > reach ? 0.5 : 0);
    if (!best || score < best.score - 1e-9) best = { armed: a, target, score, d, reach };
  }
  if (!best) return null;
  const tt = world.req(best.target, Transform);
  const bearing = D.atan2(-(tt.z - t.z), tt.x - t.x);
  return { armed: best.armed, target: best.target, heading: wrapAngle(bearing - (best.armed.weapon.faces ?? 0)), inReach: best.d <= best.reach * 0.95 };
}
