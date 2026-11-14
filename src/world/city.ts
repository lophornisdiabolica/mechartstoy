import { Rng } from '../core/rng';
import * as D from '../core/dmath';

/*
 * A city: a big town laid out on the route grid's own cells, so that its
 * gaps mean exactly what they look like to the units.
 *
 * Its blocks are rows of lots, each lot two route cells (3 units) square
 * with one building filling it, and a one-cell alley (1.5 units) between
 * neighbouring lots. Infantry and the tiniest vehicles slip down the alleys;
 * anything wider can't fit (see NavGrid's clearance cap for city cells), so
 * vehicles keep to the avenues between the blocks, three cells (4.5 units)
 * wide: room for one tank, or a Titan, but two tanks side by side only just.
 *
 * Everything is in whole cells from the city's centre (the middle of a
 * cell), on both axes alike: the city is square to the map.
 */

/** Route cell size the plan is laid out in (NavGrid's default, and the map's). */
export const CITY_CELL = 1.5;
/** A lot's width, an alley's and an avenue's, in cells. */
const LOT = 2;
const ALLEY = 1;
const AVENUE = 3;
/** Lots along a block, at random from these. */
const BLOCK_LOTS = [3, 4, 4];
/** Lots of the block that's left open as the city square (big enough for an outpost's pad). */
export const SQUARE_LOTS = 4;
/** Share of the way out past which outskirts lots are sometimes left empty, and how often. */
const FRINGE = 0.78;
const FRINGE_GAP = 0.3;

/** Along one axis: where the lots, alleys and avenues are, in cells from the centre. */
interface AxisPlan {
  /** First cell of each lot, and which block it's in. */
  lots: { at: number; block: number }[];
  /** Each alley's cell, and its block. */
  alleys: { at: number; block: number }[];
  /** First and last cell of each avenue. */
  avenues: [number, number][];
  /** First and last cell of each block. */
  blocks: [number, number][];
}

export interface CityLot {
  /** Centre of the lot (a cell corner). */
  x: number;
  z: number;
  /** Lot index along each axis, and the block on each. */
  bi: number;
  bj: number;
  /** How far out it is: 0 in the middle, 1 at the city's edge (see CityPlan.outAt). */
  out: number;
}

export interface CityPlan {
  /** Centre of the city: the middle of a route cell. */
  x: number;
  z: number;
  /** Half its width (along x) and half its depth (along z): a city can be longer one way, to fit between bases. */
  rx: number;
  rz: number;
  /** Lots with a building on them, at the start. */
  lots: CityLot[];
  /** Centre of the city square, left open for an outpost (or just open). */
  square: { x: number; z: number; hx: number; hz: number };
  /** Avenue and alley centre lines (world units), with widths. */
  avenues: { points: { x: number; z: number }[]; width: number }[];
  alleys: { points: { x: number; z: number }[]; width: number }[];
}

/** How far out a point is in a city: 0 in the middle, 1 at its squarish edge. */
export function cityOut(plan: { x: number; z: number; rx: number; rz: number }, x: number, z: number): number {
  return cityNorm((x - plan.x) / plan.rx, (z - plan.z) / plan.rz);
}

/** The squarish distance cities are measured in: round corners on a square. */
export function cityNorm(dx: number, dz: number): number {
  return Math.sqrt(Math.sqrt(dx * dx * dx * dx + dz * dz * dz * dz));
}

/** One axis, from the central avenue outward both ways, out to `cells`. The first block on the + side is the square's. */
function planAxis(rng: Rng, cells: number): AxisPlan {
  const plan: AxisPlan = { lots: [], alleys: [], avenues: [[-1, 1]], blocks: [] };
  for (const sign of [1, -1]) {
    let at = 2;
    let first = true;
    while (at + LOT - 1 <= cells) {
      const n = first && sign === 1 ? SQUARE_LOTS : rng.pick(BLOCK_LOTS);
      first = false;
      const block = plan.blocks.length;
      const start = at;
      for (let k = 0; k < n && at + LOT - 1 <= cells; k++) {
        if (k > 0) {
          plan.alleys.push({ at: sign * at, block });
          at += ALLEY;
        }
        plan.lots.push({ at: sign > 0 ? at : -(at + LOT - 1), block });
        at += LOT;
      }
      const end = at - 1;
      plan.blocks.push(sign > 0 ? [start, end] : [-end, -start]);
      if (at + AVENUE + LOT - 1 > cells) break;
      plan.avenues.push(sign > 0 ? [at, at + AVENUE - 1] : [-(at + AVENUE - 1), -at]);
      at += AVENUE;
    }
  }
  return plan;
}

/**
 * Lay out a city reaching rx along x and rz along z from (x, z), which
 * should be the middle of a route cell (see snapToCell). Pure: the same
 * random stream gives the same city.
 */
