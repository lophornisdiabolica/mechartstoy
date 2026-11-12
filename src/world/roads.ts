import { Battlefield, STREET_WIDTH } from './battlefield';
import { Heap } from './waterways';
import * as D from '../core/dmath';

/**
 * Roads between towns. Each town's main street is paved when the town is
 * laid out; `connectTowns` then joins the towns into one network (the
 * shortest set of links that reaches them all), each link following the
 * easiest ground from the end of one main street to the end of another:
 * round hills, base pads and other towns, over water only by bridge.
 *
 * Roads are road ground (see ground.ts) under a smooth strip the renderer
 * draws (see Battlefield.roads). `planRoad` works on any map, mid-battle
 * too, for whatever lays roads later (engineers).
 */

type Point = { x: number; z: number };
/** A town's street end, and where a link road from it starts (see connectTowns). */
type End = Point & { tuck: Point; lead: Point | null };

/** How much a road would rather go round a slope than over it (cost per unit of rise over run). */
const SLOPE_COST = 16;
/** How much a road would rather keep off crests and gully floors (see planRoad's bowAt). */
const BOW_COST = 60;
/** How far round a cell bowAt looks: about half a road's width. */
const BOW_REACH = 1.6;
/** Eight directions round a point, for bowAt. */
const RING = [
  [1, 0],
  [0.7071, 0.7071],
  [0, 1],
  [-0.7071, 0.7071],
  [-1, 0],
  [-0.7071, -0.7071],
  [0, -1],
  [0.7071, -0.7071],
];
/** How much a road would rather keep level along its length (cost per unit of climb over run). */
const CLIMB_COST = 10;
/** Existing road is cheaper to follow, so links merge rather than run side by side. */
const ON_ROAD = 0.4;
/** How far past a town's street end a link road runs straight on before it turns off. */
const LEAD_OUT = 1.5;
/** How many cells from its start a road must get before it can fork off another (see planRoad). */
const JOIN_CLEAR = 3;
/** How far back up the street a link road starts, under the street's own strip. */
const TUCK_IN = 0.6;

export function connectTowns(field: Battlefield): number {
  const towns = field.townSites;
  if (towns.length < 2) return 0;
  // Each town's street ends.
  // Each town's street ends, and a point a little way out along the street from each, so a link
  // carries the street on out of town before it turns, rather than turning on the spot.
  const ends = towns.map((t) => {
    const ux = D.cos(t.angle);
    const uz = D.sin(t.angle);
    return [-1, 1].map((side) => {
      const end = { x: t.x + side * ux * t.radius, z: t.z + side * uz * t.radius };
      const lead = { x: end.x + side * ux * LEAD_OUT, z: end.z + side * uz * LEAD_OUT };
      // The link starts a little way back up the street, so the two overlap rather than meeting
      // edge to edge (where a sliver of ground could show between them on a slope).
      const tuck = { x: end.x - side * ux * TUCK_IN, z: end.z - side * uz * TUCK_IN };
      return { ...end, tuck, lead: field.contains(lead.x, lead.z, 2) && !field.isWater(lead.x, lead.z) ? lead : null };
    });
  });
  // Prim's: link the nearest unlinked town to the network until all are in.
  const linked = [0];
  let built = 0;
  while (linked.length < towns.length) {
    let best: { from: End; to: End; town: number; d: number } | null = null;
    for (let t = 0; t < towns.length; t++) {
      if (linked.includes(t)) continue;
      for (const l of linked) {
        for (const a of ends[l]) {
          for (const b of ends[t]) {
            const d = D.hypot(a.x - b.x, a.z - b.z);
            if (!best || d < best.d) best = { from: a, to: b, town: t, d };
          }
        }
      }
    }
    if (!best) break;
    linked.push(best.town);
    // Planned from the new town towards the network, so it can stop where it first meets a road
    // already built and fork off that instead of running alongside it.
    const { from, to } = best;
    const plan = planRoad(field, to.lead ?? to, from.lead ?? from, { before: to.lead ? to.tuck : undefined, after: from.lead ? from.tuck : undefined, join: joinable(field) });
    if (plan) {
      const index = field.addRoad(plan.points, STREET_WIDTH);
      if (plan.joins !== null && index >= 0) {
        const end = plan.points[plan.points.length - 1];
        field.addJunction({ x: end.x, z: end.z, roads: [plan.joins, index] });
      }
      built++;
    }
  }
  return built;
}

