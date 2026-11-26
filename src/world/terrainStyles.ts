import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import type { Battlefield } from './battlefield';
import { shapeHighground } from './highground';
import * as D from '../core/dmath';

/**
 * Generation styles: the lie of the land, laid over the rolling terrain
 * before anything else is placed on it (see generateBattlefield). Each
 * runs on its own random stream, and Rolling (the usual map) does nothing,
 * so maps in that style are the same as ever.
 *
 * Features that run across the map go across the line between the first
 * bases (north to south, with the bases west and east), so they lie
 * between the sides: a river to bridge, a ridge to find the passes
 * through, a canyon to go down into and back out of.
 *
 * - River valley: a river winding down the middle in a broad valley, with
 *   bridges over it in a couple of places.
 * - Ridge line: a tall ridge down the middle with sheer flanks, crossed only
 *   at two or three passes (see Battlefield.sheer: only spiders climb it).
 * - Canyon: a deep, dry gorge down the middle with sheer walls, and a couple
 *   of places where the walls ease into slopes to cross by.
 * - Archipelago: islands in a shallow sea; bridges join the bases' islands.
 * - Coastline: one long side of the map runs down into the sea.
 * - Terraced hills: hillsides stepped into flat terraces.
 * - Salt flats: nearly flat ground, with any lakes left as shallow pans.
 * - Crater field: an old battlefield, pocked with craters, the deepest of
 *   them flooded.
 */
export type TerrainStyle = 'rolling' | 'river' | 'ridge' | 'canyon' | 'islands' | 'coast' | 'terraces' | 'flats' | 'craters';

export const TERRAIN_STYLES: Record<TerrainStyle, { label: string; blurb: string }> = {
  rolling: { label: 'Rolling', blurb: 'The usual rolling hills' },
  river: { label: 'River valley', blurb: 'A river winding between the sides, bridged in a couple of places' },
  ridge: { label: 'Ridge line', blurb: 'A sheer ridge between the sides, crossed only at its passes' },
  canyon: { label: 'Canyon', blurb: 'A deep gorge between the sides, with a couple of ways down and up' },
  islands: { label: 'Archipelago', blurb: 'Islands in a shallow sea, the bases’ joined by bridges' },
  coast: { label: 'Coastline', blurb: 'One long side of the map runs down into the sea' },
  terraces: { label: 'Terraced hills', blurb: 'Hillsides stepped into flat terraces' },
  flats: { label: 'Salt flats', blurb: 'Nearly flat open ground' },
  craters: { label: 'Crater field', blurb: 'An old battlefield pocked with craters, the deepest flooded' },
};

export const TERRAIN_STYLE_IDS = Object.keys(TERRAIN_STYLES) as TerrainStyle[];

export function isTerrainStyle(v: string): v is TerrainStyle {
  return v in TERRAIN_STYLES;
}

/** Styles whose features are high ground, so the map has sheer faces (see Battlefield.cliffs). */
export const SHEER_STYLES: ReadonlySet<TerrainStyle> = new Set<TerrainStyle>(['ridge', 'canyon']);

/** Where a style wants bridges built once the water's settled (see generateBattlefield): each from a to b. */
export type Crossing = { a: { x: number; z: number }; b: { x: number; z: number } };

/** Map area (in cells) counts are per: a Medium map's. */
const PER_AREA = 84 * 64;
/** Height the features are measured in: the usual hills' top height (DEFAULT_BATTLEFIELD.maxHeight). */
const HILL_HEIGHT = 9;
/** Times a ridge line or canyon is tried, each with new passes, before the map is left rolling. */
const TRIES = 6;

/** Lay the style's land over the rolling terrain. Returns where it wants bridges. */
export function shapeTerrain(field: Battlefield, style: TerrainStyle, rng: Rng): Crossing[] {
  switch (style) {
    case 'rolling':
      return [];
    case 'river':
      return river(field, rng);
    case 'ridge':
      for (let t = 0; t < TRIES; t++) if (shapeHighground(field, ridge(field, rng))) break;
      return [];
    case 'canyon':
      for (let t = 0; t < TRIES; t++) {
        const before = field.heights.slice();
        const c = canyon(field, rng);
        c.raise();
        if (shapeHighground(field, c.carve)) break;
        field.heights.set(before);
      }
      return [];
    case 'islands':
      islands(field, rng);
      return [];
    case 'coast':
      coast(field, rng);
      return [];
    case 'terraces':
      terraces(field);
      return [];
    case 'flats':
      flats(field);
      return [];
    case 'craters':
      craters(field, rng);
      return [];
  }
}

