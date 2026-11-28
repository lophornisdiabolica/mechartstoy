import { Battlefield, Bridge, BRIDGE_CLEARANCE, DECK_GRADE } from './battlefield';
import * as D from '../core/dmath';

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
/** Bridges' width: room for the biggest walkers to cross, but no wider (whole land routes are still the better way for them). */
export const BRIDGE_WIDTH = 5;
/** How far a bridge reaches onto the bank at each end. */
const BRIDGE_LANDING = 2;
/** Furthest a bridge end is pushed on past its bank to land square on dry ground (round a corner of the shore, say). */
const MAX_EXTEND = 8;
/** Highest a deck is raised above the usual clearance to meet high banks; banks higher still are cut down to it. */
const MAX_RAISE = 2.5;
/** How far a cutting reaches back into a bank that rises above the deck, and how steeply it climbs back to the ground. */
const APPROACH = 12;
const APPROACH_GRADE = 0.3;
/** How steeply the sides of a cutting rise. */
const BANK_GRADE = 0.8;

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

/** Minimal binary heap of indices keyed by a score array (an index can be pushed again after its score drops). */
export class Heap {
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
      if (D.hypot(vx(k) - site.x, vz(k) - site.z) <= site.radius + BASE_REACH) best = b;
    }
    return best;
  });
  const wet = baseBody.filter((b) => b >= 0).length;
  if (wet === 0 || (!options.everyBase && wet < 2)) return [];

  // Ground near base pads (and their aprons) is off limits: channels go round.
  const blocked = new Uint8Array(g.count);
  for (let k = 0; k < g.count; k++) {
    for (const s of sites) if (D.hypot(vx(k) - s.x, vz(k) - s.z) < s.radius + PAD_MARGIN) blocked[k] = 1;
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
        if (baseBody[i] >= 0 ? body[k] === baseBody[i] : !blocked[k] && D.hypot(vx(k) - s.x, vz(k) - s.z) < s.radius + PAD_MARGIN + 3) target[k] = i;
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
        const d = D.hypot(field.vertexX(i) - p.x, field.vertexZ(j) - p.z);
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
  for (let a = 0; a < 12; a++) ring.push({ x: at.x + D.cos((a / 12) * Math.PI * 2) * 3, z: at.z + D.sin((a / 12) * Math.PI * 2) * 3 });
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
        const len = Math.max(0.1, D.hypot(b.x - a.x, b.z - a.z));
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
        if (ends.every((e) => field.contains(e.x, e.z, 2) && !field.isWater(e.x, e.z)) && placeBridge(field, ends[0], ends[1])) built++;
      }
      start = -1;
    }
  }
  return built;
}

/**
 * Dry land (or a bridge deck) the first base can reach, per vertex: the
 * same land a tank could drive on, give or take steep ground (but not over
 * a sheer cliff, on maps with them).
 */