/** A planned road: its line, and the road it ends on, if it forks off one (see planRoad's `join`). */
export interface RoadPlan {
  points: Point[];
  joins: number | null;
}

export interface RoadPlanOptions {
  /** Where the road really starts: a short straight lead-in to `from` that the search doesn't plan, rounded into the rest. */
  before?: Point;
  /** Where the road really ends, likewise, past `to` (dropped if it forks off a road on the way). */
  after?: Point;
  /**
   * Per map cell, the index of a road whose line runs through it, or -1
   * (see joinable). If the search reaches such a cell before `to`, the road
   * ends there on that road's line instead: a fork.
   */
  join?: Int16Array;
}

/**
 * The easiest line for a road from one point to another, smoothed, or null
 * if there's no way (water with no bridge, say). Keeps off base pads and out
 * of towns (other than to leave and reach their street ends), and to even
 * ground: round slopes and beside crests rather than along them.
 */
export function planRoad(field: Battlefield, from: Point, to: Point, options: RoadPlanOptions = {}): RoadPlan | null {
  const { before, join } = options;
  let after = options.after;
  const { cols, rows, cellSize } = field.config;
  const n = cols * rows;
  const cx = (i: number) => field.bounds.minX + (i + 0.5) * cellSize;
  const cz = (j: number) => field.bounds.minZ + (j + 0.5) * cellSize;
  const [si, sj] = field.cellAt(from.x, from.z);
  const [ti, tj] = field.cellAt(to.x, to.z);
  const start = sj * cols + si;
  const goal = tj * cols + ti;

  const blocked = (k: number): boolean => {
    if (k === start || k === goal) return false;
    const i = k % cols;
    const x = cx(i);
    const z = cz((k - i) / cols);
    if (!field.contains(x, z, 2)) return true;
    if (field.isWater(x, z) && field.deckAt(x, z) === null) return true;
    if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius + 2)) return true;
    // Into a town only near the street ends it's heading for or leaving.
    for (const t of field.townSites) {
      if (D.hypot(t.x - x, t.z - z) < t.radius - 0.5 && D.hypot(from.x - x, from.z - z) > 2.5 && D.hypot(to.x - x, to.z - z) > 2.5) return true;
    }
    return false;
  };
  // How far the ground bows up or down round each cell, over about a road's width (worked out as
  // needed): high on a ridge's crest and a gully's floor, where the slope at the cell's middle alone
  // can be nearly flat, so roads keep off crests and run beside them.
  const bow = new Float32Array(n).fill(-1);
  const bowAt = (k: number): number => {
    if (bow[k] >= 0) return bow[k];
    const i = k % cols;
    const x = cx(i);
    const z = cz((k - i) / cols);
    let ring = 0;
    for (let a = 0; a < 8; a++) ring += field.heightAt(x + BOW_REACH * RING[a][0], z + BOW_REACH * RING[a][1]);
    return (bow[k] = Math.abs(field.heightAt(x, z) - ring / 8) / BOW_REACH);
  };
  const stepCost = (k: number, from: number): number => {
    const i = k % cols;
    const x = cx(i);
    const z = cz((k - i) / cols);
    if (field.deckAt(x, z) !== null) return field.roadCell[k] ? ON_ROAD : 1;
    const fi = from % cols;
    const climb = Math.abs(field.heightAt(x, z) - field.heightAt(cx(fi), cz((from - fi) / cols))) / cellSize;
    return (1 + field.slopeAt(x, z) * SLOPE_COST + bowAt(k) * BOW_COST + climb * CLIMB_COST) * (field.roadCell[k] ? ON_ROAD : 1);
  };

  const g = new Float64Array(n).fill(Infinity);
  const f = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (k: number) => {
    const i = k % cols;
    return D.hypot(i - ti, (k - i) / cols - tj) * ON_ROAD;
  };
  g[start] = 0;
  f[start] = h(start);
  const open = new Heap(f);
  open.push(start);
  // A fork can't start right where the road itself does.
  const joinFrom = (k: number) => {
    const i = k % cols;
    return D.hypot(i - si, (k - i) / cols - sj) > JOIN_CLEAR;
  };
  let end = goal;
  let joins: number | null = null;
  while (open.size > 0) {
    const k = open.pop();
    if (k === goal) break;
    if (join && join[k] >= 0 && joinFrom(k)) {
      end = k;
      joins = join[k];
      break;
    }
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % cols;
    const j = (k - i) / cols;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (closed[nk] || blocked(nk)) continue;
        // No cutting corners past blocked cells.
        if (di && dj && (blocked(j * cols + ni) || blocked(nj * cols + i))) continue;
        const ng = g[k] + D.hypot(di, dj) * stepCost(nk, k);
        if (ng < g[nk]) {
          g[nk] = ng;
          f[nk] = ng + h(nk);
          came[nk] = k;
          open.push(nk);
        }
      }
    }
  }
  if (came[end] < 0 && end !== start) return null;

  const cells: Point[] = [];
  for (let k = end; k >= 0; k = came[k]) {
    const i = k % cols;
    cells.push({ x: cx(i), z: cz((k - i) / cols) });
    if (k === start) break;
  }
  // The road starts and ends at the points themselves, not the middles of their cells (which can be
  // up to half a cell behind them, so the road would double back on itself there).
  // A fork ends on the other road's line, at the nearest point to where the search met it.
  const last = joins === null ? to : nearestOnLine(field.roads[joins].points, cells[0]);
  if (joins !== null) after = undefined;
  cells.reverse();
  cells[0] = { x: from.x, z: from.z };
  if (cells.length > 1) cells[cells.length - 1] = last;
  else cells.push(last);
  // Every other cell, then rounded off, so the road curves instead of stepping.
  const sparse = cells.filter((_, k) => k % 2 === 0 || k === cells.length - 1);
  const line = trimBacktracks(sparse);
  const points = smooth([...(before ? [{ x: before.x, z: before.z }] : []), ...line, ...(after ? [{ x: after.x, z: after.z }] : [])], 2);
  return { points, joins };
}

