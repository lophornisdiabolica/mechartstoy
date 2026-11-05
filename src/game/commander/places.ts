import { Battlefield } from '../../world/battlefield';
import { NavGrid } from '../../world/navGrid';
import * as D from '../../core/dmath';

/**
 * Places that matter to a commander: each base and outpost, the towns, the
 * bridges, narrow land crossings (gaps between water, cliffs or dense
 * forest that an army has to file through) and high ground (hilltops that
 * look over the field).
 */
export type PlaceKind = 'base' | 'outpost' | 'town' | 'bridge' | 'crossing' | 'high';

export interface Place {
  kind: PlaceKind;
  x: number;
  z: number;
  /** For a base, its side; for an outpost, its index; otherwise -1. */
  id: number;
  /** For a crossing, how wide it is at its narrowest; for high ground, how far it rises over its surroundings. */
  size: number;
}

/** Spacing of the points tested for crossings, in world units. */
const CROSSING_STEP = 3;
/** A gap at most this wide (world units) counts as a crossing... */
const CROSSING_WIDTH = 8;
/** ...if the way through it is at least this many times longer than the gap is wide (so not just a nook). */
const CROSSING_RUN = 2.5;
/** Crossings and hills closer than this to one already found are the same place. */
const SAME_PLACE = 14;
/** Spacing of the points tested for high ground. */
const HIGH_STEP = 10;
/** A hilltop has to rise at least this far over the ground HIGH_STEP away all round. */
const HIGH_RISE = 1.2;
/** Most hills kept, highest first. */
const MOST_HILLS = 12;
/** Bases and their surroundings aren't crossings or hills worth naming. */
const BASE_CLEAR = 18;

/** Directions to measure a gap across: E-W, N-S and both diagonals. */
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
];

/** How far from (x, z) along (dx, dz) the land route grid's terrain stays passable, up to `max` (read from its cells: testing the terrain itself is slow on big maps). */
function reach(nav: NavGrid, x: number, z: number, dx: number, dz: number, max: number): number {
  for (let d = 1; d <= max; d += 1) if (nav.terrainBlocksCell(x + dx * d, z + dz * d)) return d - 1;
  return max;
}

/** Keep places at least SAME_PLACE apart, preferring earlier ones in `found`. */
function spread(found: Place[]): Place[] {
  const kept: Place[] = [];
  for (const p of found) if (kept.every((k) => D.hypot(k.x - p.x, k.z - p.z) >= SAME_PLACE)) kept.push(p);
  return kept;
}

/** Find the map's key places. The land route grid (tracked vehicles) decides what's passable. */
export function findPlaces(field: Battlefield, nav: NavGrid): Place[] {
  const places: Place[] = [];
  for (const b of field.baseSites) places.push({ kind: 'base', x: b.x, z: b.z, id: b.faction, size: b.radius });
  for (const o of field.outpostSites) places.push({ kind: 'outpost', x: o.x, z: o.z, id: o.index, size: o.radius });
  for (const t of field.townSites) places.push({ kind: 'town', x: t.x, z: t.z, id: -1, size: t.radius });
  for (const b of field.bridges) places.push({ kind: 'bridge', x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2, id: -1, size: b.width });

  const nearBase = (x: number, z: number) => field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < BASE_CLEAR);
  const { minX, maxX, minZ, maxZ } = field.bounds;

  // Crossings: passable points where some direction across is narrow and the perpendicular way through is long.
  const crossings: Place[] = [];
  for (let z = minZ + CROSSING_WIDTH; z <= maxZ - CROSSING_WIDTH; z += CROSSING_STEP) {
    for (let x = minX + CROSSING_WIDTH; x <= maxX - CROSSING_WIDTH; x += CROSSING_STEP) {
      // Open ground all round can't be a gap (clearance counts buildings too, so it only ever says less room than the terrain leaves).
      if (nav.terrainBlocksCell(x, z) || nav.clearanceAt(x, z) >= CROSSING_WIDTH || field.deckAt(x, z) !== null || nearBase(x, z)) continue;
      const run = CROSSING_WIDTH * CROSSING_RUN;
      let best = Infinity;
      for (let d = 0; d < DIRS.length; d++) {
        const [dx, dz] = DIRS[d];
        const width = reach(nav, x, z, dx, dz, CROSSING_WIDTH) + reach(nav, x, z, -dx, -dz, CROSSING_WIDTH);
        if (width >= CROSSING_WIDTH) continue;
        // The way through runs across the gap: it has to go on both ways, or it's a dead end.
        const [px, pz] = [-dz, dx];
        const through = reach(nav, x, z, px, pz, run / 2) + reach(nav, x, z, -px, -pz, run / 2);
        if (through >= run - 1) best = Math.min(best, width);
      }
      if (best < Infinity) crossings.push({ kind: 'crossing', x, z, id: -1, size: best + 1 });
    }
  }
  crossings.sort((a, b) => a.size - b.size || a.z - b.z || a.x - b.x);
  places.push(...spread(crossings));

  // High ground: dry, passable points higher than the ground HIGH_STEP away in every direction.
  const hills: Place[] = [];
  for (let z = minZ + HIGH_STEP; z <= maxZ - HIGH_STEP; z += HIGH_STEP / 2) {
    for (let x = minX + HIGH_STEP; x <= maxX - HIGH_STEP; x += HIGH_STEP / 2) {
      const h = field.heightAt(x, z);
      if (h <= field.seaLevel || nav.terrainBlocksCell(x, z) || nearBase(x, z)) continue;
      let rise = Infinity;
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2;
        rise = Math.min(rise, h - field.heightAt(x + D.cos(angle) * HIGH_STEP, z + D.sin(angle) * HIGH_STEP));
      }
      if (rise >= HIGH_RISE) hills.push({ kind: 'high', x, z, id: -1, size: rise });
    }
  }
  hills.sort((a, b) => b.size - a.size || a.z - b.z || a.x - b.x);
  places.push(...spread(hills).slice(0, MOST_HILLS));
  return places;
}
