import { Entity, System, World } from '../core/ecs';
import { Ai, Armed, Building, Faction, Health, Mover, Transform, Unit } from './components';
import { SimContext } from './context';
import { spawnUnit } from './spawn';
import { railAt, railLength, railNearest, RailLine } from '../world/traits';
import * as D from '../core/dmath';

/*
 * The rail line trait's armoured trains (the track is laid out in
 * world/traits.ts). Whoever holds a station gets a train on the line a
 * while after taking it, one for each side at most, and another a while
 * after losing it. The train runs only on the track: it heads for the
 * enemy nearest the line, stops to fight whatever's in range, and turns
 * back at the ends and short of another train. It answers to nobody's
 * orders, so the Commander treats it like a tower that moves: something to
 * kill or keep clear of.
 */

/** Seconds between rail updates (the trains move every step). */
const TICK = 1;
/** How far from the track an enemy can be and still draw the trains. */
const DRAW = 26;
/** How close two trains can come along the line. */
const GAP = 8;
/** How far apart the track is checked for the nearest point to an enemy. */
const COARSE = 3;

/** A train on the line: how far along it is, which way it's heading (+1 or -1), and where it's going. */
interface Train {
  entity: Entity;
  faction: number;
  s: number;
  dir: number;
  /** Which end leads, +1 or -1: it keeps the last way it ran while it stands. */
  face: number;
  goal: number | null;
}

export function railSystem(ctx: SimContext): System {
  const rail = ctx.field.traits.rail;
  const stations = ctx.outposts.filter((o) => o.kind.trains);
  const trains: Train[] = [];
  const due = new Map<number, number>();
  const owners = new Map<number, number>();
  let acc = 0;
  return {
    name: 'rail',
    update(world, dt) {
      if (!rail || stations.length === 0) return;
      for (let k = trains.length - 1; k >= 0; k--) {
        const t = trains[k];
        if (!world.isAlive(t.entity) || (world.get(t.entity, Health)?.hp ?? 0) <= 0) {
          trains.splice(k, 1);
          // The side's next train comes a while after it's lost.
          for (const o of stations) if (o.owner === t.faction) due.set(o.index, Math.max(due.get(o.index) ?? 0, world.time + o.kind.trains!));
        }
      }
      acc += dt;
      if (acc >= TICK) {
        acc = 0;
        for (const o of stations) {
          if (owners.get(o.index) !== o.owner) {
            owners.set(o.index, o.owner);
            due.set(o.index, world.time + o.kind.trains!);
          }
          if (o.owner < 0 || ctx.outcome || world.time < (due.get(o.index) ?? Infinity)) continue;
          if (trains.some((t) => t.faction === o.owner)) continue;
          const at = railNearest(rail, o.x, o.z);
          // Not onto another train.
          if (trains.some((t) => Math.abs(t.s - at.s) < GAP * 1.5)) continue;
          trains.push(launch(world, ctx, rail, o.owner, at.s, o.index));
        }
        for (const t of trains) t.goal = goalFor(world, ctx, rail, t);
      }
      for (const t of trains) run(world, rail, trains, t, dt);
    },
  };
}

/** Put a train on the line for a side, at `s` along it. */
function launch(world: World, ctx: SimContext, rail: RailLine, faction: number, s: number, station: number): Train {
  const p = railAt(rail, s);
  const e = spawnUnit(world, ctx, ctx.units.armouredTrain, faction, p.x, p.z);
  // It answers to nobody: the rail system drives it.
  world.remove(e, Ai);
  world.req(e, Mover).speed = 0;
  world.req(e, Transform).heading = p.heading;
  ctx.events.emit('trainLaunched', { entity: e, faction, outpost: station, x: p.x, z: p.z });
  const dir = s < railLength(rail) / 2 ? 1 : -1;
  return { entity: e, faction, s, dir, face: dir, goal: null };
}

/** Where along the line a train wants to be: by the enemy nearest the line, or nowhere in particular (it runs up and down). */
function goalFor(world: World, ctx: SimContext, rail: RailLine, t: Train): number | null {
  let best: number | null = null;
  let bestD = DRAW;
  const tt = world.req(t.entity, Transform);
  const consider = (e: Entity) => {
    const f = world.get(e, Faction);
    if (!f || f.id < 0 || !ctx.sides.hostile(t.faction, f.id)) return;
    if ((world.get(e, Health)?.hp ?? 0) <= 0) return;
    const p = world.req(e, Transform);
    // Only bother with what's not far along the line from it, so it doesn't race the whole length every time.
    if (D.hypot(p.x - tt.x, p.z - tt.z) > railLength(rail) * 0.6) return;
    const near = railNearest(rail, p.x, p.z, COARSE);
    if (near.d < bestD) {
      bestD = near.d;
      best = near.s;
    }
  };
  for (const e of world.query(Unit, Transform, Faction)) consider(e);
  for (const e of world.query(Building, Transform, Faction)) consider(e);
  return best;
}

/** Move a train along the line: it stops to fight what's in range, and turns at the ends and short of another train. */
function run(world: World, rail: RailLine, trains: Train[], t: Train, dt: number): void {
  if (!world.isAlive(t.entity)) return;
  const armed = world.get(t.entity, Armed);
  const length = railLength(rail);
  const fighting = armed?.target != null && world.isAlive(armed.target);
  if (!fighting) {
    if (t.goal !== null) {
      if (Math.abs(t.goal - t.s) < 2) t.dir = 0;
      else t.dir = t.goal > t.s ? 1 : -1;
    } else if (t.dir === 0) t.dir = t.s < length / 2 ? 1 : -1;
    if (t.dir !== 0) {
      const next = t.s + t.dir * world.req(t.entity, Unit).def.speed * dt;
      const blocked = trains.some((o) => o !== t && Math.abs(o.s - next) < GAP && Math.sign(o.s - t.s) === t.dir);
      if (blocked) t.dir = t.goal === null ? -t.dir : 0;
      else if (next <= 0 || next >= length) {
        t.s = Math.max(0, Math.min(length, next));
        if (t.goal === null) t.dir = -t.dir;
      } else t.s = next;
    }
  }
  const p = railAt(rail, t.s);
  const tr = world.req(t.entity, Transform);
  tr.x = p.x;
  tr.z = p.z;
  // Facing the way the track runs (either end can lead).
  if (t.dir !== 0) t.face = t.dir;
  tr.heading = t.face < 0 ? p.heading + Math.PI : p.heading;
}
