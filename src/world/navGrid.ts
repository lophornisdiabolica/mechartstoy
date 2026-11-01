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
/**
 * Extra room a unit wants beyond its radius, measured from the centre of the
 * nearest blocked cell. Obstacles are already marked a little larger than
 * the buildings, so this stays small.
 */
const CLEARANCE_MARGIN = 0.1;

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
 *
 * Big units only fit through wide gaps, so every query takes the unit's
 * radius. A clearance map (distance from each cell to the nearest blocked
 * cell) keeps routes to gaps the unit fits through.
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
  /** Distance from each cell centre to the nearest blocked cell centre (or the map edge). */
  private readonly clearance: Float32Array;
  private clearanceVersion = -1;
  /** Which patch of dry land each cell is on (-1 for water); cells with different ids can't reach each other. */
  private readonly region: Int32Array;

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
    this.clearance = new Float32Array(n);
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const { x, z } = this.center(i, j);
        const k = j * this.cols + i;
        this.water[k] = field.isWater(x, z) ? 1 : 0;
        this.cost[k] = field.slopeAt(x, z) > STEEP ? STEEP_COST : 1;
      }
    }
    this.region = this.labelRegions();
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.open = new Heap(this.f);
  }

  /** Flood-fill the dry land into connected regions. Buildings come and go, so only water counts. */
  private labelRegions(): Int32Array {
    const { cols, rows } = this;
    const region = new Int32Array(cols * rows).fill(-1);
    let next = 0;
    const stack: number[] = [];
    for (let start = 0; start < region.length; start++) {
      if (this.water[start] || region[start] >= 0) continue;
      region[start] = next;
      stack.push(start);
      while (stack.length > 0) {
        const k = stack.pop()!;
        const i = k % cols;
        const j = (k - i) / cols;
        for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nk = nj * cols + ni;
          if (this.water[nk] || region[nk] >= 0) continue;
          region[nk] = next;
          stack.push(nk);
        }
      }
      next++;
    }
    return region;
  }

  /** True if dry land connects the two points (ignoring buildings). */
  connected(a: Point, b: Point): boolean {
    const [ai, aj] = this.cellOf(a.x, a.z);
    const [bi, bj] = this.cellOf(b.x, b.z);
    const ra = this.region[aj * this.cols + ai];
    return ra >= 0 && ra === this.region[bj * this.cols + bi];
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

  /** Whether a unit of this radius can stand in a cell. Radius 0 means "any open cell". */
  fits(i: number, j: number, radius = 0): boolean {
    if (this.blocked(i, j)) return false;
    if (radius <= 0) return true;
    this.updateClearance();
    return this.clearance[j * this.cols + i] >= radius + CLEARANCE_MARGIN;
  }

  fitsAt(x: number, z: number, radius = 0): boolean {
    const [i, j] = this.cellOf(x, z);
    return this.fits(i, j, radius);
  }

  /** Room around a point: distance to the nearest blocked cell or the map edge. */
  clearanceAt(x: number, z: number): number {
    const [i, j] = this.cellOf(x, z);
    if (this.blocked(i, j)) return 0;
    this.updateClearance();
    return this.clearance[j * this.cols + i];
  }

  /** Rebuild the clearance map after obstacles change (two-pass chamfer distance transform). */
  private updateClearance(): void {
    if (this.clearanceVersion === this.version) return;
    this.clearanceVersion = this.version;
    const { cols, rows, cellSize } = this;
    const c = this.clearance;
    const diag = cellSize * SQRT2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        // The map edge counts as a wall just outside the outermost cells.
        c[k] = this.blocked(i, j) ? 0 : Math.min(i + 1, cols - i, j + 1, rows - j) * cellSize;
      }
    }
    const relax = (k: number, i: number, j: number, d: number) => {
      if (i < 0 || j < 0 || i >= cols || j >= rows) return;
      const v = c[j * cols + i] + d;
      if (v < c[k]) c[k] = v;
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (c[k] === 0) continue;
        relax(k, i - 1, j, cellSize);
        relax(k, i, j - 1, cellSize);
        relax(k, i - 1, j - 1, diag);
        relax(k, i + 1, j - 1, diag);
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = cols - 1; i >= 0; i--) {
        const k = j * cols + i;
        if (c[k] === 0) continue;
        relax(k, i + 1, j, cellSize);
        relax(k, i, j + 1, cellSize);
        relax(k, i + 1, j + 1, diag);
        relax(k, i - 1, j + 1, diag);
      }
    }
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

  /** True if a unit of this radius can walk straight between two points. */
  lineClear(a: Point, b: Point, radius = 0): boolean {
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / (this.cellSize * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.fitsAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false;
    }
    return true;
  }

  /** The closest cell a unit of this radius fits in (searching outward in rings). */
  nearestOpen(x: number, z: number, maxRing = 12, radius = 0): [number, number] | null {
    const [ci, cj] = this.cellOf(x, z);
    if (this.fits(ci, cj, radius)) return [ci, cj];
    for (let r = 1; r <= maxRing; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (!this.fits(ci + di, cj + dj, radius)) continue;
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
   *
   * With a radius, the route only uses gaps that wide. If there's no such
   * route (say the goal is tucked between buildings), it falls back to a
   * tighter fit, and finally to any open cell.
   */
  findPath(from: Point, to: Point, radius = 0): Point[] | null {
    // Every open cell has at least a cell's width of room, so small units need no special treatment.
    const wide = radius + CLEARANCE_MARGIN > this.cellSize;
    for (const r of wide ? [radius, radius * 0.5] : []) {
      const route = this.route(from, to, r);
      if (route?.found) return route.points;
    }
    return this.route(from, to, 0)?.points ?? null;
  }

  private route(from: Point, to: Point, radius: number): { points: Point[]; found: boolean } | null {
    // A wide unit standing somewhere tight starts by backing out to the nearest roomy spot,
    // rather than planning onward through a gap it can't fit.
    const start = (radius > 0 ? this.nearestOpen(from.x, from.z, 3, radius) : null) ?? this.nearestOpen(from.x, from.z);
    // A wide unit settles for a spot near the goal; much further away and it's better to squeeze in.
    const goal = this.nearestOpen(to.x, to.z, radius > 0 ? 6 : 12, radius);
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
        if (!this.fits(ni, nj, radius)) continue;
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
    if (found) points[points.length - 1] = this.fitsAt(to.x, to.z, radius) ? { x: to.x, z: to.z } : points[points.length - 1];
    return { points: this.smooth(from, points, radius), found };
  }

  /** String-pulling: drop waypoints that can be skipped with a clear straight line. */
  private smooth(from: Point, points: Point[], radius: number): Point[] {
    const out: Point[] = [];
    let anchor = from;
    let i = 0;
    while (i < points.length) {
      let j = points.length - 1;
      while (j > i && !this.lineClear(anchor, points[j], radius)) j--;
      out.push(points[j]);
      anchor = points[j];
      i = j + 1;
    }
    return out;
  }
}
