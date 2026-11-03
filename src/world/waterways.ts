import { Battlefield, BRIDGE_CLEARANCE } from './battlefield';

/**
 * Water that links up, and bridges that cross it.
 *
 * Noise makes lakes, and on its own rarely joins them up: even very wet maps
 * left each base on its own pond, so boats had nowhere to go. When the bases
 * have water near them, `carveWaterways` digs channels joining that water
 * (and, on wet enough maps, an inlet to any base that has none), so there's
 * a water route between the bases. `bridgeLand` then makes sure every base
 * can still be reached by land, with bridges over the water rather than
 * causeways that would cut the waterways.
 *
 * Both work on the heightmap's vertices (the corners of map cells).
 */

/** Water at least this deep counts as navigable when measuring bodies of water (boats need 0.2; docks want 0.5). */
const NAVIGABLE = 0.5;
/** A body of navigable water with fewer vertices than this is a pond, not worth linking. */
const MIN_BODY = 60;
/** How far past a base's pad its water may be and still count as the base's. */
const BASE_REACH = 14;
/** Channel half-width (world units), and how far below sea level its middle is dug. */
const CHANNEL_RADIUS = 2.8;
const CHANNEL_DEPTH = 1.3;
/** Room kept round base pads, towns' future spots aside: channels go round, not through. */
const PAD_MARGIN = 3;
/** Bridges' width: room for the biggest walkers to cross. */
export const BRIDGE_WIDTH = 7;
/** How far a bridge reaches onto the bank at each end. */
const BRIDGE_LANDING = 2;

export interface WaterwayOptions {
  /**
   * Give every base water, digging an inlet to any that has none (from about
   * 0.6 water up). Otherwise only the bases that already have water nearby
   * are joined, and only when at least two do.
   */
  everyBase: boolean;
}

interface Grid {
  cols: number;
  rows: number;
  /** Vertices per row: cols + 1. */
  stride: number;
  count: number;
}

function grid(field: Battlefield): Grid {
  const { cols, rows } = field.config;
  return { cols, rows, stride: cols + 1, count: (cols + 1) * (rows + 1) };
}

function neighbours(g: Grid, k: number): number[] {
  const i = k % g.stride;
  const j = (k - i) / g.stride;
  const out: number[] = [];
  if (i > 0) out.push(k - 1);
  if (i < g.cols) out.push(k + 1);
  if (j > 0) out.push(k - g.stride);
  if (j < g.rows) out.push(k + g.stride);
  return out;
}

/** Label connected bodies of navigable water: an id per vertex (-1 for none) and each body's size. */
function waterBodies(field: Battlefield, g: Grid): { body: Int32Array; size: number[] } {
  const body = new Int32Array(g.count).fill(-1);
  const size: number[] = [];
  const deep = (k: number) => field.seaLevel - field.heights[k] >= NAVIGABLE;
  for (let start = 0; start < g.count; start++) {
    if (body[start] >= 0 || !deep(start)) continue;
    const id = size.length;
    let n = 0;
    const stack = [start];
    body[start] = id;
    while (stack.length) {
      const k = stack.pop()!;
      n++;
      for (const nk of neighbours(g, k)) {
        if (body[nk] < 0 && deep(nk)) {
          body[nk] = id;
          stack.push(nk);
        }
      }
    }
    size.push(n);
  }
  return { body, size };
}

/** Minimal binary heap of vertex indices keyed by a score array. */
class Heap {
  private items: number[] = [];
  constructor(private readonly score: Float64Array) {}
  get size(): number {
    return this.items.length;
  }
  push(i: number): void {
    const a = this.items;
    a.push(i);
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.score[a[p]] <= this.score[a[c]]) break;
      [a[p], a[c]] = [a[c], a[p]];
      c = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < a.length && this.score[a[l]] < this.score[a[m]]) m = l;
        if (r < a.length && this.score[a[r]] < this.score[a[m]]) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}

/** A channel dug by carveWaterways: points along its middle, and which of them were dry land before. */
export interface Channel {
  points: { x: number; z: number }[];
  dry: boolean[];
}

