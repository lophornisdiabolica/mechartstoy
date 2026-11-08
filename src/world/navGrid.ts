import { Battlefield } from './battlefield';
import { CellArea, GroundDef } from './ground';
import { MOVE_RULES, MoveClass, MoveRules, STEEP_SLOPE, terrainAllows } from './moveClasses';
import * as D from '../core/dmath';

export interface Point {
  x: number;
  z: number;
}

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

/** NEIGHBOURS as flat arrays, for the search's inner loop. */
const NEIGHBOUR_DI = Int8Array.from(NEIGHBOURS, (n) => n[0]);
const NEIGHBOUR_DJ = Int8Array.from(NEIGHBOURS, (n) => n[1]);
const NEIGHBOUR_STEP = Float64Array.from(NEIGHBOURS, (n) => n[2]);

/**
 * What every movement class's grid reads from the map at each cell centre:
 * depth below sea level, slope, bridge deck, towns and outposts, and the
 * ground's kind. Sampled once per map and shared, so making a grid for
 * another class only applies that class's rules. Kept up to date by
 * listening to the map's changes.
 */
class CellSamples {
  readonly depth: Float64Array;
  readonly slope: Float64Array;
  readonly deck: Uint8Array;
  readonly settled: Uint8Array;
  readonly ground: GroundDef[];

  constructor(
    private readonly field: Battlefield,
    readonly cols: number,
    readonly rows: number,
    readonly cellSize: number,
  ) {
    const n = cols * rows;
    this.depth = new Float64Array(n);
    this.slope = new Float64Array(n);
    this.deck = new Uint8Array(n);
    this.settled = new Uint8Array(n);
    this.ground = new Array<GroundDef>(n);
    this.sample(0, 0, cols - 1, rows - 1);
    field.onChange((area) => this.sample(Math.max(0, area.i0 - 1), Math.max(0, area.j0 - 1), Math.min(cols - 1, area.i1 + 1), Math.min(rows - 1, area.j1 + 1)));
  }

  private sample(i0: number, j0: number, i1: number, j1: number): void {
    const field = this.field;
    const settled = [...field.townSites, ...field.outpostSites];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i;
        const x = field.bounds.minX + (i + 0.5) * this.cellSize;
        const z = field.bounds.minZ + (j + 0.5) * this.cellSize;
        this.deck[k] = field.deckAt(x, z) !== null ? 1 : 0;
        this.depth[k] = field.seaLevel - field.heightAt(x, z);
        this.slope[k] = field.slopeAt(x, z);
        this.settled[k] = settled.some((t) => D.hypot(t.x - x, t.z - z) < t.radius) ? 1 : 0;
        this.ground[k] = field.groundAt(x, z);
      }
    }
  }

  private static readonly cache = new WeakMap<Battlefield, CellSamples[]>();

  /** The shared samples for this map at this cell size. */
  static of(field: Battlefield, cols: number, rows: number, cellSize: number): CellSamples {
    let list = CellSamples.cache.get(field);
    if (!list) CellSamples.cache.set(field, (list = []));
    let samples = list.find((s) => s.cellSize === cellSize);
    if (!samples) list.push((samples = new CellSamples(field, cols, rows, cellSize)));
    return samples;
  }
}

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
      const tmp = a[p];
      a[p] = a[c];
      a[c] = tmp;
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
        const tmp = a[p];
        a[p] = a[m];
        a[m] = tmp;
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
 * Buildings marked on the map as obstacles, shared by every movement class's
 * grid so one building going up or down updates them all.
 */