export function landReach(field: Battlefield): Uint8Array {
  const g = grid(field);
  const reach = new Uint8Array(g.count);
  const dry = (k: number) => {
    const x = field.vertexX(k % g.stride);
    const z = field.vertexZ(Math.floor(k / g.stride));
    return field.deckAt(x, z) !== null || (field.heights[k] >= field.seaLevel && !cliffBeside(field, x, z) && !wetBeside(field, x, z));
  };
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

/**
 * Whether any of the four cells round a vertex is a cliff face (see
 * Battlefield.cliffAt): going by cells, as routes do, so a cliff one cell
 * thick still walls the land off.
 */
function cliffBeside(field: Battlefield, x: number, z: number): boolean {
  if (!field.cliffs) return false;
  const h = field.config.cellSize / 2;
  return field.cliffAt(x - h, z - h) || field.cliffAt(x + h, z - h) || field.cliffAt(x - h, z + h) || field.cliffAt(x + h, z + h);
}

/**
 * On maps from the newer generator (see Battlefield.styled), whether any of the four cells round a vertex is under
 * water: going by cells, as routes do, so a neck of land too thin for a
 * route doesn't count as joining two shores. (Rolling maps without high
 * ground go by vertices alone, as they always have.)
 */
function wetBeside(field: Battlefield, x: number, z: number): boolean {
  if (!field.styled) return false;
  const h = field.config.cellSize / 2;
  const wet = (px: number, pz: number) => field.contains(px, pz) && field.isWater(px, pz) && field.deckAt(px, pz) === null;
  return wet(x - h, z - h) || wet(x + h, z - h) || wet(x - h, z + h) || wet(x + h, z + h);
}

/** The vertex nearest a world point. */
export function vertexAt(field: Battlefield, x: number, z: number): number {
  const { cols, rows, cellSize } = field.config;
  const i = Math.max(0, Math.min(cols, Math.round((x - field.bounds.minX) / cellSize)));
  const j = Math.max(0, Math.min(rows, Math.round((z - field.bounds.minZ) / cellSize)));
  return j * (cols + 1) + i;
}

/** Longest stretch of water a route over the water likes one bridge to span, on maps from the newer generator (see hopRoute). */
export const BRIDGE_REACH = 24;
/** A crossing longer than this is split by islets into stretches no longer than BRIDGE_REACH (a little over it isn't worth an islet). */
const ISLET_PAST = 32;
/** What a crossing costs per unit past BRIDGE_REACH, on top of its length, when choosing a route over the water. */
const LONG_COST = 4;
/** What each extra bridge costs a route (in units of bridge length): an island hop is worth it to save more than this. */
const HOP_COST = 10;
/** What walking over an island costs a route, per unit, against bridging. */
const WALK_COST = 0.3;
/** Fewest vertices a piece of land needs to be an island a route hops over (room to land a bridge on). */
const STONE_LEAST = 30;
/** An islet raised to split a long crossing: flat top radius, how far its shore slopes down, and how far above the sea it stands. */
const ISLET_RADIUS = 4.5;
const ISLET_SHORE = 3;
const ISLET_TOP = 0.8;

/**
 * Make sure every base (and any points in `also`) can be reached by land:
 * while one is cut off, bridge the shortest stretch of water between the
 * land the first base reaches and the land the cut-off one is on. On maps
 * from the newer generator, a route may hop over islands on the way, and
 * a stretch longer than ISLET_PAST is split by islets (see hopRoute and
 * spanWater), so an archipelago is joined by chains of short bridges, not
 * one across the map. Returns the number of bridges built.
 */
export function bridgeLand(field: Battlefield, also: { x: number; z: number }[] = []): number {
  const g = grid(field);
  const vx = (k: number) => field.vertexX(k % g.stride);
  const vz = (k: number) => field.vertexZ(Math.floor(k / g.stride));
  let built = 0;
  const rounds = (field.baseSites.length + also.length) * (field.styled ? 4 : 2);
  for (let round = 0; round < rounds; round++) {
    const reach = landReach(field);
    const cut = field.baseSites.find((s) => !reach[vertexAt(field, s.x, s.z)]) ?? also.find((s) => !reach[vertexAt(field, s.x, s.z)]);
    if (!cut) return built;
    // The land the cut-off base stands on.
    const island = new Uint8Array(g.count);
    const start = vertexAt(field, cut.x, cut.z);
    const stack = [start];
    island[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      for (const nk of neighbours(g, k)) {
        if (!island[nk] && field.heights[nk] >= field.seaLevel && !cliffBeside(field, vx(nk), vz(nk)) && !wetBeside(field, vx(nk), vz(nk))) {
          island[nk] = 1;
          stack.push(nk);
        }
      }
    }
    if (field.styled) {
      const route = hopRoute(field, g, reach, island);
      if (!route) return built;
      let made = 0;
      for (const [a, b] of route) made += spanWater(field, { x: vx(a), z: vz(a) }, { x: vx(b), z: vz(b) });
      if (made === 0) return built;
      built += made;
      continue;
    }
    // Shortest crossing: from every reachable shore vertex, spread over water until the island.
    const origin = new Int32Array(g.count).fill(-1);
    const dist = new Float64Array(g.count).fill(Infinity);
    const heap = new Heap(dist);
    let landing = -1;
    for (let k = 0; k < g.count; k++) {
      if (reach[k] && neighbours(g, k).some((n) => !reach[n])) {
        dist[k] = 0;
        origin[k] = k;
        heap.push(k);
      }
    }
    while (heap.size > 0) {
      const k = heap.pop();
      if (island[k]) {
        landing = k;
        break;
      }
      for (const nk of neighbours(g, k)) {
        if (reach[nk]) continue;
        // Straight-line distance from where the crossing started, so the bridge is as short as it can be.
        const d = D.hypot(vx(nk) - vx(origin[k]), vz(nk) - vz(origin[k]));
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
    const len = Math.max(0.1, D.hypot(b.x - a.x, b.z - a.z));
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    if (!placeBridge(field, { x: a.x - ux * BRIDGE_LANDING, z: a.z - uz * BRIDGE_LANDING }, { x: b.x + ux * BRIDGE_LANDING, z: b.z + uz * BRIDGE_LANDING }, true)) return built;
    built++;
  }
  return built;
}

/**
 * The cheapest way over the water from the land the first base reaches to
 * `island`, as the crossings to bridge (each from a vertex on one shore to
 * one on the next), in order. A route may land on islands on the way and
 * walk across them, so long as each hop saves more than HOP_COST; a
 * crossing longer than BRIDGE_REACH costs LONG_COST extra per unit, so
 * a route hops wherever there are islands to hop over. Keeps clear of the
 * bridges already there, so a new one doesn't start from another's side
 * (where its railing would wall the way off) or run across it; only if
 * there's no other way is it let through. Null if there's no way at all.
 */
function hopRoute(field: Battlefield, g: Grid, reach: Uint8Array, island: Uint8Array): [number, number][] | null {
  const vx = (k: number) => field.vertexX(k % g.stride);
  const vz = (k: number) => field.vertexZ(Math.floor(k / g.stride));
  const sea = field.seaLevel;
  const ground = (k: number) => field.heights[k] >= sea && !cliffBeside(field, vx(k), vz(k)) && !wetBeside(field, vx(k), vz(k));
  // The size of the piece of land each unreached vertex is on (0 for water), to tell islands from specks.
  const mass = new Int32Array(g.count);
  for (let k = 0; k < g.count; k++) {
    if (mass[k] || reach[k] || island[k] || !ground(k)) continue;
    const piece = [k];
    mass[k] = -1;
    for (let n = 0; n < piece.length; n++) {
      for (const nk of neighbours(g, piece[n])) {
        if (!mass[nk] && !reach[nk] && !island[nk] && ground(nk)) {
          mass[nk] = -1;
          piece.push(nk);
        }
      }
    }
    for (const p of piece) mass[p] = piece.length;
  }
  const stone = (k: number) => island[k] === 1 || mass[k] >= STONE_LEAST;
  const span = (d: number) => (d <= BRIDGE_REACH ? d : d + (d - BRIDGE_REACH) * LONG_COST);
  const clear = (k: number) => !field.nearBridge(vx(k), vz(k), BRIDGE_WIDTH * 0.5 + 1.5);
  for (const keepClear of field.bridges.length > 0 ? [true, false] : [false]) {
    const cost = new Float64Array(g.count).fill(Infinity);
    /** Per vertex: on land, the vertex itself; over water, the land vertex the crossing set out from. */
    const origin = new Int32Array(g.count).fill(-1);
    /** Per land vertex: the one before it on the route (the last step over land, or where the bridge to it starts). */
    const back = new Int32Array(g.count).fill(-1);
    const bridged = new Uint8Array(g.count);
    const done = new Uint8Array(g.count);
    const heap = new Heap(cost);
    for (let k = 0; k < g.count; k++) {
      if (reach[k] && neighbours(g, k).some((n) => !reach[n]) && (!keepClear || clear(k))) {
        cost[k] = 0;
        origin[k] = k;
        heap.push(k);
      }
    }
    let landing = -1;
    while (heap.size > 0) {
      const k = heap.pop();
      if (done[k]) continue;
      done[k] = 1;
      if (island[k]) {
        landing = k;
        break;
      }
      const onLand = origin[k] === k;
      const from = onLand ? k : origin[k];
      for (const nk of neighbours(g, k)) {
        if (reach[nk] || done[nk] || (keepClear && !clear(nk))) continue;
        let c: number;
        if (stone(nk)) {
          // Walking on over an island, or landing on one.
          c = onLand ? cost[k] + D.hypot(vx(nk) - vx(k), vz(nk) - vz(k)) * WALK_COST : cost[from] + span(D.hypot(vx(nk) - vx(from), vz(nk) - vz(from))) + HOP_COST;
          if (c < cost[nk]) {
            cost[nk] = c;
            origin[nk] = nk;
            back[nk] = onLand ? k : from;
            bridged[nk] = onLand ? 0 : 1;
            heap.push(nk);
          }
        } else {
          // Over the water (or a speck of land) from the last shore: straight-line distance, so the bridge is as short as it can be.
          c = cost[from] + span(D.hypot(vx(nk) - vx(from), vz(nk) - vz(from)));
          if (c < cost[nk]) {
            cost[nk] = c;
            origin[nk] = from;
            heap.push(nk);
          }
        }
      }
    }
    if (landing < 0) continue;
    const route: [number, number][] = [];
    for (let v = landing; v >= 0 && !reach[v]; v = back[v]) if (bridged[v]) route.unshift([back[v], v]);
    return route;
  }
  return null;
}

/**
 * Bridge the water from shore vertex `a` to shore vertex `b`: one bridge,
 * or, if it's further than ISLET_PAST, a chain of them no longer than
 * BRIDGE_REACH, with an islet raised between each two. Returns the number of bridges built.
 */
function spanWater(field: Battlefield, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const len = Math.max(0.1, D.hypot(b.x - a.x, b.z - a.z));
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const parts = len > ISLET_PAST ? Math.ceil(len / BRIDGE_REACH) : 1;
  const at = (n: number) => ({ x: a.x + (ux * len * n) / parts, z: a.z + (uz * len * n) / parts });
  for (let n = 1; n < parts; n++) raiseIslet(field, at(n).x, at(n).z);
  // Each bridge reaches onto the bank at the map's shores, and a little way onto each islet.
  const onto = ISLET_RADIUS - 1.5;
  let built = 0;
  for (let n = 0; n < parts; n++) {
    const p = at(n);
    const q = at(n + 1);
    const back = n === 0 ? BRIDGE_LANDING : -onto;
    const on = n === parts - 1 ? BRIDGE_LANDING : -onto;
    if (placeBridge(field, { x: p.x - ux * back, z: p.z - uz * back }, { x: q.x + ux * on, z: q.z + uz * on }, true)) built++;
  }
  return built;
}

/** Raise a small round islet out of the sea at (x, z): flat on top, ISLET_TOP above the water, its shore sloping down to the seabed. */
function raiseIslet(field: Battlefield, x: number, z: number): void {
  const g = grid(field);
  const top = field.seaLevel + ISLET_TOP;
  const out = ISLET_RADIUS + ISLET_SHORE;
  const { cellSize } = field.config;
  const i0 = Math.max(0, Math.floor((x - out - field.bounds.minX) / cellSize));
  const i1 = Math.min(g.cols, Math.ceil((x + out - field.bounds.minX) / cellSize));
  const j0 = Math.max(0, Math.floor((z - out - field.bounds.minZ) / cellSize));
  const j1 = Math.min(g.rows, Math.ceil((z + out - field.bounds.minZ) / cellSize));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * g.stride + i;
      const h = field.heights[k];
      if (h >= top) continue;
      const d = D.hypot(field.vertexX(i) - x, field.vertexZ(j) - z);
      if (d >= out) continue;
      const f = d <= ISLET_RADIUS ? 1 : 1 - (d - ISLET_RADIUS) / ISLET_SHORE;
      const t = f * f * (3 - 2 * f);
      field.heights[k] = h + (top - h) * t;
    }
  }
}

/**
 * Build a bridge from about `a` to about `b`, fitted to the banks:
 *
 * - each end is pushed on along the bridge's line until its whole width is
 *   on dry ground, so a bridge that meets the shore at a corner doesn't stop
 *   half over the water;
 * - the deck sits at the usual clearance over the water, or a little higher
 *   to meet two high banks;
 * - a bank that rises above the deck is cut down to it, with a cutting that
 *   climbs back to the ground no steeper than APPROACH_GRADE, so the deck
 *   never runs into a hillside and its ends are never steep.
 *
 * Returns false (and builds nothing) if it would overlap another bridge,
 * unless `force` (a base would otherwise be cut off).
 */
export function placeBridge(field: Battlefield, a: { x: number; z: number }, b: { x: number; z: number }, force = false, extra: Partial<Bridge> = {}): boolean {
  const len0 = D.hypot(b.x - a.x, b.z - a.z);
  if (len0 < 0.1) return false;
  const ux = (b.x - a.x) / len0;
  const uz = (b.z - a.z) / len0;
  const nx = -uz;
  const nz = ux;
  const half = BRIDGE_WIDTH / 2;
  const sea = field.seaLevel;
  // Dry across the whole width here, and a step further on.
  const dryAt = (x: number, z: number) => [-1, -0.5, 0, 0.5, 1].every((f) => field.heightAt(x + nx * half * f, z + nz * half * f) >= sea + 0.15);
  const landed = (p: { x: number; z: number }, out: number) => {
    for (let e = 0; e <= MAX_EXTEND; e += 0.5) {
      const x = p.x + ux * out * e;
      const z = p.z + uz * out * e;
      if (!field.contains(x, z, half + 1)) break;
      if (dryAt(x, z) && dryAt(x + ux * out, z + uz * out)) return { x, z };
    }
    return p;
  };
  const A = landed(a, -1);
  const B = landed(b, 1);
  if (!force) {
    for (let t = 0; t <= 1; t += 0.1) if (field.nearBridge(A.x + (B.x - A.x) * t, A.z + (B.z - A.z) * t, half)) return false;
  }
  const ga = field.heightAt(A.x, A.z);
  const gb = field.heightAt(B.x, B.z);
  const low = sea + BRIDGE_CLEARANCE;
  const bridge: Bridge = { ax: A.x, az: A.z, bx: B.x, bz: B.z, width: BRIDGE_WIDTH, level: Math.max(low, Math.min(ga, gb, low + MAX_RAISE)), ...extra };
  cutBanks(field, bridge);
  field.addBridge(bridge);
  return true;
}

/**
 * Put a bridge over a dry chasm, from rim a to rim b (engineers', see
 * Engineers.chasmBridge): the deck level with the lower rim, the higher cut
 * down to meet it (cutBanks). Unlike placeBridge, the ends stay where
 * they're put: there's no water to carry them past. False (and nothing
 * built) if it would overlap another bridge.
 */
export function spanChasm(field: Battlefield, a: { x: number; z: number }, b: { x: number; z: number }, extra: Partial<Bridge> = {}): boolean {
  const len = D.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.1) return false;
  const half = BRIDGE_WIDTH / 2;
  for (let t = 0; t <= 1; t += 0.1) if (field.nearBridge(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, half)) return false;
  const level = Math.max(field.seaLevel + BRIDGE_CLEARANCE, Math.min(field.heightAt(a.x, a.z), field.heightAt(b.x, b.z)));
  const bridge: Bridge = { ax: a.x, az: a.z, bx: b.x, bz: b.z, width: BRIDGE_WIDTH, level, ...extra };
  cutBanks(field, bridge);
  field.addBridge(bridge);
  return true;
}