/**
 * Dig channels so the bases' water is joined into one network. Returns the
 * channels dug (for bridges and tests).
 */
export function carveWaterways(field: Battlefield, options: WaterwayOptions): Channel[] {
  if (field.seaLevel < 0.5) return [];
  const g = grid(field);
  const { body, size } = waterBodies(field, g);
  const vx = (k: number) => field.vertexX(k % g.stride);
  const vz = (k: number) => field.vertexZ(Math.floor(k / g.stride));
  const sites = field.baseSites;

  // Each base's water: the biggest body within reach of its pad, if any.
  const baseBody = sites.map((site) => {
    let best = -1;
    for (let k = 0; k < g.count; k++) {
      const b = body[k];
      if (b < 0 || size[b] < MIN_BODY || (best >= 0 && size[b] <= size[best])) continue;
      if (Math.hypot(vx(k) - site.x, vz(k) - site.z) <= site.radius + BASE_REACH) best = b;
    }
    return best;
  });
  const wet = baseBody.filter((b) => b >= 0).length;
  if (wet === 0 || (!options.everyBase && wet < 2)) return [];

  // Ground near base pads (and their aprons) is off limits: channels go round.
  const blocked = new Uint8Array(g.count);
  for (let k = 0; k < g.count; k++) {
    for (const s of sites) if (Math.hypot(vx(k) - s.x, vz(k) - s.z) < s.radius + PAD_MARGIN) blocked[k] = 1;
  }
  // What it costs to take a channel through a vertex: water is nearly free, dry land costs by how much has to be dug.
  const stepCost = (k: number) => {
    const h = field.heights[k];
    if (h < field.seaLevel - NAVIGABLE) return 0.2;
    return 3 + Math.max(0, h - field.seaLevel) * 2.5;
  };

  // Grow a network from the first wet base's water, joining the nearest unjoined base each time.
  const joined = new Uint8Array(g.count);
  const join = (b: number) => {
    for (let k = 0; k < g.count; k++) if (body[k] === b) joined[k] = 1;
  };
  const pending = sites.map((_, i) => i).filter((i) => options.everyBase || baseBody[i] >= 0);
  const first = pending.find((i) => baseBody[i] >= 0)!;
  join(baseBody[first]);
  pending.splice(pending.indexOf(first), 1);
  const channels: Channel[] = [];

  const score = new Float64Array(g.count);
  const from = new Int32Array(g.count);
  while (pending.length > 0) {
    // Targets: every pending base's water, or for a dry base, a ring just outside its pad.
    const target = new Int32Array(g.count).fill(-1);
    for (const i of pending) {
      const s = sites[i];
      for (let k = 0; k < g.count; k++) {
        if (baseBody[i] >= 0 ? body[k] === baseBody[i] : !blocked[k] && Math.hypot(vx(k) - s.x, vz(k) - s.z) < s.radius + PAD_MARGIN + 3) target[k] = i;
      }
    }
    score.fill(Infinity);
    from.fill(-1);
    const heap = new Heap(score);
    for (let k = 0; k < g.count; k++) {
      if (joined[k]) {
        score[k] = 0;
        heap.push(k);
      }
    }
    let hit = -1;
    while (heap.size > 0) {
      const k = heap.pop();
      if (target[k] >= 0 && !joined[k]) {
        hit = k;
        break;
      }
      for (const nk of neighbours(g, k)) {
        if (blocked[nk] && target[nk] < 0) continue;
        const s = score[k] + stepCost(nk);
        if (s < score[nk]) {
          score[nk] = s;
          from[nk] = k;
          heap.push(nk);
        }
      }
    }
    if (hit < 0) break;
    const reached = target[hit];
    pending.splice(pending.indexOf(reached), 1);
    // Walk back to the network, digging as we go.
    const path: number[] = [];
    for (let k = hit; k >= 0 && !joined[k]; k = from[k]) path.push(k);
    const points = path.map((k) => ({ x: vx(k), z: vz(k) }));
    const dry = path.map((k) => field.heights[k] >= field.seaLevel);
    dig(field, points);
    // A dry base's inlet ends in a basin by its pad, big enough to count as open water for a dock.
    if (baseBody[reached] < 0) basin(field, points[0]);
    channels.push({ points, dry });
    for (const k of path) joined[k] = 1;
    if (baseBody[reached] >= 0) join(baseBody[reached]);
  }
  return channels;
}