export class NavObstacles {
  /** Changes whenever obstacles change, or the map does (so routes get re-planned). */
  version = 0;
  /** The latest changes: the version each brought in and the cells it touched (see changedSince). */
  private readonly log: { version: number; area: CellArea }[] = [];
  /** Changes only when a building is marked or unmarked: what clearance maps depend on, with each grid's terrain. */
  blockVersion = 0;
  /** Number of obstacles covering each cell. */
  readonly occupied: Uint16Array;
  /** The same, leaving out low buildings (walls), which walkers step over (see MoveRules.over). */
  readonly tall: Uint16Array;
  /** Always empty: what climbers see, since they go over every building. */
  readonly none: Uint16Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.occupied = new Uint16Array(cols * rows);
    this.tall = new Uint16Array(cols * rows);
    this.none = new Uint16Array(cols * rows);
  }

  /** The obstacle counts a class with these rules is kept out by. */
  for(over: 'none' | 'low' | 'all'): Uint16Array {
    return over === 'all' ? this.none : over === 'low' ? this.tall : this.occupied;
  }

  /** Something changed in these cells: bump the version and remember where. */
  record(area: CellArea): void {
    this.version++;
    this.log.push({ version: this.version, area });
    if (this.log.length > CHANGE_LOG) this.log.shift();
  }

  /**
   * Whether anything changed in an area since `version`. When the log no
   * longer reaches back that far, it can't tell, so it says yes.
   */
  changedSince(version: number, area: CellArea): boolean {
    if (version >= this.version) return false;
    if (this.log.length === 0 || this.log[0].version > version + 1) return true;
    for (let k = this.log.length - 1; k >= 0 && this.log[k].version > version; k--) {
      const c = this.log[k].area;
      if (c.i0 <= area.i1 && c.i1 >= area.i0 && c.j0 <= area.j1 && c.j1 >= area.j0) return true;
    }
    return false;
  }
}

/** How many recent map and obstacle changes NavObstacles remembers where they were. */
const CHANGE_LOG = 256;

/**
 * Coarse grid for route planning, for one movement class (see
 * moveClasses.ts). Terrain the class can't cross (water too deep, dry land
 * for boats, cliffs for hovers) is impassable, steep ground, water and towns
 * cost what the class says, and buildings are added/removed as obstacles
 * while the game runs (`version` bumps on every change so cached routes know
 * to re-plan).
 *
 * Big units only fit through wide gaps, so every query takes the unit's
 * radius. A clearance map (distance from each cell to the nearest blocked
 * cell) keeps routes to gaps the unit fits through.
 */