/**
 * Per map cell, the index of the country road (not a town street) whose
 * line runs through it, or -1: where a new road can fork off one already
 * built (see planRoad's `join`).
 */
export function joinable(field: Battlefield): Int16Array {
  const { cols, rows } = field.config;
  const out = new Int16Array(cols * rows).fill(-1);
  field.roads.forEach((road, index) => {
    if (road.kind !== 'road') return;
    for (let k = 1; k < road.points.length; k++) {
      const a = road.points[k - 1];
      const b = road.points[k];
      const steps = Math.max(1, Math.ceil(D.hypot(b.x - a.x, b.z - a.z) / 0.5));
      for (let s = 0; s <= steps; s++) {
        const x = a.x + ((b.x - a.x) * s) / steps;
        const z = a.z + ((b.z - a.z) * s) / steps;
        if (field.isWater(x, z) || field.deckAt(x, z) !== null) continue;
        const [i, j] = field.cellAt(x, z);
        out[j * cols + i] = index;
      }
    }
  });
  return out;
}

/** The nearest point to `p` on a line of points. */
function nearestOnLine(line: Point[], p: Point): Point {
  let best = line[0];
  let bestD = Infinity;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = D.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

/** Drop points next to either end that the road would have to turn back past (more than a right angle). */
function trimBacktracks(points: Point[]): Point[] {
  const p = [...points];
  const back = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z) <= 0;
  while (p.length > 2 && back(p[0], p[1], p[2])) p.splice(1, 1);
  while (p.length > 2 && back(p[p.length - 3], p[p.length - 2], p[p.length - 1])) p.splice(p.length - 2, 1);
  return p;
}

/** Chaikin corner cutting: each pass replaces every corner with two points a quarter of the way along its sides. */
function smooth(points: Point[], passes: number): Point[] {
  let p = points;
  for (let n = 0; n < passes; n++) {
    if (p.length < 3) return p;
    const out: Point[] = [p[0]];
    for (let k = 0; k < p.length - 1; k++) {
      const a = p[k];
      const b = p[k + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