/** Lower the ground along a path into a channel: deepest in the middle, sloping up to the banks. */
function dig(field: Battlefield, points: { x: number; z: number }[]): void {
  const bottom = field.seaLevel - CHANNEL_DEPTH;
  const { cols, rows } = field.config;
  const stride = cols + 1;
  const r = CHANNEL_RADIUS + 1.5;
  for (const p of points) {
    const [ci, cj] = [Math.round((p.x - field.bounds.minX) / field.config.cellSize), Math.round((p.z - field.bounds.minZ) / field.config.cellSize)];
    const span = Math.ceil(r / field.config.cellSize);
    for (let j = Math.max(0, cj - span); j <= Math.min(rows, cj + span); j++) {
      for (let i = Math.max(0, ci - span); i <= Math.min(cols, ci + span); i++) {
        const d = Math.hypot(field.vertexX(i) - p.x, field.vertexZ(j) - p.z);
        if (d > r) continue;
        // Full depth inside the channel, easing up to the bank over the last stretch.
        const t = Math.min(1, Math.max(0, (d - CHANNEL_RADIUS * 0.6) / (r - CHANNEL_RADIUS * 0.6)));
        const want = bottom + (field.seaLevel + 0.2 - bottom) * t * t;
        const k = j * stride + i;
        if (field.heights[k] > want) field.heights[k] = want;
      }
    }
  }
}

/** A small round harbour at the end of an inlet. */
function basin(field: Battlefield, at: { x: number; z: number }): void {
  const ring: { x: number; z: number }[] = [];
  for (let a = 0; a < 12; a++) ring.push({ x: at.x + Math.cos((a / 12) * Math.PI * 2) * 3, z: at.z + Math.sin((a / 12) * Math.PI * 2) * 3 });
  dig(field, [at, ...ring]);
}

/** A channel dug through this many vertices of dry land in a row gets a bridge over the middle of that stretch. */
const BRIDGE_RUN = 6;

/**
 * Bridge each channel where it cut through land, so the land on either side
 * stays joined where it was: one bridge in the middle of every long enough
 * dry stretch, square across the channel. Returns the number built.
 */
export function bridgeChannels(field: Battlefield, channels: Channel[]): number {
  let built = 0;
  for (const { points, dry } of channels) {
    let start = -1;
    for (let k = 0; k <= points.length; k++) {
      if (k < points.length && dry[k]) {
        if (start < 0) start = k;
        continue;
      }
      if (start >= 0 && k - start >= BRIDGE_RUN) {
        const mid = Math.floor((start + k - 1) / 2);
        const a = points[Math.max(0, mid - 2)];
        const b = points[Math.min(points.length - 1, mid + 2)];
        const len = Math.max(0.1, Math.hypot(b.x - a.x, b.z - a.z));
        // Square across the channel's direction.
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        const half = CHANNEL_RADIUS + 1.5 + BRIDGE_LANDING;
        const c = points[mid];
        const ends = [
          { x: c.x - nx * half, z: c.z - nz * half },
          { x: c.x + nx * half, z: c.z + nz * half },
        ];
        // Only where both ends land on dry ground on the map, clear of other bridges.
        if (ends.every((e) => field.contains(e.x, e.z, 2) && !field.isWater(e.x, e.z)) && field.deckAt(c.x, c.z) === null) {
          field.addBridge({ ax: ends[0].x, az: ends[0].z, bx: ends[1].x, bz: ends[1].z, width: BRIDGE_WIDTH, level: field.seaLevel + BRIDGE_CLEARANCE });
          built++;
        }
      }
      start = -1;
    }
  }
  return built;
}

