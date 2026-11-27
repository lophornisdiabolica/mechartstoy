import { System, World } from '../core/ecs';
import { MOVE_RULES } from '../world/moveClasses';
import { distanceToSegment } from '../world/battlefield';
import { TidalFlat } from '../world/traits';
import { Health, Mover, Targetable, Transform } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';

/*
 * The tide over the Tidal flats trait's sand bars (laid out in
 * world/traits.ts). The map's made at high tide, the bars under the sea.
 * Every few minutes the tide goes out and uncovers them, land bridges for
 * foot and tracks, and boats can't get over them; a minute later it comes
 * back in and drowns them again.
 *
 * Everyone's warned, and keeps clear: a while before the tide turns, a bar
 * costs a great deal to route over (see NavObstacles.hazard), for land
 * units before the tide comes in and for boats before it goes out, so
 * routes go round, and a unit on a bar that's about to turn against it gets
 * off it the shortest way (see tideEscape, used by systems/ai.ts). Land
 * units still on a bar when the sea's over it drown, and boats still over
 * one when it dries run aground and are lost.
 */

/** Seconds between tide updates. */
const TICK = 0.5;
/** The tide's cycle, in order: how long each part lasts. The first high tide is cut short (see FIRST_EBB). */
const PHASES: { phase: TidePhase; length: number }[] = [
  { phase: 'high', length: 70 },
  { phase: 'ebbing', length: 10 },
  { phase: 'out', length: 0 },
  { phase: 'low', length: 70 },
  { phase: 'turning', length: 15 },
  { phase: 'flooding', length: 12 },
];
/** When the tide first starts going out. */
const FIRST_EBB = 50;
/** How long the warning before the tide goes out lasts, within the end of high tide. */
const EBB_WARNING = 10;
/** Route cost of a bar that's about to turn (open ground is 1): high enough that almost any way round is better. */
const HAZARD = 40;

/**
 * Where the tide is: high (the bars under the sea), ebbing (going out),
 * low (the bars dry), turning (still low, about to come in), flooding
 * (coming in). 'out' is just the moment it's gone out.
 */
export type TidePhase = 'high' | 'ebbing' | 'out' | 'low' | 'turning' | 'flooding';

/** The tide over the bars: the phase, and how far through it (0 to 1). */
export class Tide {
  phase: TidePhase = 'high';
  progress = 0;
  /** Seconds to the end of this phase. */
  left = FIRST_EBB;

  constructor(readonly flats: TidalFlat[]) {}

  /** Whether the bars are a danger to land units now (the tide's about to come in, or coming in, or in). */
  landDanger(): boolean {
    return this.phase === 'turning' || this.phase === 'flooding';
  }

  /** Whether they're a danger to boats (the tide's about to go out, or going out). */
  boatDanger(): boolean {
    return (this.phase === 'high' && this.left <= EBB_WARNING) || this.phase === 'ebbing';
  }

  /** The bar a point's on (within its width), or null. */
  flatAt(x: number, z: number, margin = 0): TidalFlat | null {
    for (const f of this.flats) if (distanceToSegment(x, z, f.ax, f.az, f.bx, f.bz) <= f.half + margin) return f;
    return null;
  }
}