export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly rules: MoveRules;
  readonly obstacles: NavObstacles;

  /** What the map holds at each cell, shared by every class's grid on this map. */
  private readonly samples: CellSamples;
  /** 1 where the terrain itself is off limits to this class (whatever buildings do). */
  private readonly terrain: Uint8Array;
  private readonly cost: Float32Array;
  private readonly occupied: Uint16Array;
  /** Distance from each cell centre to the nearest blocked cell centre (or the map edge). */
  private readonly clearance: Float32Array;
  /** The obstacles' blockVersion and this grid's terrainVersion the clearance map was built for. */
  private clearanceBlocks = -1;
  private clearanceTerrain = -1;
  /** Changes when a map change alters which cells this class can cross at all. */
  private terrainVersion = 0;

  /** Changes whenever a map change alters which cells this class can cross at all (not just what they cost). */
  get passableVersion(): number {
    return this.terrainVersion;
  }
  /** Which connected patch of passable terrain each cell is on (-1 for impassable); cells with different ids can't reach each other. */
  private region: Int32Array;

  // Scratch buffers reused across searches.
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly parent: Int32Array;
  private readonly stamp: Uint32Array;
  private readonly closed: Uint32Array;
  private search = 0;
  private readonly open: Heap;

  /**
   * `move` picks the movement class (tracked, the baseline land vehicle, by
   * default). Grids for different classes on the same map should share one
   * NavObstacles.
   */
  constructor(
    private readonly field: Battlefield,
    readonly move: MoveClass = 'tracked',
    obstacles?: NavObstacles,
    readonly cellSize = 1.5,
  ) {
    this.cols = Math.ceil(field.width / cellSize);
    this.rows = Math.ceil(field.depth / cellSize);
    this.rules = MOVE_RULES[move];
    this.obstacles = obstacles ?? new NavObstacles(this.cols, this.rows);
    const n = this.cols * this.rows;
    this.terrain = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.occupied = this.obstacles.for(this.rules.over);
    this.clearance = new Float32Array(n);
    this.samples = CellSamples.of(field, this.cols, this.rows, cellSize);
    for (let k = 0; k < n; k++) this.computeCell(k);
    this.region = this.labelRegions();
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.open = new Heap(this.f);
  }

  /**
   * Work out one cell's terrain from the map: whether this class can be
   * there at all, and what it costs to cross (slopes, water, towns and
   * outposts, and the ground's kind). On a bridge deck, land classes see dry,
   * level ground; boats still see the water underneath.
   */
  private computeCell(k: number): void {
    const rules = this.rules;
    const samples = this.samples;
    const onDeck = !rules.flies && rules.minDepth === 0 && samples.deck[k] === 1;
    const depth = onDeck ? 0 : samples.depth[k];
    const slope = onDeck ? 0 : samples.slope[k];
    this.terrain[k] = terrainAllows(rules, depth, slope) ? 0 : 1;
    let cost = 1;
    if (onDeck) cost *= rules.bridge;
    if (depth > 0) cost *= rules.waterCost;
    else if (slope > STEEP_SLOPE && rules.steep !== Infinity) cost *= rules.steep;
    if (rules.town !== 1 && samples.settled[k] === 1) cost *= rules.town;
    if (!rules.flies && depth <= 0) cost *= samples.ground[k].cost[this.move] ?? 1;
    this.cost[k] = cost;
  }

  /**
   * Re-read part of the map after it changed (see Battlefield.onChange):
   * recompute those cells, re-label the connected regions, and bump the
   * version so routes planned on the old map get re-planned.
   */
  refresh(area: CellArea): void {
    const i0 = Math.max(0, area.i0 - 1);
    const j0 = Math.max(0, area.j0 - 1);
    const i1 = Math.min(this.cols - 1, area.i1 + 1);
    const j1 = Math.min(this.rows - 1, area.j1 + 1);
    let terrainChanged = false;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i;
        const was = this.terrain[k];
        this.computeCell(k);
        if (this.terrain[k] !== was) terrainChanged = true;
      }
    }
    // Most changes (scrap, felled trees) only change what ground costs. Regions and
    // clearance depend only on where this class can go at all, so they stand.
    if (!terrainChanged) return;
    this.terrainVersion++;
    this.region = this.labelRegions();
    this.regionReach.clear();
  }

  /** Flood-fill the passable terrain into connected regions. Buildings come and go, so only terrain counts. */
  private labelRegions(): Int32Array {
    const { cols, rows } = this;
    const terrain = this.terrain;
    const region = new Int32Array(cols * rows).fill(-1);
    let next = 0;
    // Each cell is pushed at most once, so the stack never needs more room than the grid.
    const stack = new Int32Array(cols * rows);
    for (let start = 0; start < region.length; start++) {
      if (terrain[start] || region[start] >= 0) continue;
      region[start] = next;
      let top = 0;
      stack[top++] = start;
      while (top > 0) {
        const k = stack[--top];
        const i = k % cols;
        const j = (k - i) / cols;
        // Neighbours in the same order as always (east, west, south, north), so labels come out the same.
        if (i + 1 < cols && !terrain[k + 1] && region[k + 1] < 0) {
          region[k + 1] = next;
          stack[top++] = k + 1;
        }
        if (i > 0 && !terrain[k - 1] && region[k - 1] < 0) {
          region[k - 1] = next;
          stack[top++] = k - 1;
        }
        if (j + 1 < rows && !terrain[k + cols] && region[k + cols] < 0) {
          region[k + cols] = next;
          stack[top++] = k + cols;
        }
        if (j > 0 && !terrain[k - cols] && region[k - cols] < 0) {
          region[k - cols] = next;
          stack[top++] = k - cols;
        }
      }
      next++;
    }
    return region;
  }

  /** nearestInRegion's answers, by goal cell and region. */
  private readonly regionReach = new Map<number, Point>();

  /**
   * The centre of the closest cell to (x, z) on terrain region `region` (see
   * labelRegions), or (x, z) itself if it's on that region already or the
   * region is unknown. Cached, since units ask about the same few goals.
   */
  nearestInRegion(x: number, z: number, region: number): Point {
    const [gi, gj] = this.cellOf(x, z);
    const gk = gj * this.cols + gi;
    if (region < 0 || this.region[gk] === region) return { x, z };
    const key = gk * 4096 + region;
    let best = this.regionReach.get(key);
    if (!best) {
      let bestD = Infinity;
      let bestK = gk;
      for (let k = 0; k < this.region.length; k++) {
        if (this.region[k] !== region) continue;
        const i = k % this.cols;
        const d = D.sq(i - gi) + D.sq((k - i) / this.cols - gj);
        if (d < bestD) {
          bestD = d;
          bestK = k;
        }
      }
      best = this.center(bestK % this.cols, Math.floor(bestK / this.cols));
      this.regionReach.set(key, best);
    }
    return best;
  }

  /** Changes whenever obstacles change. */
  get version(): number {
    return this.obstacles.version;
  }

  /** True if passable terrain connects the two points (ignoring buildings). */
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

  /** Whether the terrain alone keeps this class out of a point's cell (buildings aside). Off the map counts as yes. Cheaper than terrainAllowsAt, at cell resolution. */
  terrainBlocksCell(x: number, z: number): boolean {
    const b = this.field.bounds;
    const i = Math.floor((x - b.minX) / this.cellSize);
    const j = Math.floor((z - b.minZ) / this.cellSize);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return true;
    return this.terrain[j * this.cols + i] === 1;
  }

  blocked(i: number, j: number): boolean {
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return true;
    const k = j * this.cols + i;
    return this.terrain[k] === 1 || this.occupied[k] > 0;
  }

  /** Whether this class can be at a point as far as the terrain goes (buildings aside). Off the map counts as no. */
  terrainAllowsAt(x: number, z: number): boolean {
    if (!this.field.contains(x, z)) return false;
    // Sampled at the point itself rather than the cell, so units walk right up to the shore.
    const f = this.field;
    // Land units can be anywhere on a bridge deck.
    if (!this.rules.flies && this.rules.minDepth === 0 && f.deckAt(x, z) !== null) return true;
    return terrainAllows(this.rules, f.seaLevel - f.heightAt(x, z), this.rules.steep === Infinity ? f.slopeAt(x, z) : 0);
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
    const blocks = this.obstacles.blockVersion;
    if (this.clearanceBlocks === blocks && this.clearanceTerrain === this.terrainVersion) return;
    this.clearanceBlocks = blocks;
    this.clearanceTerrain = this.terrainVersion;
    const { cols, rows, cellSize } = this;
    const c = this.clearance;
    const terrain = this.terrain;
    const occupied = this.occupied;
    const diag = cellSize * SQRT2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        // The map edge counts as a wall just outside the outermost cells.
        c[k] = terrain[k] === 1 || occupied[k] > 0 ? 0 : Math.min(i + 1, cols - i, j + 1, rows - j) * cellSize;
      }
    }
    // Two chamfer passes; each neighbour that's on the map offers its distance plus the step.
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (c[k] === 0) continue;
        let v = c[k];
        if (i > 0 && c[k - 1] + cellSize < v) v = c[k - 1] + cellSize;
        if (j > 0) {
          if (c[k - cols] + cellSize < v) v = c[k - cols] + cellSize;
          if (i > 0 && c[k - cols - 1] + diag < v) v = c[k - cols - 1] + diag;
          if (i + 1 < cols && c[k - cols + 1] + diag < v) v = c[k - cols + 1] + diag;
        }
        c[k] = v;
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = cols - 1; i >= 0; i--) {
        const k = j * cols + i;
        if (c[k] === 0) continue;
        let v = c[k];
        if (i + 1 < cols && c[k + 1] + cellSize < v) v = c[k + 1] + cellSize;
        if (j + 1 < rows) {
          if (c[k + cols] + cellSize < v) v = c[k + cols] + cellSize;
          if (i + 1 < cols && c[k + cols + 1] + diag < v) v = c[k + cols + 1] + diag;
          if (i > 0 && c[k + cols - 1] + diag < v) v = c[k + cols - 1] + diag;
        }
        c[k] = v;
      }
    }
  }

  /**
   * Mark (or with delta -1, unmark) the cells a circular obstacle covers, on
   * every grid sharing these obstacles. A `low` one (a wall) doesn't keep out
   * classes that step over walls (see MoveRules.over).
   */
  markObstacle(x: number, z: number, radius: number, delta: 1 | -1, low = false): void {
    const all = this.obstacles.occupied;
    const tall = this.obstacles.tall;
    const [i0, j0] = this.cellOf(x - radius, z - radius);
    const [i1, j1] = this.cellOf(x + radius, z + radius);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = this.center(i, j);
        if (D.hypot(c.x - x, c.z - z) > radius) continue;
        const k = j * this.cols + i;
        all[k] = Math.max(0, all[k] + delta);
        if (!low) tall[k] = Math.max(0, tall[k] + delta);
      }
    }
    this.obstacles.record({ i0, j0, i1, j1 });
    this.obstacles.blockVersion++;
  }

  /** Route cost of the cell under a point (1 is plain open ground; see MoveRules). */
  costAt(x: number, z: number): number {
    const [i, j] = this.cellOf(x, z);
    return this.cost[j * this.cols + i];
  }

  /**
   * True if a unit of this radius can walk straight between two points. With
   * `maxCost`, the line also mustn't cross ground that costs more than that
   * to this class (steep slopes for tanks, towns for big units...), so a
   * clear line doesn't shortcut ground the unit would rather go round.
   */
  lineClear(a: Point, b: Point, radius = 0, maxCost = Infinity): boolean {
    const dist = D.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / (this.cellSize * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const [i, j] = this.cellOf(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      if (!this.fits(i, j, radius)) return false;
      if (this.cost[j * this.cols + i] > maxCost + 1e-6) return false;
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
    // A goal this class can't get to at all (a boat sent inland, a hover past a cliff) becomes the
    // nearest spot it can: the shore closest to the enemy base, say.
    const reach = this.nearestInRegion(to.x, to.z, start ? this.region[start[1] * this.cols + start[0]] : -1);
    const goal = this.nearestOpen(reach.x, reach.z, radius > 0 ? 6 : 12, radius);
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
    // The search's inner loop, with fits() and blocked() written out over the raw arrays (same answers, far fewer calls).
    const rows = this.rows;
    const { terrain, occupied, clearance, cost, closed, stamp, g, f, parent, open } = this;
    if (radius > 0) this.updateClearance();
    const need = radius + CLEARANCE_MARGIN;
    const isBlocked = (ci: number, cj: number) => ci < 0 || cj < 0 || ci >= cols || cj >= rows || terrain[cj * cols + ci] === 1 || occupied[cj * cols + ci] > 0;
    while (open.size > 0 && expansions++ < MAX_EXPANSIONS) {
      const k = open.pop();
      if (closed[k] === id) continue;
      closed[k] = id;
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
      for (let n = 0; n < 8; n++) {
        const di = NEIGHBOUR_DI[n];
        const dj = NEIGHBOUR_DJ[n];
        const ni = i + di;
        const nj = j + dj;
        if (isBlocked(ni, nj)) continue;
        const nk = nj * cols + ni;
        if (radius > 0 && !(clearance[nk] >= need)) continue;
        // No squeezing diagonally between two blocked cells.
        if (di !== 0 && dj !== 0 && (isBlocked(i + di, j) || isBlocked(i, j + dj))) continue;
        if (closed[nk] === id) continue;
        const ng = g[k] + NEIGHBOUR_STEP[n] * cost[nk];
        if (stamp[nk] === id && ng >= g[nk]) continue;
        stamp[nk] = id;
        g[nk] = ng;
        f[nk] = ng + h(ni, nj);
        parent[nk] = k;
        open.push(nk);
      }
    }

    // If the goal is unreachable, head for the closest point we found.
    const end = found ? gk : closest;
    const cells: number[] = [];
    for (let k = end; k !== -1; k = this.parent[k]) cells.push(k);
    cells.reverse();
    const points = cells.map((k) => this.center(k % cols, Math.floor(k / cols)));
    if (found) points[points.length - 1] = this.fitsAt(reach.x, reach.z, radius) ? reach : points[points.length - 1];
    return { points: this.smooth(from, points, radius), found };
  }

  /**
   * Cost of walking straight from a to b (distance times the cost of the
   * ground crossed), or Infinity if a unit of this radius can't.
   */
  private lineCost(a: Point, b: Point, radius: number): number {
    const dist = D.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(dist / (this.cellSize * 0.5)));
    let cost = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (!this.fitsAt(x, z, radius)) return Infinity;
      cost += (dist / steps) * this.costAt(x, z);
    }
    return cost;
  }

  /**
   * String-pulling: drop waypoints that can be skipped with a clear straight
   * line, as long as the shortcut costs no more than the stretch of route it
   * replaces (so it doesn't cut across a town or a slope the route went round).
   */
  private smooth(from: Point, points: Point[], radius: number): Point[] {
    const out: Point[] = [];
    // cum[k + 1]: route cost from `from` to points[k] along the planned cells.
    const cum = [0];
    let prev = from;
    for (const p of points) {
      cum.push(cum[cum.length - 1] + D.hypot(p.x - prev.x, p.z - prev.z) * this.costAt(p.x, p.z));
      prev = p;
    }
    let anchor = from;
    let anchorCum = 0;
    let i = 0;
    while (i < points.length) {
      let j = points.length - 1;
      while (j > i && !(this.lineCost(anchor, points[j], radius) <= (cum[j + 1] - anchorCum) * 1.02 + 0.5)) j--;
      out.push(points[j]);
      anchor = points[j];
      anchorCum = cum[j + 1];
      i = j + 1;
    }
    return out;
  }
}

/**
 * One nav grid per movement class, made when first asked for, all sharing
 * the same building obstacles. Marking an obstacle on any of them marks it
 * on all.
 */
export class NavGrids {
  private readonly grids = new Map<MoveClass, NavGrid>();
  /** The baseline land grid (tracked vehicles), used for lanes, spawn spots and anything not tied to one unit. */
  readonly land: NavGrid;

  constructor(private readonly field: Battlefield) {
    this.land = new NavGrid(field, 'tracked');
    this.grids.set('tracked', this.land);
    // A change to the map mid-battle re-reads those cells on every grid, and re-plans every route.
    field.onChange((area) => {
      for (const grid of this.grids.values()) grid.refresh(area);
      // Refreshing re-reads a cell's neighbours too, so the change reaches one cell further.
      this.land.obstacles.record({ i0: area.i0 - 1, j0: area.j0 - 1, i1: area.i1 + 1, j1: area.j1 + 1 });
    });
  }

  for(move: MoveClass): NavGrid {
    let grid = this.grids.get(move);
    if (!grid) {
      grid = new NavGrid(this.field, move, this.land.obstacles, this.land.cellSize);
      this.grids.set(move, grid);
    }
    return grid;
  }
}