/**
 * Cut the ground down wherever it rises above a bridge's deck or its
 * approaches: under the deck, and in a cutting at each end that climbs back
 * to the ground no steeper than APPROACH_GRADE, with sides no steeper than
 * BANK_GRADE. Base pads are left alone. Map generation runs this again for
 * every bridge once towns and outposts have levelled their ground.
 */
export function cutBanks(field: Battlefield, bridge: Bridge): void {
  const { ax, az, bx, bz, level } = bridge;
  const len = D.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const half = bridge.width / 2;
  const sea = field.seaLevel;
  const ha = Math.min(level, field.heightAt(ax, az));
  const hb = Math.min(level, field.heightAt(bx, bz));
  const deck = (s: number) => Math.min(level, ha + DECK_GRADE * s, hb + DECK_GRADE * (len - s));
  const { cols, rows } = field.config;
  const reach = APPROACH + half + 3;
  const [i0, j0] = field.cellAt(Math.min(ax, bx) - reach, Math.min(az, bz) - reach);
  const [i1, j1] = field.cellAt(Math.max(ax, bx) + reach, Math.max(az, bz) + reach);
  let cut = false;
  for (let j = j0; j <= Math.min(rows, j1 + 1); j++) {
    for (let i = i0; i <= Math.min(cols, i1 + 1); i++) {
      const x = field.vertexX(i);
      const z = field.vertexZ(j);
      const s = (x - ax) * ux + (z - az) * uz;
      const side = Math.max(0, Math.abs((x - ax) * -uz + (z - az) * ux) - half - 0.5);
      let target: number;
      if (s < 0) target = -s > APPROACH ? Infinity : ha - 0.05 + APPROACH_GRADE * -s;
      else if (s > len) target = s - len > APPROACH ? Infinity : hb - 0.05 + APPROACH_GRADE * (s - len);
      else target = deck(s) - 0.05;
      // Never down into the water.
      target = Math.max(target + BANK_GRADE * side, sea + 0.1);
      const k = j * (cols + 1) + i;
      if (field.heights[k] <= target) continue;
      if (field.baseSites.some((site) => D.hypot(site.x - x, site.z - z) < site.radius)) continue;
      field.heights[k] = target;
      cut = true;
    }
  }
  if (cut) field.changed({ i0: Math.max(0, i0 - 1), j0: Math.max(0, j0 - 1), i1: Math.min(cols - 1, i1 + 1), j1: Math.min(rows - 1, j1 + 1) });
}
