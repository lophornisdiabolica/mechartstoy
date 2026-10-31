import { Battlefield } from './battlefield';

export interface Point {
  x: number;
  z: number;
}

/** Slope above which ground costs extra to cross (units prefer valleys and roads). */
const STEEP = 0.7;
const STEEP_COST = 3;
/** Cap on A* node expansions per search, so a hopeless search can't stall a tick. */
const MAX_EXPANSIONS = 8000;

const SQRT2 = Math.SQRT2;
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/** Minimal binary min-heap of cell indices keyed by an external score array. */
class Heap {
  private items: number[] = [];
  constructor(private readonly score: Float32Array) {}

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
    if (a.length > 0) {
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

  clear(): void {
    this.items.length = 0;
  }
}

/**
 * Coarse grid for route planning. Water is impassable, steep ground costs
 * more, and buildings are added/removed as obstacles while the game runs
 * (`version` bumps on every change so cached routes know to re-plan).
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** Changes whenever obstacles change. */
  version = 0;

  private readonly water: Uint8Array;
  private readonly cost: Float32Array;
  /** Number of obstacles covering each cell. */
  private readonly occupied: Uint16Array;

  // Scratch buffers reused across searches.
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;
  private readonly open: Heap;

  constructor(
    private readonly field: Battlefield,
    readonly cellSize = 1.5,
  ) {
    this.cols = Math.ceil(field.width / cellSize);
    this.rows = Math.ceil(field.depth / cellSize);
    const n = this.cols * this.rows;
    this.water = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.occupied = new Uint16Array(n);
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const { x, z } = this.center(i, j);
        const k = j * this.cols + i;
        this.water[k] = field.isWater(x, z) ? 1 : 0;
        this.cost[k] = field.slopeAt(x, z) > STEEP ? STEEP_COST : 1;
      }
    }
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.open = new Heap(this.f);
  }

  cellOf(x: number, z: number): [number, number] {
    const b = this.field.bounds;
    return [
      Math.max(0, Math.min(this.cols - 1, Math.floor((x - b.minX) / this.cellSize))),
      Math.max(0, Math.min(this.rows - 1, Math.floor((z - b.minZ) / this.cellSize))),
    ];
  }

  center(i: number, j: number): Point {
    const b = this.field.bounds;
    return { x: b.minX + (i + 0.5) * this.cellSize, z: b.minZ + (j + 0.5) * this.cellSize };
  }

  blocked(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return true;
    const k = j * this.cols + i;
    return this.water[k] === 1 || this.occupied[k] > 0;
  }

  blockedAt(x: number, z: number): boolean {
    const [i, j] = this.cellOf(x, z);
    return this.blocked(i, j);
  }

  /** Mark (or with delta -1, unmark) the cells a circular obstacle covers. */
  markObstacle(x: number, z: number, radius: number, delta: 1 | -1): void {
    const [i0, j0] = this.cellOf(x - radius, z - radius);
    const [i1, j1] = this.cellOf(x + radius, z + radius);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = this.center(i, j);
        if (Math.hypot(c.x - x, c.z - z) > radius) continue;
        const k = j * this.cols + i;
        this.occupied[k] = Math.max(0, this.occupied[k] + delta);
      }
    }
    this.version++;
  }

  /** True if a straight walk between two points crosses no blocked cell. */
  lineClear(a: Point, b: Point): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / (this.cellSize * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (this.blockedAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /** The closest unblocked cell to a point (searching outward in rings). */
  nearestOpen(x: number, z: number, maxRing = 12): [number, number] | null {
    const [ci, cj] = this.cellOf(x, z);
    if (!this.blocked(ci, cj)) return [ci, cj];
    for (let r = 1; r <= maxRing; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (this.blocked(ci + di, cj + dj)) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = [ci + di, cj + dj];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /**
   * Plan a route with A* (8-way, no corner cutting) and smooth it so units
   * walk straight lines between turning points. Returns waypoints excluding
   * the start, ending at the goal (or the nearest reachable spot to it).
   * Returns null if no route exists.
   */
  findPath(from: Point, to: Point): Point[] | null {
    const start = this.nearestOpen(from.x, from.z);
    const goal = this.nearestOpen(to.x, to.z);
    if (!start || !goal) return null;
    const cols = this.cols;
    const sk = start[1] * cols + start[0];
    const gk = goal[1] * cols + goal[0];
    const gi = goal[0];
    const gj = goal[1];

    const id = ++this.search;
    const h = (i: number, j: number) => {
      const dx = Math.abs(i - gi);
      const dz = Math.abs(j - gj);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz);
    };
    this.open.clear();
    this.stamp[sk] = id;
    this.g[sk] = 0;
    this.f[sk] = h(start[0], start[1]);
    this.parent[sk] = -1;
    this.open.push(sk);

    let found = false;
    let expansions = 0;
    let closest = sk;
    let closestH = Infinity;
    while (this.open.size > 0 && expansions++ < MAX_EXPANSIONS) {
      const k = this.open.pop();
      if (this.closed[k] === id) continue;
      this.closed[k] = id;
      if (k === gk) {
        found = true;
        break;
      }
      const i = k % cols;
      const j = (k - i) / cols;
      const hk = h(i, j);
      if (hk < closestH) {
        closestH = hk;
        closest = k;
      }
      for (const [di, dj, step] of NEIGHBOURS) {
        const ni = i + di;
        const nj = j + dj;
        if (this.blocked(ni, nj)) continue;
        // No squeezing diagonally between two blocked cells.
        if (di !== 0 && dj !== 0 && (this.blocked(i + di, j) || this.blocked(i, j + dj))) continue;
        const nk = nj * cols + ni;
        if (this.closed[nk] === id) continue;
        const ng = this.g[k] + step * this.cost[nk];
        if (this.stamp[nk] === id && ng >= this.g[nk]) continue;
        this.stamp[nk] = id;
        this.g[nk] = ng;
        this.f[nk] = ng + h(ni, nj);
        this.parent[nk] = k;
        this.open.push(nk);
      }
    }

    // If the goal is unreachable, head for the closest point we found.
    const end = found ? gk : closest;
    const cells: number[] = [];
    for (let k = end; k !== -1; k = this.parent[k]) cells.push(k);
    cells.reverse();
    const points = cells.map((k) => this.center(k % cols, Math.floor(k / cols)));
    if (found) points[points.length - 1] = this.blockedAt(to.x, to.z) ? points[points.length - 1] : { x: to.x, z: to.z };
    return this.smooth(from, points);
  }

  /** String-pulling: drop waypoints that can be skipped with a clear straight line. */
  private smooth(from: Point, points: Point[]): Point[] {
    const out: Point[] = [];
    let anchor = from;
    let i = 0;
    while (i < points.length) {
      let j = points.length - 1;
      while (j > i && !this.lineClear(anchor, points[j])) j--;
      out.push(points[j]);
      anchor = points[j];
      i = j + 1;
    }
    return out;
  }
}
