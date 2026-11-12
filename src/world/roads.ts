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
type End = Point & { lead: Point | null };

/** How much a road would rather go round a slope than over it (cost per unit of rise over run). */
const SLOPE_COST = 8;
/** Existing road is cheaper to follow, so links merge rather than run side by side. */
const ON_ROAD = 0.4;
/** How far past a town's street end a link road runs straight on before it turns off. */
const LEAD_OUT = 1.5;

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
      return { ...end, lead: field.contains(lead.x, lead.z, 2) && !field.isWater(lead.x, lead.z) ? lead : null };
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
    const { from, to } = best;
    const path = planRoad(field, from.lead ?? from, to.lead ?? to, from.lead ? from : undefined, to.lead ? to : undefined);
    if (path) {
      field.addRoad(path, STREET_WIDTH);
      built++;
    }
  }
  return built;
}

/**
 * The easiest line for a road from one point to another, smoothed, or null
 * if there's no way (water with no bridge, say). Keeps off base pads and out
 * of towns (other than to leave and reach their street ends). `before` and
 * `after`, if given, are where the road really starts and ends: a short
 * straight lead-in to `from` and out of `to` that the search doesn't plan,
 * rounded into the rest.
 */
export function planRoad(field: Battlefield, from: Point, to: Point, before?: Point, after?: Point): Point[] | null {
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
  const stepCost = (k: number): number => {
    const i = k % cols;
    const x = cx(i);
    const z = cz((k - i) / cols);
    const slope = field.deckAt(x, z) !== null ? 0 : field.slopeAt(x, z);
    return (1 + slope * SLOPE_COST) * (field.roadCell[k] ? ON_ROAD : 1);
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
  while (open.size > 0) {
    const k = open.pop();
    if (k === goal) break;
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
        const ng = g[k] + D.hypot(di, dj) * stepCost(nk);
        if (ng < g[nk]) {
          g[nk] = ng;
          f[nk] = ng + h(nk);
          came[nk] = k;
          open.push(nk);
        }
      }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;

  const cells: Point[] = [];
  for (let k = goal; k >= 0; k = came[k]) {
    const i = k % cols;
    cells.push({ x: cx(i), z: cz((k - i) / cols) });
    if (k === start) break;
  }
  cells.reverse();
  // The road starts and ends at the points themselves, not the middles of their cells (which can be
  // up to half a cell behind them, so the road would double back on itself there).
  cells[0] = { x: from.x, z: from.z };
  if (cells.length > 1) cells[cells.length - 1] = { x: to.x, z: to.z };
  else cells.push({ x: to.x, z: to.z });
  // Every other cell, then rounded off, so the road curves instead of stepping.
  const sparse = cells.filter((_, k) => k % 2 === 0 || k === cells.length - 1);
  const line = trimBacktracks(sparse);
  return smooth([...(before ? [{ x: before.x, z: before.z }] : []), ...line, ...(after ? [{ x: after.x, z: after.z }] : [])], 2);
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
