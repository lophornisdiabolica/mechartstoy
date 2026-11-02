import { Entity, System, World } from '../core/ecs';
import { Ai, Armed, Faction, Guard, Health, Transform, Unit } from './components';
import { SimContext } from './context';
import { canBuild, countByCategory } from './caps';
import { spawnSpot } from './systems/production';
import { spawnUnit } from './spawn';
import { UnitId } from './units';

/**
 * Territory and healing. A side's territory is its base and the ground round
 * each outpost it holds (allies share theirs). Units resting in friendly
 * territory, ones that haven't fired or been hit for a while, slowly repair,
 * and an infantry squad that's lost soldiers gets them back one at a time:
 * the new soldier turns up with the squad rather than walking out from the
 * base. It helps the small units most, which tend to come home as half a
 * squad rather than one big damaged hull.
 */

/** Seconds without firing or being hit before a unit counts as resting. */
export const REST_TIME = 10;
/** Share of its health a resting unit gets back per second. */
export const HEAL_RATE = 0.015;
/** Seconds between replacement soldiers for a resting squad. */
export const REFILL_INTERVAL = 8;
/** How far round a held outpost its territory reaches. */
export const OUTPOST_TERRITORY = 16;
/** Base territory as a multiple of the base pad's radius. */
const BASE_TERRITORY = 1.25;
/** Seconds between territory checks. */
const TICK = 0.5;

/** An infantry squad as it was raised: what to refill it with. */
export interface SquadRoster {
  faction: number;
  units: UnitId[];
  /** Sim time the next replacement is due while the squad rests, or null while it isn't resting. */
  refillAt: number | null;
}

/** Remember an infantry squad's line-up so it can be refilled (see territorySystem). */
export function recordSquad(ctx: SimContext, squad: number, faction: number, units: UnitId[]): void {
  if (units.length > 1 && units.every((u) => ctx.units[u].category === 'infantry')) ctx.rosters.set(squad, { faction, units, refillAt: null });
}

/** Whether (x, z) is in a side's own or an ally's territory. */
export function inTerritory(ctx: SimContext, faction: number, x: number, z: number): boolean {
  const { sides } = ctx;
  for (const site of ctx.field.baseSites) {
    if (sides.eliminated[site.faction] || !sides.allied(site.faction, faction)) continue;
    const r = site.radius * BASE_TERRITORY;
    if ((x - site.x) ** 2 + (z - site.z) ** 2 <= r * r) return true;
  }
  for (const o of ctx.outposts) {
    if (o.owner < 0 || !sides.allied(o.owner, faction)) continue;
    if ((x - o.x) ** 2 + (z - o.z) ** 2 <= OUTPOST_TERRITORY ** 2) return true;
  }
  return false;
}

/** Whether a unit is resting: hasn't fired or been hit for REST_TIME. */
export function resting(world: World, e: Entity): boolean {
  const last = Math.max(world.get(e, Health)?.hurtAt ?? -Infinity, world.get(e, Armed)?.firedAt ?? -Infinity);
  return world.time - last >= REST_TIME;
}

/** Heals resting units in friendly territory and refills resting infantry squads there. */
export function territorySystem(ctx: SimContext): System {
  let acc = 0;
  return {
    name: 'territory',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      // Squads whose living members are all resting in territory, and one member of each to spawn beside.
      const members = new Map<number, { alive: Map<UnitId, number>; settled: boolean; anchor: Entity }>();
      for (const e of world.query(Unit, Health, Faction, Transform)) {
        if (world.has(e, Guard)) continue;
        const faction = world.req(e, Faction).id;
        const t = world.req(e, Transform);
        const calm = resting(world, e) && inTerritory(ctx, faction, t.x, t.z);
        if (calm) {
          const h = world.req(e, Health);
          if (h.hp > 0) h.hp = Math.min(h.max, h.hp + h.max * HEAL_RATE * step);
        }
        const squad = world.get(e, Ai)?.squad;
        if (squad === undefined || !ctx.rosters.has(squad)) continue;
        let m = members.get(squad);
        if (!m) members.set(squad, (m = { alive: new Map(), settled: true, anchor: e }));
        const id = world.req(e, Unit).def.id as UnitId;
        m.alive.set(id, (m.alive.get(id) ?? 0) + 1);
        m.settled &&= calm;
      }
      let counts: ReturnType<typeof countByCategory> | null = null;
      for (const [squad, roster] of ctx.rosters) {
        const m = members.get(squad);
        // A squad that's been wiped out is gone for good.
        if (!m) {
          ctx.rosters.delete(squad);
          continue;
        }
        const missing = roster.units.find((u) => {
          const left = m.alive.get(u) ?? 0;
          if (left > 0) m.alive.set(u, left - 1);
          return left <= 0;
        });
        if (!missing || !m.settled) {
          roster.refillAt = null;
          continue;
        }
        if (roster.refillAt === null) roster.refillAt = world.time + REFILL_INTERVAL;
        if (world.time < roster.refillAt) continue;
        roster.refillAt = world.time + REFILL_INTERVAL;
        counts ??= countByCategory(world, ctx.sides.count);
        const def = ctx.units[missing];
        if (!canBuild(ctx, counts, roster.faction, def)) continue;
        const at = world.req(m.anchor, Transform);
        const spot = spawnSpot(ctx, at.x + ctx.rng.range(-1, 1), at.z + ctx.rng.range(-1, 1), def.radius);
        if (!spot) continue;
        spawnUnit(world, ctx, def, roster.faction, spot.x, spot.z, squad);
        counts[roster.faction][def.category]++;
      }
    },
  };
}
