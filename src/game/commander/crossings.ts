import { SimContext } from '../context';
import { Heap, Point } from '../../world/navGrid';
import * as D from '../../core/dmath';

/*
 * Crossings: whether there's still a way across the map wide enough for
 * the biggest land units, and if not, where it's cut. Craters (see
 * craters.ts), quakes and the god powers' terrain brush can leave water
 * where the map had none; once that, or anything else, leaves no
 * comfortable way from a side's base to its enemy's, engineers of any side
 * fill the gap in with earth, however deep it is, and throw one of their
 * timber bridges over it meanwhile (see Engineers.crossingJobs), so a
 * battle can't be walled into a stalemate.
 *
 * Only water that wasn't there when the map was made is filled however
 * deep (and never a Tidewater canal); the map's own sea, lakes and rivers
 * only where they're shallows. Only the terrain counts (buildings and walls
 * come and go, and so do engineers' timber bridges, so a gap under one
 * still gets filled in). The way is measured on the land route grid: a
 * cell is comfortable when it's at least COMFORT from any cell tracked
 * vehicles can't enter.
 *
 * Each side picks its own place to cross (gap's `danger`): where its own
 * units are and the enemy's aren't, so its engineers can finish the work
 * instead of being shot off it, and two sides cutting across the same
 * water mostly do it in different places.
 */

/** Room a way across needs: a super unit's radius (the widest is 2.1), plus a little. */
export const COMFORT = 2.2;
/** Deepest of the map's own water (below the sea) engineers fill in: shallows, not lakes or rivers. */
export const FILL_DEEPEST = 0.5;
/** What a cell costs a search for the way to fix, per step: comfortable, too tight, and water to fill (plus per metre of depth). */
const COST_OPEN = 1;
const COST_TIGHT = 4;
const COST_FILL = 12;
const COST_DEPTH = 20;
/** Comfortable stretches this short (in cells) inside a gap are counted as part of it. */
const GAP_JOIN = 2;

/** Where the way across is cut: the cells to fill (their centres, home side first), whether any is water, and the open ground either side. */
export interface Gap {
  points: Point[];
  water: boolean;
  before: Point;
  after: Point;
  /** The first and last cells of it that are water (a bridge goes from just before one to just past the other). */
  wetFrom: Point;
  wetTo: Point;
}

/** Extra cost of filling a cell at a point (where the enemy is), for a side choosing where to cross. */
export type Danger = (x: number, z: number) => number;

/** A stretch of water that's never filled in (a Tidewater canal or basin): a segment and its half width. */
export interface KeptWater {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/** The terrain half of a search, the same whoever is crossing: what's blocked, and what each cell costs. */
interface Terrain {
  land: number;
  naval: number;
  blocked: Uint8Array;
  cost: Float32Array;
}

export class Crossings {
  /** Whether there was a comfortable way between two points, for the land and boat grids' passable versions. */
  private known = new Map<string, { land: number; naval: number; gap: Gap | null }>();
  private terrainNow: Terrain | null = null;
  /** Per route cell, 1 where it's in the map's own boat water that's somewhere deeper than FILL_DEEPEST (a lake, the sea or a river), for a naval grid passable version. */
  private boats: { version: number; deep: Uint8Array } | null = null;
  /** Water never to fill (canals and basins), set by the engineers before they search. */
  kept: KeptWater[] = [];

  /**
   * Where the way from a to b (base to base) is cut for big land units, or
   * null if there's a comfortable way (or no way that filling in would
   * open). Without `danger` it's remembered until the terrain changes; with
   * it, the cut is looked for where filling costs least once the danger at
   * each cell is added.
   */
  gap(ctx: SimContext, a: Point, b: Point, danger?: Danger): Gap | null {
    const key = `${Math.round(a.x)},${Math.round(a.z)}>${Math.round(b.x)},${Math.round(b.z)}`;
    const land = ctx.navs.land.passableVersion;
    const naval = ctx.navs.for('naval').passableVersion;
    let was = this.known.get(key);
    if (!was || was.land !== land || was.naval !== naval) {
      was = { land, naval, gap: findGap(ctx, a, b, this.terrain(ctx)) };
      this.known.set(key, was);
    }
    // Whether there's a gap at all doesn't depend on the danger; where it's best crossed does.
    if (!was.gap || !danger) return was.gap;
    return findGap(ctx, a, b, this.terrain(ctx), danger) ?? was.gap;
  }

