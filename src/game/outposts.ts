import { Entity, System, World } from '../core/ecs';
import { Rng } from '../core/rng';
import { OutpostKind, OutpostSite } from '../world/battlefield';
import { BuildingDef, BuildingId } from './buildings';
import { Armed, Building, Construction, Faction, GARRISON, Garrison, Guard, Health, OutpostPart, Producer, Rubble, Targetable, Transform, Unit } from './components';
import { productionFor } from './doctrines';
import { SimContext } from './context';
import { spawnSpot } from './systems/production';
import { spawnBuilding, spawnUnit } from './spawn';

/**
 * Outposts: small forts in no-man's land that any side can capture. Each
 * starts held by its own garrison (towers and a bunker that keeps a few
 * guards about), which fights everyone. A side takes an outpost by having
 * units at the post with nobody defending it, and gets its bonus while it
 * holds it. Captured towers and bunkers switch sides, so the outpost then
 * defends itself for its new owner.
 */

/**
 * What holding an outpost gives, besides territory (see territory.ts) and
 * its own buildings. Each kind's effect is read where it matters:
 * production in the production system, air cap in caps.ts, readiness in
 * offensive.ts.
 */
export type OutpostBonus =
  /** Holder's production goes up by this fraction of a normal side's (0.1 = +10%), whatever its team size. */
  | { kind: 'production'; amount: number }
  /** Holder's aircraft cap goes up by this many. */
  | { kind: 'airCap'; amount: number }
  /** Holder's team gets impatient this much faster while massing for an attack (0.4 = 40% sooner), so readiness attacks set out sooner. */
  | { kind: 'readiness'; amount: number };

/**
 * A kind of outpost: what it gives its holder, and the building it has on
 * top of the usual post, two towers and a guard bunker.
 */
export interface OutpostKindDef {
  id: OutpostKind;
  name: string;
  /** What it does, for the setup screen and the inspector. */
  blurb: string;
  bonus: OutpostBonus | null;
  /** Its own building, opposite the bunker. */
  building?: BuildingId;
  /** Ruined factory: turns out one of the holder's factory batches this often (seconds, before production speed). */
  salvage?: number;
}

export const OUTPOST_KINDS: Record<OutpostKind, OutpostKindDef> = {
  supply: { id: 'supply', name: 'Supply depot', blurb: 'Faster production', bonus: { kind: 'production', amount: 0.1 } },
  airstrip: { id: 'airstrip', name: 'Airstrip', blurb: 'Room for more aircraft', bonus: { kind: 'airCap', amount: 2 }, building: 'airstrip' },
  gun: { id: 'gun', name: 'Hilltop gun', blurb: 'A long-range gun on the highest ground, firing for whoever holds it', bonus: null, building: 'bigGun' },
  relay: { id: 'relay', name: 'Comms relay', blurb: 'Attacks set out sooner, and its mast spots for the holder’s guns', bonus: { kind: 'readiness', amount: 0.4 }, building: 'relayMast' },
  fuel: { id: 'fuel', name: 'Fuel depot', blurb: 'Faster production, but its tanks blow up when destroyed', bonus: { kind: 'production', amount: 0.1 }, building: 'fuelTanks' },
  factory: { id: 'factory', name: 'Ruined factory', blurb: 'Patched up to turn out the odd vehicle for its holder', bonus: null, building: 'ruinedFactory', salvage: 75 },
};

/** Player-facing description of an outpost's bonus at a given strength (the settings' outpost bonus multiplier). */
export function describeBonus(kind: OutpostKindDef, strength: number): string {
  const pct = (v: number) => `${Math.round(v * strength * 100)}%`;
  const bonus = kind.bonus;
  const extra = kind.id === 'fuel' ? ', and its tanks blow up when destroyed' : '';
  if (!bonus) return kind.blurb;
  switch (bonus.kind) {
    case 'production':
      return `+${pct(bonus.amount)} production${extra}`;
    case 'airCap':
      return `+${Math.round(bonus.amount * strength)} aircraft`;
    case 'readiness':
      return `attacks set out ${pct(bonus.amount)} sooner`;
  }
}

/** Live state of one outpost. */
export interface Outpost {
  index: number;
  x: number;
  z: number;
  /** Who holds it: GARRISON until captured, then a side. */
  owner: number;
  /** Capture progress, 0..1, by `claimant`. */
  progress: number;
  /** The side whose team is capturing it, or -1. */
  claimant: number;
  kind: OutpostKindDef;
}

/** Units within this distance of the post count for capturing and defending it. */
export const CAPTURE_RADIUS = 10;
/** Seconds for one unit to capture an outpost; more units take less (see captureRate). */
const CAPTURE_TIME = 25;
/** Guards a bunker keeps at its outpost. */
const GUARDS = 4;
/** Seconds between guards while the bunker is under strength. */
const GUARD_INTERVAL = 12;
/** Seconds between capture checks. */
const TICK = 0.25;