export function planCity(x: number, z: number, rx: number, rz: number, rng: Rng): CityPlan {
  const ax = planAxis(rng, Math.floor(rx / CITY_CELL));
  const az = planAxis(rng, Math.floor(rz / CITY_CELL));
  const shape = { x, z, rx, rz };
  // Cell offsets to world: cell `o`'s centre is o cells from the centre.
  const wx = (o: number) => x + o * CITY_CELL;
  const wz = (o: number) => z + o * CITY_CELL;
  // The square is the first + block on both axes.
  const squareBlockX = ax.lots[0].block;
  const squareBlockZ = az.lots[0].block;
  const [sx0, sx1] = ax.blocks[squareBlockX];
  const [sz0, sz1] = az.blocks[squareBlockZ];
  const square = { x: (wx(sx0) + wx(sx1)) / 2, z: (wz(sz0) + wz(sz1)) / 2, hx: ((sx1 - sx0 + 1) * CITY_CELL) / 2, hz: ((sz1 - sz0 + 1) * CITY_CELL) / 2 };

  const lots: CityLot[] = [];
  for (const li of ax.lots) {
    for (const lj of az.lots) {
      if (li.block === squareBlockX && lj.block === squareBlockZ) continue;
      // A lot's centre is the corner between its two cells.
      const lx = wx(li.at + 0.5);
      const lz = wz(lj.at + 0.5);
      const out = cityOut(shape, lx, lz);
      if (out > 1) continue;
      if (out > FRINGE && rng.chance(FRINGE_GAP)) continue;
      lots.push({ x: lx, z: lz, bi: li.block, bj: lj.block, out });
    }
  }

  // Avenues run the length of the built-up area, the central ones right out to the edge (where country roads join).
  const avenues: CityPlan['avenues'] = [];
  const along = (o: number, alongX: boolean, from: number, to: number) =>
    alongX ? [{ x: from, z: wz(o) }, { x: to, z: wz(o) }] : [{ x: wx(o), z: from }, { x: wx(o), z: to }];
  for (const [axis, plan] of [['x', ax], ['z', az]] as const) {
    for (const [a0, a1] of plan.avenues) {
      const mid = (a0 + a1) / 2;
      // How far along this avenue there are lots beside it.
      const side = lots.filter((l) => Math.abs((axis === 'x' ? l.x - wx(mid) : l.z - wz(mid))) < (AVENUE / 2 + LOT) * CITY_CELL);
      const along0 = axis === 'x' ? side.map((l) => l.z - z) : side.map((l) => l.x - x);
      if (along0.length === 0) continue;
      const central = a0 === -1;
      // (An avenue at fixed x runs along z, out to rz.)
      const r = axis === 'x' ? rz : rx;
      const lo = central ? -r : Math.min(...along0) - CITY_CELL * 1.5;
      const hi = central ? r : Math.max(...along0) + CITY_CELL * 1.5;
      // An avenue across x (fixed x) runs along z, and the other way round.
      const points = axis === 'x' ? along(mid, false, z + lo, z + hi) : along(mid, true, x + lo, x + hi);
      avenues.push({ points, width: AVENUE * CITY_CELL });
    }
  }

  // Alleys: one per alley line per block it runs through, where there are lots beside it.
  const alleys: CityPlan['alleys'] = [];
  for (const [axis, plan, other] of [['x', ax, az], ['z', az, ax]] as const) {
    for (const alley of plan.alleys) {
      for (let b = 0; b < other.blocks.length; b++) {
        const [o0, o1] = other.blocks[b];
        const beside = lots.some((l) => {
          const across = axis === 'x' ? l.x - wx(alley.at) : l.z - wz(alley.at);
          const [mine, theirs] = axis === 'x' ? [l.bi, l.bj] : [l.bj, l.bi];
          return mine === alley.block && theirs === b && Math.abs(across) < LOT * CITY_CELL;
        });
        if (!beside) continue;
        // From the avenue edge to the avenue edge, a little into each so they meet.
        const from = (o0 - 0.5 - 0.3) * CITY_CELL;
        const to = (o1 + 0.5 + 0.3) * CITY_CELL;
        const points = axis === 'x' ? along(alley.at, false, z + from, z + to) : along(alley.at, true, x + from, x + to);
        alleys.push({ points, width: ALLEY * CITY_CELL * 0.9 });
      }
    }
  }
  return { x, z, rx, rz, lots, square, avenues, alleys };
}

/** The middle of the route cell a point is in, for a map whose left and top edges are at minX, minZ. */
export function snapToCell(x: number, z: number, minX: number, minZ: number): { x: number; z: number } {
  return {
    x: minX + (Math.floor((x - minX) / CITY_CELL) + 0.5) * CITY_CELL,
    z: minZ + (Math.floor((z - minZ) / CITY_CELL) + 0.5) * CITY_CELL,
  };
}

/** Whether a point is in a city's built-up area (its lots and the avenues between them). */
export function inCityPlan(plan: CityPlan, x: number, z: number, margin = 0): boolean {
  const m = CITY_CELL + margin;
  return cityNorm((x - plan.x) / (plan.rx + m), (z - plan.z) / (plan.rz + m)) <= 1;
}

/** For tests and tools: the lot nearest a point. */
export function nearestLot(plan: CityPlan, x: number, z: number): CityLot | null {
  let best: CityLot | null = null;
  let bestD = Infinity;
  for (const l of plan.lots) {
    const d = D.hypot(l.x - x, l.z - z);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}
