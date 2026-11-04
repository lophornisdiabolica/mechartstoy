import { Battlefield, STREET_WIDTH } from './battlefield';
import { Heap } from './waterways';

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

/** How much a road would rather go round a slope than over it (cost per unit of rise over run). */
const SLOPE_COST = 8;
/** Existing road is cheaper to follow, so links merge rather than run side by side. */
const ON_ROAD = 0.4;

export function connectTowns(field: Battlefield): number {
  const towns = field.townSites;
  if (towns.length < 2) return 0;
  // Each town's street ends.
  const ends = towns.map((t) => {
    const ux = Math.cos(t.angle) * t.radius;
    const uz = Math.sin(t.angle) * t.radius;
    return [
      { x: t.x - ux, z: t.z - uz },
      { x: t.x + ux, z: t.z + uz },
    ];
  });
  // Prim's: link the nearest unlinked town to the network until all are in.
  const linked = [0];
  let built = 0;
  while (linked.length < towns.length) {
    let best: { from: Point; to: Point; town: number; d: number } | null = null;
    for (let t = 0; t < towns.length; t++) {
      if (linked.includes(t)) continue;
      for (const l of linked) {
        for (const a of ends[l]) {
          for (const b of ends[t]) {
            const d = Math.hypot(a.x - b.x, a.z - b.z);
            if (!best || d < best.d) best = { from: a, to: b, town: t, d };
          }
        }
      }
    }
    if (!best) break;
    linked.push(best.town);
    const path = planRoad(field, best.from, best.to);
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
 * of towns (other than to leave and reach their street ends).
 */
export function planRoad(field: Battlefield, from: Point, to: Point): Point[] | null {
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
    if (field.baseSites.some((b) => Math.hypot(b.x - x, b.z - z) < b.radius + 2)) return true;
    // Into a town only near the street ends it's heading for or leaving.
    for (const t of field.townSites) {
      if (Math.hypot(t.x - x, t.z - z) < t.radius - 0.5 && Math.hypot(from.x - x, from.z - z) > 2.5 && Math.hypot(to.x - x, to.z - z) > 2.5) return true;
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
    return Math.hypot(i - ti, (k - i) / cols - tj) * ON_ROAD;
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
        const ng = g[k] + Math.hypot(di, dj) * stepCost(nk);
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
  // Every other cell, then rounded off, so the road curves instead of stepping.
  const sparse = cells.filter((_, k) => k % 2 === 0 || k === cells.length - 1);
  return [from, ...smooth(sparse.slice(1, -1).length ? sparse : cells, 2).slice(1, -1), to];
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