/**
 * Dry land (or a bridge deck) the first base can reach, per vertex: the
 * same land a tank could drive on, give or take steep ground.
 */
export function landReach(field: Battlefield): Uint8Array {
  const g = grid(field);
  const reach = new Uint8Array(g.count);
  const dry = (k: number) => field.heights[k] >= field.seaLevel || field.deckAt(field.vertexX(k % g.stride), field.vertexZ(Math.floor(k / g.stride))) !== null;
  const site = field.baseSites[0];
  const start = vertexAt(field, site.x, site.z);
  const stack = [start];
  reach[start] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    for (const nk of neighbours(g, k)) {
      if (!reach[nk] && dry(nk)) {
        reach[nk] = 1;
        stack.push(nk);
      }
    }
  }
  return reach;
}

/** The vertex nearest a world point. */
export function vertexAt(field: Battlefield, x: number, z: number): number {
  const { cols, rows, cellSize } = field.config;
  const i = Math.max(0, Math.min(cols, Math.round((x - field.bounds.minX) / cellSize)));
  const j = Math.max(0, Math.min(rows, Math.round((z - field.bounds.minZ) / cellSize)));
  return j * (cols + 1) + i;
}

/**
 * Make sure every base can be reached by land: while some base is cut off,
 * bridge the shortest stretch of water between the land the first base
 * reaches and the land the cut-off base is on. Returns the number of bridges built.
 */
export function bridgeLand(field: Battlefield): number {
  const g = grid(field);
  const vx = (k: number) => field.vertexX(k % g.stride);
  const vz = (k: number) => field.vertexZ(Math.floor(k / g.stride));
  let built = 0;
  for (let round = 0; round < field.baseSites.length * 2; round++) {
    const reach = landReach(field);
    const cut = field.baseSites.find((s) => !reach[vertexAt(field, s.x, s.z)]);
    if (!cut) return built;
    // The land the cut-off base stands on.
    const island = new Uint8Array(g.count);
    const start = vertexAt(field, cut.x, cut.z);
    const stack = [start];
    island[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      for (const nk of neighbours(g, k)) {
        if (!island[nk] && field.heights[nk] >= field.seaLevel) {
          island[nk] = 1;
          stack.push(nk);
        }
      }
    }
    // Shortest crossing: from every reachable shore vertex, spread over water until the island.
    const origin = new Int32Array(g.count).fill(-1);
    const dist = new Float64Array(g.count).fill(Infinity);
    const heap = new Heap(dist);
    for (let k = 0; k < g.count; k++) {
      if (reach[k] && neighbours(g, k).some((n) => !reach[n])) {
        dist[k] = 0;
        origin[k] = k;
        heap.push(k);
      }
    }
    let landing = -1;
    while (heap.size > 0) {
      const k = heap.pop();
      if (island[k]) {
        landing = k;
        break;
      }
      for (const nk of neighbours(g, k)) {
        if (reach[nk]) continue;
        // Straight-line distance from where the crossing started, so the bridge is as short as it can be.
        const d = Math.hypot(vx(nk) - vx(origin[k]), vz(nk) - vz(origin[k]));
        if (d < dist[nk]) {
          dist[nk] = d;
          origin[nk] = origin[k];
          heap.push(nk);
        }
      }
    }
    if (landing < 0) return built;
    const a = { x: vx(origin[landing]), z: vz(origin[landing]) };
    const b = { x: vx(landing), z: vz(landing) };
    const len = Math.max(0.1, Math.hypot(b.x - a.x, b.z - a.z));
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    field.addBridge({
      ax: a.x - ux * BRIDGE_LANDING,
      az: a.z - uz * BRIDGE_LANDING,
      bx: b.x + ux * BRIDGE_LANDING,
      bz: b.z + uz * BRIDGE_LANDING,
      width: BRIDGE_WIDTH,
      level: field.seaLevel + BRIDGE_CLEARANCE,
    });
    built++;
  }
  return built;
}
