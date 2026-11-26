import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import type { Battlefield } from './battlefield';
import * as D from '../core/dmath';

/**
 * Map shapes: the outline of the land, with sea beyond it, laid over the
 * terrain before anything is built on it (see generateBattlefield). Each
 * runs on its own random stream, and Full (the usual map, land edge to
 * edge) does nothing, so those maps are the same as ever.
 *
 * The land always reaches every base: a base the outline would leave in
 * the sea keeps a patch of land round it, and bridges join it to the rest
 * like any other island (see bridgeLand).
 *
 * - Island: one big island, sea all round.
 * - Isthmus: two lands, the first bases' sides of the map, joined by a
 *   narrow neck in the middle, with sea either side of it.
 * - Ring: land round a sea in the middle.
 * - Crescent: a curved island, bowed round a bay.
 * - Peninsula: a long arm of land reaching out from one end of the map,
 *   sea along both its sides.
 */
export type MapOutline = 'full' | 'island' | 'isthmus' | 'ring' | 'crescent' | 'peninsula';

export const MAP_OUTLINES: Record<MapOutline, { label: string; blurb: string }> = {
  full: { label: 'Full', blurb: 'Land from edge to edge' },
  island: { label: 'Island', blurb: 'One big island, with sea all round' },
  isthmus: { label: 'Isthmus', blurb: 'Two lands joined by a narrow neck in the middle' },
  ring: { label: 'Ring', blurb: 'Land round a sea in the middle' },
  crescent: { label: 'Crescent', blurb: 'A curved island bowed round a bay' },
  peninsula: { label: 'Peninsula', blurb: 'A long arm of land reaching out from one end, sea along both sides' },
};

export const MAP_OUTLINE_IDS = Object.keys(MAP_OUTLINES) as MapOutline[];

export function isMapOutline(v: string): v is MapOutline {
  return v in MAP_OUTLINES;
}

/** How far below the water the sea floor is. */
const SEA_DEPTH = 2.5;
/** Width of the shore, as a share of the map's half-size: how far the land takes to slope down into the sea. */
const SHORE = 0.08;
/** Land kept round each base, as a multiple of its pad's radius. */
const BASE_LAND = 1.7;

/** Lay the outline over the terrain: sea wherever it isn't land. */
export function shapeOutline(field: Battlefield, outline: MapOutline, rng: Rng): void {
  if (outline === 'full') return;
  const noise = createNoise2D(() => rng.next());
  const flip = rng.chance(0.5) ? 1 : -1;
  // How far inside the land a point is (normalised: about -1 to 1, 0 at the shore, above 0 on land).
  const inside = landShape(outline, flip);
  const halfW = field.width / 2;
  const halfD = field.depth / 2;
  const floor = field.seaLevel - SEA_DEPTH;
  const { cols, rows } = field.config;
  const heights = field.heights;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = field.vertexX(i);
      const z = field.vertexZ(j);
      const u = x / halfW;
      const v = z / halfD;
      // A ragged shore.
      let land = inside(u, v) + 0.07 * noise(x / 18, z / 18) + 0.035 * noise(x / 7, z / 7);
      // Every base keeps its ground.
      for (const b of field.baseSites) {
        const reach = b.radius * BASE_LAND;
        land = Math.max(land, (reach - D.hypot(b.x - x, b.z - z)) / Math.max(halfW, halfD));
      }
      const sea = 1 - smoothstep(-SHORE / 2, SHORE / 2, land);
      if (sea <= 0) continue;
      const k = j * (cols + 1) + i;
      heights[k] += (Math.min(heights[k], floor) - heights[k]) * sea;
    }
  }
}

/** The outline as a function of normalised position (u across the map's width, v its depth, each -1 to 1): above 0 on land. */
function landShape(outline: MapOutline, flip: number): (u: number, v: number) => number {
  switch (outline) {
    case 'full':
      return () => 1;
    case 'island':
      return (u, v) => 0.86 - D.hypot(u, v * 1.05);
    case 'isthmus':
      // The two ends are land; in the middle, only a neck about a fifth of the map deep.
      return (u, v) => Math.max(Math.abs(u) - 0.3, 0.21 - Math.abs(v + 0.08 * D.sin(u * 4)));
    case 'ring':
      return (u, v) => D.hypot(u, v * 1.1) - 0.36;
    case 'crescent': {
      // An island with a bite out of one long side.
      return (u, v) => Math.min(0.88 - D.hypot(u, v), D.hypot(u * 0.9, v - flip * 0.95) - 0.72);
    }
    case 'peninsula':
      // Mainland across one end; from it an arm about half the map deep reaches to the other.
      return (u, v) => Math.max(-flip * u - 0.62, 0.48 - Math.abs(v) - 0.12 * (1 + flip * u) * 0.5);
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