/** Every vertex with its position. */
function eachVertex(field: Battlefield, each: (k: number, x: number, z: number, i: number, j: number) => void): void {
  const { cols, rows } = field.config;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) each(j * (cols + 1) + i, field.vertexX(i), field.vertexZ(j), i, j);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A line winding north to south near the middle: its x at each z. */
function meander(field: Battlefield, rng: Rng, sway: number): (z: number) => number {
  const noise = createNoise2D(() => rng.next());
  const phase = rng.range(0, Math.PI * 2);
  const turns = rng.range(0.6, 1.1);
  const off = rng.range(-0.04, 0.04) * field.width;
  const amp = field.width * sway;
  return (z: number) => off + amp * (0.7 * D.sin((z / field.depth) * Math.PI * 2 * turns + phase) + 0.3 * noise(z / 30, 0.5));
}

function river(field: Battlefield, rng: Rng): Crossing[] {
  const centre = meander(field, rng, 0.07);
  const sea = field.seaLevel;
  // Deep enough for boats down the middle, its banks easing up into the valley sides.
  const bed = sea - 1.4;
  const half = rng.range(3.5, 5);
  const valley = rng.range(12, 18);
  const heights = field.heights;
  eachVertex(field, (k, x, z) => {
    const d = Math.abs(x - centre(z));
    const h = heights[k];
    // The valley: lower ground either side, then the channel.
    const low = sea + 1 + (h - sea - 1) * smoothstep(half, half + valley, d);
    const cut = Math.min(h, low);
    heights[k] = d < half ? Math.min(cut, bed + (cut - bed) * smoothstep(half * 0.5, half, d)) : cut;
  });
  // Bridges a third and two thirds of the way down (more on deep maps), square across the channel.
  const out: Crossing[] = [];
  const count = field.depth > 160 ? 3 : 2;
  for (let n = 0; n < count; n++) {
    const z = field.bounds.minZ + (field.depth * (n + 1)) / (count + 1) + rng.range(-4, 4);
    const x = centre(z);
    const reach = half + 3;
    out.push({ a: { x: x - reach, z }, b: { x: x + reach, z } });
  }
  return out;
}

/** A tall ridge down the middle with sheer flanks, and passes through it. */
function ridge(field: Battlefield, rng: Rng): () => void {
  const centre = meander(field, rng, 0.05);
  const rise = HILL_HEIGHT * rng.range(1.1, 1.5);
  const crest = rng.range(2, 3.5);
  const flank = rng.range(3, 4.5);
  const count = field.depth > 160 ? 3 : 2;
  const passes = Array.from({ length: count }, (_, n) => field.bounds.minZ + (field.depth * (n + 0.5)) / count + rng.range(-0.12, 0.12) * (field.depth / count));
  const passHalf = rng.range(4, 6);
  const shoulder = 4;
  const noise = createNoise2D(() => rng.next());
  return () => {
    const heights = field.heights;
    eachVertex(field, (k, x, z) => {
      const d = Math.abs(x - centre(z));
      if (d > crest + flank) return;
      // Through a pass, no ridge at all.
      let open = 1;
      for (const p of passes) open = Math.min(open, smoothstep(passHalf, passHalf + shoulder, Math.abs(z - p)));
      // A jagged crest.
      const top = rise * (0.85 + 0.15 * noise(x / 6, z / 6));
      heights[k] += top * open * (1 - smoothstep(crest, crest + flank, d));
    });
  };
}