  /** What's blocked for big land units and what filling each cell costs, for the current terrain. */
  private terrain(ctx: SimContext): Terrain {
    const land = ctx.navs.land.passableVersion;
    const naval = ctx.navs.for('naval').passableVersion;
    const now = this.terrainNow;
    if (now && now.land === land && now.naval === naval) return now;
    const boats = this.boatWater(ctx);
    const { field } = ctx;
    const nav = ctx.navs.land;
    const { cols, rows, cellSize } = nav;
    const n = cols * rows;
    const centre = (k: number) => nav.center(k % cols, Math.floor(k / cols));
    const blocked = new Uint8Array(n);
    // Engineers' timber bridges don't count: they come down again, so the gap under one still wants filling.
    const timber = field.bridges.some((br) => br.builtBy !== undefined && !br.gone);
    for (let k = 0; k < n; k++) {
      const c = centre(k);
      blocked[k] = nav.terrainBlocksCell(c.x, c.z) ? 1 : 0;
      if (!blocked[k] && timber && field.isWater(c.x, c.z)) {
        const br = field.bridgeAt(c.x, c.z);
        if (br >= 0 && field.bridges[br].builtBy !== undefined) blocked[k] = 1;
      }
    }
    const room = clearance(blocked, cols, rows, cellSize);
    // What each cell costs a way through it: Infinity where filling can't help (the map's deep water, canals, map bridges' rivers).
    const cost = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (!blocked[k]) {
        cost[k] = room[k] >= COMFORT ? COST_OPEN : COST_TIGHT;
        continue;
      }
      const c = centre(k);
      const depth = field.seaLevel - field.heightAt(c.x, c.z);
      const made = !field.wasWater(c.x, c.z);
      const fillable =
        depth > 0 &&
        (made ? !this.kept.some((w) => distanceToSegment(c.x, c.z, w) <= w.half + 1) : depth <= FILL_DEEPEST && !boats[k]) &&
        field.contains(c.x, c.z, 2) &&
        (field.deckAt(c.x, c.z) === null || field.bridges[field.bridgeAt(c.x, c.z)].builtBy !== undefined);
      cost[k] = fillable ? COST_FILL + depth * COST_DEPTH : Infinity;
    }
    this.terrainNow = { land, naval, blocked, cost };
    return this.terrainNow;
  }

  /**
   * Which route cells are in the map's own boat water joined to something
   * deeper than FILL_DEEPEST (a lake, the sea or a river), so filling its
   * shallows never cuts boats off.
   */
  private boatWater(ctx: SimContext): Uint8Array {
    const naval = ctx.navs.for('naval');
    if (this.boats && this.boats.version === naval.passableVersion) return this.boats.deep;
    const nav = ctx.navs.land;
    const { field } = ctx;
    const { cols, rows } = nav;
    const deep = new Uint8Array(cols * rows);
    const wet = new Uint8Array(cols * rows);
    for (let k = 0; k < wet.length; k++) {
      const c = nav.center(k % cols, Math.floor(k / cols));
      wet[k] = naval.terrainAllowsAt(c.x, c.z) ? 1 : 0;
    }
    const seen = new Uint8Array(cols * rows);
    const body: number[] = [];
    for (let s = 0; s < wet.length; s++) {
      if (!wet[s] || seen[s]) continue;
      body.length = 0;
      let deepest = 0;
      const stack = [s];
      seen[s] = 1;
      while (stack.length > 0) {
        const k = stack.pop()!;
        body.push(k);
        const c = nav.center(k % cols, Math.floor(k / cols));
        // Only the map's own water counts: a deep hole dug since doesn't make the shallows by it a lake.
        if (field.wasWater(c.x, c.z)) deepest = Math.max(deepest, field.seaLevel - field.heightAt(c.x, c.z));
        const i = k % cols;
        const j = (k - i) / cols;
        for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nk = nj * cols + ni;
          if (!wet[nk] || seen[nk]) continue;
          seen[nk] = 1;
          stack.push(nk);
        }
      }
      if (deepest > FILL_DEEPEST) for (const k of body) deep[k] = 1;
    }
    this.boats = { version: naval.passableVersion, deep };
    return deep;
  }
}

function distanceToSegment(x: number, z: number, w: KeptWater): number {
  const dx = w.bx - w.ax;
  const dz = w.bz - w.az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - w.ax) * dx + (z - w.az) * dz) / len2)) : 0;
  return D.hypot(x - (w.ax + dx * t), z - (w.az + dz * t));
}