/** Capture speed for `n` capturing units: a lone unit takes CAPTURE_TIME, a big group about twice as fast. */
function captureRate(n: number): number {
  return (1 + 0.25 * (Math.min(Math.max(n, 1), 6) - 1)) / CAPTURE_TIME;
}

/** Set up each outpost site's state, held by its garrison. */
export function createOutposts(sites: OutpostSite[]): Outpost[] {
  return sites.map((s) => ({ index: s.index, x: s.x, z: s.z, owner: GARRISON, progress: 0, claimant: -1, kind: OUTPOST_KINDS[s.kind] }));
}

/** An outpost's post, two towers and a bunker, laid out round the site, and its kind's own building opposite the bunker. */
export function buildOutpost(world: World, ctx: SimContext, outpost: Outpost, rng: Rng): void {
  const a = rng.range(0, Math.PI * 2);
  const at = (angle: number, dist: number) => ({ x: outpost.x + Math.cos(a + angle) * dist, z: outpost.z + Math.sin(a + angle) * dist });
  const post = spawnOutpostPart(world, ctx, ctx.buildings.outpost, outpost, outpost.x, outpost.z, -a, false);
  // The post can't be shot or destroyed: outposts change hands, they don't go away.
  world.remove(post, Health);
  world.remove(post, Targetable);
  for (const angle of [0, Math.PI]) {
    const p = at(angle, 4.6);
    spawnOutpostPart(world, ctx, ctx.buildings.tower, outpost, p.x, p.z, -(a + angle), false);
  }
  const p = at(Math.PI / 2, 4.4);
  spawnOutpostPart(world, ctx, ctx.buildings.bunker, outpost, p.x, p.z, -(a + Math.PI / 2), false);
  if (outpost.kind.building) {
    const def = ctx.buildings[outpost.kind.building];
    const q = at(-Math.PI / 2, 2.2 + def.radius);
    // Facing out, away from the post.
    spawnOutpostPart(world, ctx, def, outpost, q.x, q.z, -(a - Math.PI / 2), false);
  }
}

/** Create one of an outpost's buildings, for its current owner. */
export function spawnOutpostPart(world: World, ctx: SimContext, def: BuildingDef, outpost: Outpost, x: number, z: number, heading: number, construct: boolean): Entity {
  const e = spawnBuilding(world, ctx, def, outpost.owner, x, z, heading, construct);
  world.add(e, OutpostPart, { outpost: outpost.index });
  if (def.id === 'bunker') world.add(e, Garrison, { timer: GUARD_INTERVAL * 0.5 });
  salvageFor(world, ctx, e, outpost);
  return e;
}

/**
 * A ruined factory turns out its holder's factory batches, slowly; held by
 * its garrison it builds nothing.
 */
function salvageFor(world: World, ctx: SimContext, e: Entity, outpost: Outpost): void {
  const every = outpost.kind.salvage;
  // (A destroyed part is rubble, with no Building, until it's rebuilt.)
  if (!every || world.get(e, Building)?.def.id !== outpost.kind.building) return;
  world.remove(e, Producer);
  if (outpost.owner < 0) return;
  const table = productionFor(ctx, ctx.buildings.factory, outpost.owner)?.table;
  if (table) world.add(e, Producer, { table, interval: every, timer: every * 0.5 });
}

/** Sum of a bonus kind over the outposts a side holds, scaled by the settings. */
export function outpostBonus(ctx: SimContext, faction: number, kind: OutpostBonus['kind']): number {
  let sum = 0;
  for (const o of ctx.outposts) if (o.owner === faction && o.kind.bonus?.kind === kind) sum += o.kind.bonus.amount;
  return sum * ctx.settings.armies.outpostBonus;
}

/** Outposts a side holds. */
export function outpostsHeldBy(ctx: SimContext, faction: number): number {
  return ctx.outposts.filter((o) => o.owner === faction).length;
}

/**
 * Capturing: every TICK, count the units at each post. Defenders (the owner's
 * team, or the garrison) hold it; with no defenders and a single attacking
 * team present, that team's capture progresses, faster with more units.
 * Two attacking teams contest it and nothing moves. Progress by one team
 * has to wind back down before another can start.
 */