/** Moves the tide, and the bars' ground with it. */
export function tideSystem(ctx: SimContext): System {
  const tide = ctx.tidal!;
  const field = ctx.field;
  const areas = tide.flats.map((f) => {
    const mx = (f.ax + f.bx) / 2;
    const mz = (f.az + f.bz) / 2;
    return field.areaAround(mx, mz, D.hypot(f.bx - f.ax, f.bz - f.az) / 2 + f.half + 1);
  });
  // The nav cells each bar covers, for its route cost.
  const cells = tide.flats.map((f) => {
    const out: number[] = [];
    const a = field.areaAround((f.ax + f.bx) / 2, (f.az + f.bz) / 2, D.hypot(f.bx - f.ax, f.bz - f.az) / 2 + f.half + 1);
    const { cols, cellSize } = field.config;
    for (let j = a.j0; j <= a.j1; j++) {
      for (let i = a.i0; i <= a.i1; i++) {
        const x = field.bounds.minX + (i + 0.5) * cellSize;
        const z = field.bounds.minZ + (j + 0.5) * cellSize;
        if (distanceToSegment(x, z, f.ax, f.az, f.bx, f.bz) <= f.half + cellSize * 0.5) out.push(j * cols + i);
      }
    }
    return out;
  });
  let index = 0;
  let acc = 0;
  let hazardOn = false;
  // Where the bars' ground is between high (0) and low (1) tide.
  let level = 0;
  const setLevel = (to: number) => {
    if (to === level) return;
    level = to;
    tide.flats.forEach((f, n) => {
      for (let k = 0; k < f.verts.length; k++) field.heights[f.verts[k]] = f.high[k] + (f.low[k] - f.high[k]) * level;
      field.changed(areas[n]);
    });
  };
  const middle = (f: TidalFlat) => ({ x: (f.ax + f.bx) / 2, z: (f.az + f.bz) / 2 });
  return {
    name: 'tides',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      tide.left -= step;
      while (tide.left <= 0) {
        index = (index + 1) % PHASES.length;
        tide.phase = PHASES[index].phase;
        tide.left += PHASES[index].length;
        for (const f of tide.flats) {
          const m = middle(f);
          if (tide.phase === 'ebbing' || tide.phase === 'turning') ctx.events.emit('tide', { phase: tide.phase, x: m.x, z: m.z });
        }
        if (tide.phase === 'out') setLevel(1);
        if (tide.phase === 'high') setLevel(0);
      }
      const length = PHASES[index].length;
      tide.progress = length > 0 ? 1 - tide.left / length : 1;
      if (tide.phase === 'ebbing') setLevel(Math.min(1, tide.progress));
      else if (tide.phase === 'flooding') setLevel(Math.max(0, 1 - tide.progress));
      // The bars cost a lot to route over while they're about to turn on someone.
      const danger = tide.landDanger() || tide.boatDanger();
      if (danger !== hazardOn) {
        hazardOn = danger;
        const obstacles = ctx.navs.land.obstacles;
        tide.flats.forEach((_f, n) => {
          for (const k of cells[n]) obstacles.hazard[k] = danger ? HAZARD : 0;
          obstacles.record(areas[n]);
        });
      }
      if (tide.phase === 'flooding' || tide.phase === 'high' || tide.phase === 'ebbing' || tide.phase === 'low') drown(world, ctx, tide);
    },
  };
}

/** Land units out of their depth on a bar the sea's come over drown; boats over one that's dried run aground. */
function drown(world: World, ctx: SimContext, tide: Tide): void {
  const field = ctx.field;
  for (const f of tide.flats) {
    const mx = (f.ax + f.bx) / 2;
    const mz = (f.az + f.bz) / 2;
    ctx.grid.forEachNear(mx, mz, D.hypot(f.bx - f.ax, f.bz - f.az) / 2 + f.half, (e) => {
      if (world.get(e, Targetable)?.kind !== 'unit') return;
      const move = world.get(e, Mover)?.move;
      if (!move) return;
      const rules = MOVE_RULES[move];
      if (rules.flies) return;
      const t = world.req(e, Transform);
      if (distanceToSegment(t.x, t.z, f.ax, f.az, f.bx, f.bz) > f.half || field.deckAt(t.x, t.z) !== null) return;
      const depth = field.seaLevel - field.heightAt(t.x, t.z);
      const h = world.get(e, Health);
      if (!h || h.hp <= 0) return;
      if (depth > rules.maxDepth + 0.1) {
        h.hp = 0;
        ctx.bridges.drowned.add(e);
      } else if (rules.minDepth > 0 && depth < rules.minDepth - 0.1) h.hp = 0;
    });
  }
}

/** How far off a bar a unit getting off it goes. */
const CLEAR = 3;

/**
 * Where a unit of this move class standing at (x, z) should go to get off a
 * bar the tide's about to turn against it: a land unit up the nearer shore,
 * a boat off the bar's side into deep water. Null if it's not on one, or
 * it's in no danger there.
 */
export function tideEscape(ctx: SimContext, move: keyof typeof MOVE_RULES, x: number, z: number): { x: number; z: number } | null {
  const tide = ctx.tidal;
  if (!tide) return null;
  const rules = MOVE_RULES[move];
  const naval = rules.minDepth > 0;
  if (rules.flies || (naval ? !tide.boatDanger() : !tide.landDanger() || rules.maxDepth >= 1.5)) return null;
  const f = tide.flatAt(x, z, 1);
  if (!f) return null;
  const len = D.hypot(f.bx - f.ax, f.bz - f.az);
  const ux = (f.bx - f.ax) / len;
  const uz = (f.bz - f.az) / len;
  const along = (x - f.ax) * ux + (z - f.az) * uz;
  if (naval) {
    // Off the side it's on.
    const side = (x - f.ax) * -uz + (z - f.az) * ux >= 0 ? 1 : -1;
    const s = Math.max(0, Math.min(len, along));
    return { x: f.ax + ux * s - uz * side * (f.half + CLEAR + 2), z: f.az + uz * s + ux * side * (f.half + CLEAR + 2) };
  }
  // Up the nearer shore.
  return along < len / 2 ? { x: f.ax - ux * CLEAR, z: f.az - uz * CLEAR } : { x: f.bx + ux * CLEAR, z: f.bz + uz * CLEAR };
}