function findGap(ctx: SimContext, a: Point, b: Point, terrain: Terrain, danger?: Danger): Gap | null {
  const nav = ctx.navs.land;
  const { cols, rows } = nav;
  const n = cols * rows;
  const centre = (k: number) => nav.center(k % cols, Math.floor(k / cols));
  const { blocked } = terrain;
  let cost = terrain.cost;
  if (danger) {
    cost = cost.slice();
    for (let k = 0; k < n; k++) {
      if (!blocked[k] || !Number.isFinite(cost[k])) continue;
      const c = centre(k);
      cost[k] = Math.max(COST_FILL * 0.5, cost[k] + danger(c.x, c.z));
    }
  }
  const [ai, aj] = nav.cellOf(a.x, a.z);
  const [bi, bj] = nav.cellOf(b.x, b.z);
  const start = aj * cols + ai;
  const goal = bj * cols + bi;
  if (!Number.isFinite(cost[start]) || !Number.isFinite(cost[goal])) return null;

  // First the easy question: is there a comfortable way at all?
  if (reaches(terrain.cost, cols, rows, start, goal)) return null;

  // Then the cheapest way to make one (Dijkstra, 8-way, no corner cutting through what can't be filled).
  const g = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const heap = new Heap(g);
  g[start] = 0;
  heap.push(start);
  const done = new Uint8Array(n);
  while (heap.size > 0) {
    const k = heap.pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj, step] of STEPS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (done[nk] || !Number.isFinite(cost[nk])) continue;
      if (di !== 0 && dj !== 0 && (!Number.isFinite(cost[j * cols + ni]) || !Number.isFinite(cost[nj * cols + i]))) continue;
      const ng = g[k] + step * cost[nk];
      if (ng >= g[nk]) continue;
      g[nk] = ng;
      from[nk] = k;
      heap.push(nk);
    }
  }
  if (!done[goal]) return null;
  const path: number[] = [];
  for (let k = goal; k >= 0; k = from[k]) path.push(k);
  path.reverse();

  // The first stretch of it that isn't comfortable, from the home end, and that has water to fill.
  let s = 0;
  while (s < path.length) {
    while (s < path.length && cost[path[s]] === COST_OPEN) s++;
    if (s >= path.length) return null;
    let e = s;
    let gapEnd = s;
    while (e < path.length) {
      if (cost[path[e]] !== COST_OPEN) gapEnd = e;
      else if (e - gapEnd > GAP_JOIN) break;
      e++;
    }
    const run = path.slice(s, gapEnd + 1);
    const wet = run.filter((k) => blocked[k]);
    if (wet.length > 0) {
      return {
        points: run.map(centre),
        water: true,
        wetFrom: centre(wet[0]),
        wetTo: centre(wet[wet.length - 1]),
        before: centre(path[Math.max(0, s - 1)]),
        after: centre(path[Math.min(path.length - 1, gapEnd + 1)]),
      };
    }
    // Only tight, with no water in it to fill (between deep water, say): nothing engineers can do here.
    s = gapEnd + 1;
  }
  return null;
}

const STEPS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Whether b can be reached from a over comfortable cells alone. */
function reaches(cost: Float32Array, cols: number, rows: number, a: number, b: number): boolean {
  const seen = new Uint8Array(cost.length);
  const stack = [a];
  seen[a] = 1;
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (k === b) return true;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      // The ends themselves may be tight (a base's buildings don't count, but its edge might).
      if (seen[nk] || (cost[nk] !== COST_OPEN && nk !== b)) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return false;
}

/** Distance from each cell centre to the nearest blocked cell centre or the map's edge (two-pass chamfer, as NavGrid's). */
function clearance(blocked: Uint8Array, cols: number, rows: number, cellSize: number): Float32Array {
  const c = new Float32Array(cols * rows);
  const diag = cellSize * Math.SQRT2;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) c[j * cols + i] = blocked[j * cols + i] ? 0 : Math.min(i + 1, cols - i, j + 1, rows - j) * cellSize;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (c[k] === 0) continue;
      let v = c[k];
      if (i > 0) v = Math.min(v, c[k - 1] + cellSize);
      if (j > 0) {
        v = Math.min(v, c[k - cols] + cellSize);
        if (i > 0) v = Math.min(v, c[k - cols - 1] + diag);
        if (i + 1 < cols) v = Math.min(v, c[k - cols + 1] + diag);
      }
      c[k] = v;
    }
  }
  for (let j = rows - 1; j >= 0; j--) {
    for (let i = cols - 1; i >= 0; i--) {
      const k = j * cols + i;
      if (c[k] === 0) continue;
      let v = c[k];
      if (i + 1 < cols) v = Math.min(v, c[k + 1] + cellSize);
      if (j + 1 < rows) {
        v = Math.min(v, c[k + cols] + cellSize);
        if (i + 1 < cols) v = Math.min(v, c[k + cols + 1] + diag);
        if (i > 0) v = Math.min(v, c[k + cols - 1] + diag);
      }
      c[k] = v;
    }
  }
  return c;
}

/** Distance between two points. */
export function apart(a: Point, b: Point): number {
  return D.hypot(a.x - b.x, a.z - b.z);
}