export function outpostSystem(ctx: SimContext): System {
  let acc = 0;
  return {
    name: 'outposts',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      const { sides } = ctx;
      for (const o of ctx.outposts) {
        // A knocked-out side's outposts go back to their garrisons.
        if (o.owner >= 0 && sides.eliminated[o.owner]) capture(world, ctx, o, GARRISON);
        let defenders = 0;
        // Attackers per side, to find who's capturing and who'll own it.
        const attackers = new Map<number, number>();
        ctx.grid.forEachNear(o.x, o.z, CAPTURE_RADIUS, (other) => {
          if (!world.has(other, Unit)) return;
          const f = world.req(other, Faction).id;
          if (sides.allied(f, o.owner)) defenders++;
          else if (f >= 0 && sides.hostile(f, o.owner)) attackers.set(f, (attackers.get(f) ?? 0) + 1);
        });
        const teams = new Set([...attackers.keys()].map((f) => sides.teams[f]));
        if (defenders > 0 || teams.size !== 1) {
          // Held, contested or empty: any capture winds back (faster while defended), except while contested.
          if (teams.size < 2) o.progress = Math.max(0, o.progress - step * captureRate(defenders > 0 ? 4 : 1));
          if (o.progress === 0) o.claimant = -1;
          continue;
        }
        // The side on the capturing team with the most units there takes it.
        let lead = -1;
        let count = 0;
        for (const [f, n] of attackers) {
          count += n;
          if (lead < 0 || n > attackers.get(lead)!) lead = f;
        }
        if (o.claimant >= 0 && !sides.allied(o.claimant, lead)) {
          // Someone else's half-finished capture has to wind back first.
          o.progress = Math.max(0, o.progress - step * captureRate(count));
          if (o.progress === 0) o.claimant = -1;
          continue;
        }
        o.claimant = lead;
        o.progress += step * captureRate(count);
        if (o.progress >= 1) capture(world, ctx, o, lead);
      }
    },
  };
}

/** Hand an outpost and its buildings to a side (or back to its garrison). */
export function capture(world: World, ctx: SimContext, o: Outpost, faction: number): void {
  const previous = o.owner;
  o.owner = faction;
  o.progress = 0;
  o.claimant = -1;
  for (const e of world.query(OutpostPart)) {
    if (world.req(e, OutpostPart).outpost !== o.index) continue;
    const rubble = world.get(e, Rubble);
    if (rubble) rubble.faction = faction;
    const f = world.get(e, Faction);
    if (f) f.id = faction;
    const armed = world.get(e, Armed);
    if (armed) armed.target = null;
    salvageFor(world, ctx, e, o);
  }
  ctx.events.emit('outpostCaptured', { outpost: o.index, faction, previous, x: o.x, z: o.z });
}

/** Whether any of the holder's enemies are in an outpost's capture ring. */
function besieged(world: World, ctx: SimContext, o: Outpost, owner: number): boolean {
  let found = false;
  ctx.grid.forEachNear(o.x, o.z, CAPTURE_RADIUS, (other) => {
    if (!found && world.has(other, Unit) && ctx.sides.hostile(world.req(other, Faction).id, owner)) found = true;
  });
  return found;
}

/**
 * Bunkers keep a few guards at their outpost for whoever holds it, so an
 * outpost left alone isn't free to take, but sends none out while enemies
 * are in the ring, so a siege isn't an endless stream of fresh guards.
 * Guards stay home (see Guard in the AI) and don't count toward the army.
 */
export function garrisonSystem(ctx: SimContext): System {
  return {
    name: 'garrison',
    update(world, dt) {
      if (ctx.outposts.length === 0) return;
      const guards = new Map<string, number>();
      for (const e of world.query(Guard, Faction)) {
        const key = `${world.req(e, Guard).outpost}:${world.req(e, Faction).id}`;
        guards.set(key, (guards.get(key) ?? 0) + 1);
      }
      for (const e of world.query(Garrison, OutpostPart, Faction, Transform)) {
        if (world.has(e, Construction)) continue;
        const outpost = world.req(e, OutpostPart).outpost;
        const faction = world.req(e, Faction).id;
        const key = `${outpost}:${faction}`;
        if ((guards.get(key) ?? 0) >= GUARDS) continue;
        const g = world.req(e, Garrison);
        g.timer -= dt;
        if (g.timer > 0) continue;
        // A bunker can't send guards out through a siege.
        if (besieged(world, ctx, ctx.outposts[outpost], faction)) continue;
        g.timer = GUARD_INTERVAL * ctx.rng.range(0.9, 1.1);
        const t = world.req(e, Transform);
        const def = ctx.units.trooper;
        const spot = spawnSpot(ctx, t.x + Math.cos(t.heading) * 2.6, t.z - Math.sin(t.heading) * 2.6, def.radius);
        if (!spot) continue;
        const unit = spawnUnit(world, ctx, def, faction, spot.x, spot.z);
        world.add(unit, Guard, { outpost });
        guards.set(key, (guards.get(key) ?? 0) + 1);
      }
    },
  };
}
