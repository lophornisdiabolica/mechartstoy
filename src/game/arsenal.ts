import { Entity, World } from '../core/ecs';
import { Armed, Arsenal } from './components';
import type { UnitDef, WeaponDef } from './units';
import type { BuildingDef } from './buildings';

/*
 * A unit's weapons, all of them: its main one (Armed) and any on mounts of
 * their own (Arsenal, see UnitDef.mounts). Systems that care about "is it
 * fighting", "how strong is it" or "can it shoot aircraft" ask here, so a
 * unit with a cannon and a roof machine gun counts both.
 */

/** Every weapon a unit or building type carries, main one first. */
export function weaponsOf(def: Pick<UnitDef, 'weapon' | 'mounts'> | Pick<BuildingDef, 'weapon' | 'mounts'>): WeaponDef[] {
  const out: WeaponDef[] = def.weapon ? [def.weapon] : [];
  if (def.mounts) for (const m of def.mounts) out.push(m.weapon);
  return out;
}

/** Calls `fn` with each of an entity's weapons, main one first (none if it's unarmed). */
export function forEachArm(world: World, e: Entity, fn: (armed: Armed, slot: number) => void): void {
  const main = world.get(e, Armed);
  if (main) fn(main, 0);
  const arsenal = world.get(e, Arsenal);
  if (arsenal) for (let k = 0; k < arsenal.arms.length; k++) fn(arsenal.arms[k], k + 1);
}

/** An entity's weapons, main one first. */
export function armsOf(world: World, e: Entity): Armed[] {
  const main = world.get(e, Armed);
  const arsenal = world.get(e, Arsenal);
  if (!arsenal) return main ? [main] : [];
  return main ? [main, ...arsenal.arms] : [...arsenal.arms];
}

/** The last time any of an entity's weapons fired (-Infinity if none ever has). */
export function lastFired(world: World, e: Entity): number {
  let at = world.get(e, Armed)?.firedAt ?? -Infinity;
  const arsenal = world.get(e, Arsenal);
  if (arsenal) for (const a of arsenal.arms) if (a.firedAt > at) at = a.firedAt;
  return at;
}

/** Whether any of an entity's weapons has a target. */
export function engaged(world: World, e: Entity): boolean {
  if (world.get(e, Armed)?.target != null) return true;
  const arsenal = world.get(e, Arsenal);
  return arsenal !== undefined && arsenal.arms.some((a) => a.target !== null);
}

/** Whether any of a type's weapons can shoot aircraft. */
export function hitsAir(weapons: readonly WeaponDef[]): boolean {
  return weapons.some((w) => w.targets !== 'ground');
}

/** Whether an entity's main weapon is a melee one: it fights by closing to contact (see MeleeDef). */
export function fightsHandToHand(world: World, e: Entity): boolean {
  return world.get(e, Armed)?.weapon.melee !== undefined;
}

/** Whether any of an entity's weapons can shoot aircraft. */
export function shootsAir(world: World, e: Entity): boolean {
  if (world.get(e, Armed)?.weapon.targets !== 'ground' && world.has(e, Armed)) return true;
  const arsenal = world.get(e, Arsenal);
  return arsenal !== undefined && arsenal.arms.some((a) => a.weapon.targets !== 'ground');
}