/** A deep dry gorge down the middle with sheer walls, easing into slopes at a couple of crossings. */
function canyon(field: Battlefield, rng: Rng): { raise: () => void; carve: () => void } {
  const centre = meander(field, rng, 0.06);
  const deep = HILL_HEIGHT * rng.range(0.7, 1);
  const half = rng.range(4, 6.5);
  const count = field.depth > 160 ? 3 : 2;
  const crossings = Array.from({ length: count }, (_, n) => field.bounds.minZ + (field.depth * (n + 0.5)) / count + rng.range(-0.12, 0.12) * (field.depth / count));
  // A crossing's walls slope at most about 0.6, and it's this wide (half width, in world units) before steepening again.
  const ramp = deep * 2.5;
  const rampHalf = 5;
  const sea = field.seaLevel;
  const lift = deep * 0.6;
  // The land either side is lifted into a tableland, so the gorge is deep even through low ground; the lift
  // eases off further out, leaving the rest of the map's lakes be. Only the gorge itself is high ground.
  const raise = () => {
    const heights = field.heights;
    eachVertex(field, (k, x, z) => {
      heights[k] += lift * (1 - smoothstep(half + 12, half + 40, Math.abs(x - centre(z))));
    });
  };
  const carve = () => {
    const heights = field.heights;
    eachVertex(field, (k, x, z) => {
      const d = Math.abs(x - centre(z));
      let easy = 0;
      for (const c of crossings) easy = Math.max(easy, 1 - smoothstep(rampHalf, rampHalf + 4, Math.abs(z - c)));
      const wall = 1.2 + (ramp - 1.2) * easy;
      if (d > half + wall) return;
      const h = heights[k];
      // Dry all the way down: never below the water.
      const floor = Math.max(Math.min(h, sea + 0.6), h - deep);
      heights[k] = floor + (h - floor) * smoothstep(half, half + wall, d);
    });
  };
  return { raise, carve };
}

function islands(field: Battlefield, rng: Rng): void {
  const noise = createNoise2D(() => rng.next());
  const sea = field.seaLevel;
  const floor = sea - 2.2;
  const heights = field.heights;
  eachVertex(field, (k, x, z) => {
    const n = 0.65 * noise(x / 26, z / 26) + 0.35 * noise(x / 11, z / 11);
    const land = smoothstep(0.05, 0.3, n);
    const h = Math.max(heights[k], sea + 0.8);
    heights[k] = floor + (h - floor) * land;
  });
}

function coast(field: Battlefield, rng: Rng): void {
  const noise = createNoise2D(() => rng.next());
  const side = rng.chance(0.5) ? 1 : -1;
  const floor = field.seaLevel - 2.5;
  const heights = field.heights;
  eachVertex(field, (k, x, z) => {
    const t = (z * side) / (field.depth / 2) + 0.18 * noise(x / 35, side);
    const wet = smoothstep(0.3, 0.75, t);
    heights[k] = heights[k] + (Math.min(heights[k], floor) - heights[k]) * wet;
  });
}

function terraces(field: Battlefield): void {
  const step = Math.max(1.6, field.config.maxHeight / 4);
  const heights = field.heights;
  eachVertex(field, (k) => {
    const f = heights[k] / step;
    const base = Math.floor(f);
    // Flat treads, and steep risers between them.
    heights[k] = step * (base + smoothstep(0.72, 1, f - base));
  });
}

function flats(field: Battlefield): void {
  const sea = field.seaLevel;
  const heights = field.heights;
  eachVertex(field, (k) => {
    heights[k] = sea + 0.15 + (heights[k] - sea) * 0.18;
  });
}

function craters(field: Battlefield, rng: Rng): void {
  const { cols, rows } = field.config;
  const count = Math.round(22 * ((cols * rows) / PER_AREA));
  const heights = field.heights;
  for (let n = 0; n < count; n++) {
    const radius = rng.range(2.5, 8);
    const depth = radius * rng.range(0.3, 0.5);
    const x = rng.range(-field.width * 0.47, field.width * 0.47);
    const z = rng.range(-field.depth * 0.47, field.depth * 0.47);
    // Clear of the base pads (craters elsewhere are levelled with whatever's built on them).
    if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius * 1.35 + radius * 1.6)) continue;
    eachVertex(field, (k, vx, vz) => {
      const dx = vx - x;
      const dz = vz - z;
      if (Math.abs(dx) > radius * 1.6 || Math.abs(dz) > radius * 1.6) return;
      const t = D.hypot(dx, dz) / radius;
      if (t < 1) heights[k] -= depth * (1 - t * t);
      else if (t < 1.6) heights[k] += depth * 0.35 * (1 - (t - 1) / 0.6);
    });
  }
}
