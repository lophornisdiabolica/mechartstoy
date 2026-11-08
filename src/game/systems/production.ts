import { System, World } from '../../core/ecs';
import { Building, Construction, Faction, Producer, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { newSquad, spawnUnit } from '../spawn';
import { outpostBonus } from '../outposts';
import { tide } from '../tide';
import { berthFree, canBuild, countBoats, countByCategory, countFlagships, flagshipFree, isBoat, isFlagship } from '../caps';
import { recordSquad } from '../territory';
import { UnitDef, UnitId } from '../units';
import { MoveClass } from '../../world/moveClasses';
import { adviceFactor, STYLES } from '../commander/advice';
import * as D from '../../core/dmath';

/**
 * The nearest spot to (x, z) with room for a unit of this radius and
 * movement class, searching a few rings outward (more for boats, which need
 * open water). Keeps big units from rolling out wedged between buildings.
 */
export function spawnSpot(ctx: SimContext, x: number, z: number, radius: number, move: MoveClass = 'tracked'): { x: number; z: number } | null {
  const grid = ctx.navs.for(move);
  const ok = (px: number, pz: number) => ctx.field.contains(px, pz, 1) && grid.terrainAllowsAt(px, pz) && grid.fitsAt(px, pz, radius);
  if (ok(x, z)) return { x, z };
  const naval = move === 'naval';
  for (let ring = 1; ring <= (naval ? 8 : 4); ring++) {
    const d = ring * 1.5;
    for (let a = 0; a < 8; a++) {
      const px = x + D.cos((a / 8) * Math.PI * 2) * d;
      const pz = z + D.sin((a / 8) * Math.PI * 2) * d;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  // Nowhere roomy: anywhere dry will do (but not for a boat).
  return !naval && !ctx.field.isWater(x, z) && ctx.field.contains(x, z, 1) ? { x, z } : null;
}

/** Every unit in a production or wave entry's squad, in order: its main unit, then any it comes `with`. */
export function squadLineUp(entry: { unit: UnitId; count: number; with?: { unit: UnitId; count: number } }): UnitId[] {
  const out: UnitId[] = new Array(entry.count).fill(entry.unit);
  if (entry.with) for (let i = 0; i < entry.with.count; i++) out.push(entry.with.unit);
  return out;
}

/** Units alive per side. */
export function countUnits(world: World, sides: number): number[] {
  const alive = new Array<number>(sides).fill(0);
  for (const e of world.query(Unit, Faction)) {
    const f = world.req(e, Faction).id;
    if (f >= 0) alive[f]++;
  }
  return alive;
}

/**
 * How outnumbered a side is: its enemies' average army over its own (with a
 * little padding so small numbers don't swing it). Above 1 means outnumbered.
 */
export function outnumbered(ctx: SimContext, alive: number[], faction: number): number {
  const enemies = ctx.sides.enemiesOf(faction);
  const theirs = enemies.length > 0 ? enemies.reduce((s, f) => s + alive[f], 0) / enemies.length : alive[faction];
  return (theirs + 6) / (alive[faction] + 6);
}

/**
 * When a side loses a super unit, every building of its that builds that
 * kind starts over: the next one takes the full build time from now, with no
 * head start from time spent waiting while the side was at its cap. A lost
 * flagship restarts the docks' flagship builds, and any other super unit the
 * mech bay's (see isFlagship): they're capped apart, so they wait apart.
 */
export function restartSuperBuilds(world: World, ctx: SimContext, faction: number, lost?: UnitDef): void {
  const flagship = lost !== undefined && isFlagship(lost);
  for (const e of world.query(Producer, Faction)) {
    if (world.req(e, Faction).id !== faction) continue;
    const p = world.req(e, Producer);
    if (flagship) {
      if (p.flagship !== undefined && p.flagshipInterval !== undefined) p.flagshipTimer = Math.max(p.flagshipTimer ?? 0, p.flagshipInterval);
    } else if (p.table.some((entry) => ctx.units[entry.unit].category === 'super')) p.timer = Math.max(p.timer, p.interval);
  }
}

/** Seconds a flagship build waits to try again when there's no berth or no water at the door to launch it into. */
const FLAGSHIP_RETRY = 8;

/**
 * A dock's flagship (see Producer.flagship), off its slipway into open water
 * by the door, if the side has a berth for it. It sails alone, as its own squad.
 */
function launchFlagship(world: World, ctx: SimContext, e: number, producer: Producer, faction: number, flagships: number[]): void {
  const def = ctx.units[producer.flagship!];
  const t = world.req(e, Transform);
  const r = world.req(e, Building).def.radius + def.radius;
  const spot = flagshipFree(ctx, flagships, faction) ? spawnSpot(ctx, t.x + D.cos(t.heading) * r, t.z - D.sin(t.heading) * r, def.radius, def.move) : null;
  if (!spot) {
    producer.flagshipTimer = FLAGSHIP_RETRY;
    return;
  }
  const squad = newSquad(ctx);
  recordSquad(ctx, squad, faction, [def.id as UnitId]);
  spawnUnit(world, ctx, def, faction, spot.x, spot.z, squad);
  flagships[faction]++;
  producer.flagshipTimer = producer.flagshipInterval!;
}

/** The Commander's factor on a unit's production weight for a side. */
function advice(ctx: SimContext, faction: number, unit: UnitId): number {
  const side = ctx.commander.sides[faction];
  const limit = ctx.settings.armies.advice;
  if (!side || limit <= 0) return 1;
  return adviceFactor(ctx.units[unit], side.needs, STYLES[ctx.settings.factions[faction]?.style ?? 'balanced'], limit);
}

/**
 * Production buildings turn out units on their own timers. Two things scale
 * the rate: the tide, which the ramp makes swing harder (see tide.ts), outposts held
 * (see outposts.ts), and (in Eternal mode) a mild
 * rubber band that helps a badly outnumbered side recover. The settings' production multiplier
 * applies on top. A unit whose category is at its cap (see caps.ts) isn't built,
 * and the building waits for its next turn.
 */
export function productionSystem(ctx: SimContext): System {
  return {
    name: 'production',
    update(world, dt) {
      const alive = countUnits(world, ctx.sides.count);
      const counts = countByCategory(world, ctx.sides.count);
      const boats = countBoats(world, ctx.sides.count);
      const flagships = countFlagships(world, ctx.sides.count);
      const { armies } = ctx.settings;
      for (const e of world.query(Producer, Building, Transform, Faction)) {
        if (world.has(e, Construction)) continue;
        const faction = world.req(e, Faction).id;
        const producer = world.req(e, Producer);
        // Ratio > 1 means this side is outnumbered.
        const ratio = outnumbered(ctx, alive, faction);
        // Conquest needs a winner, so it skips the rubber band and lets an advantage snowball.
        const band = ctx.settings.mode === 'conquest' ? 1 : Math.min(1.8, Math.max(0.75, ratio));
        // An outpost adds the same to every side, not a share of a big side's boosted rate.
        const strength = ctx.sides.strength[faction] + outpostBonus(ctx, faction, 'production');
        const rate = armies.production * strength * band * tide(world.time, ctx.sides.phase[faction], ctx.tide, ctx.escalation.tide) * ctx.god.production(faction, world.time);
        producer.timer -= dt * rate;
        if (producer.flagship !== undefined && producer.flagshipTimer !== undefined) {
          producer.flagshipTimer -= dt * rate;
          if (producer.flagshipTimer <= 0) launchFlagship(world, ctx, e, producer, faction, flagships);
        }
        if (producer.timer > 0) continue;
        producer.timer = producer.interval * ctx.rng.range(0.9, 1.1);

        // The Commander leans the doctrine's table toward what the battle needs (see commander/advice.ts).
        const weights = producer.table.map((p) => p.weight * advice(ctx, faction, p.unit));
        const total = weights.reduce((s, w) => s + w, 0);
        let roll = ctx.rng.range(0, total);
        const entry = producer.table.find((_, i) => (roll -= weights[i]) <= 0) ?? producer.table[0];
        // Boats need a free berth rather than vehicle cap (see BOAT_BERTHS); their stand-in needs the cap.
        const first = ctx.units[entry.unit];
        const standIn = entry.ifDry ? ctx.units[entry.ifDry] : null;
        const room = (def: UnitDef) => (isBoat(def) ? berthFree(ctx, boats, faction) : canBuild(ctx, counts, faction, def));
        if (!room(first) && !(standIn && room(standIn))) continue;

        // Units roll out of the front door.
        const t = world.req(e, Transform);
        const r = world.req(e, Building).def.radius + 1.2;
        const doorX = t.x + D.cos(t.heading) * r;
        const doorZ = t.z - D.sin(t.heading) * r;
        // A batch is a squad: it takes the same lane.
        const squad = newSquad(ctx);
        const lineUp = squadLineUp(entry);
        recordSquad(ctx, squad, faction, lineUp);
        for (const id of lineUp) {
          let def = ctx.units[id];
          const x = doorX + ctx.rng.range(-1.2, 1.2);
          const z = doorZ + ctx.rng.range(-1.2, 1.2);
          // The rest of a squad comes out with it even past the cap (the cap gates whole batches), but boats need berths.
          let spot = !isBoat(def) || berthFree(ctx, boats, faction) ? spawnSpot(ctx, x, z, def.radius, def.move) : null;
          // A boat with no water to launch into, or no free berth, is built as its dry-land stand-in.
          if (!spot && standIn && id === entry.unit) {
            def = standIn;
            spot = spawnSpot(ctx, x, z, def.radius, def.move);
          }
          if (spot) {
            spawnUnit(world, ctx, def, faction, spot.x, spot.z, squad);
            alive[faction]++;
            if (isBoat(def)) boats[faction]++;
            else counts[faction][def.category]++;
          }
        }
      }
    },
  };
}
