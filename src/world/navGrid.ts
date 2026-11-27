import { Battlefield } from './battlefield';
import { CellArea, GroundDef } from './ground';
import { MOVE_RULES, MoveClass, MoveRules, RAIL_WALL, STEEP_SLOPE, terrainAllows } from './moveClasses';
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
/** Route cost multiplier on a bridge deck's edge cells, for vehicles: they keep to the middle. */
const DECK_EDGE = 1.6;
/** How finely offSideClear reads the ground between a deck and the strip beside it. */
const SIDE_STEP = 0.1;

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
  /** 1 on high ground, where a steep enough slope is a cliff (see Battlefield.sheer). */
  readonly sheer: Uint8Array;
  /** 1 just outside a bridge deck's railings, 2 beside its ramps' open sides, 0 elsewhere (see Battlefield.railKind). */
  readonly rail: Uint8Array;
  readonly settled: Uint8Array;
  /** 1 in a city's cells, where a gap one cell wide is an alley (see NavGrid.updateClearance). */
  readonly city: Uint8Array;
  /** Whether the map has a city at all. */
  readonly hasCity: boolean;
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
    this.sheer = new Uint8Array(n);
    this.rail = new Uint8Array(n);
    this.settled = new Uint8Array(n);
    this.city = new Uint8Array(n);
    this.ground = new Array<GroundDef>(n);
    this.hasCity = field.townSites.some((t) => t.city);
    this.sample(0, 0, cols - 1, rows - 1);
    field.onChange((area) => this.sample(Math.max(0, area.i0 - 1), Math.max(0, area.j0 - 1), Math.min(cols - 1, area.i1 + 1), Math.min(rows - 1, area.j1 + 1)));
  }

  private sample(i0: number, j0: number, i1: number, j1: number): void {
    const field = this.field;
    const outposts = field.outpostSites;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i;
        const x = field.bounds.minX + (i + 0.5) * this.cellSize;
        const z = field.bounds.minZ + (j + 0.5) * this.cellSize;
        this.deck[k] = field.deckAt(x, z) !== null ? 1 : 0;
        this.rail[k] = this.deck[k] === 0 && field.bridges.length > 0 ? field.railKind(x, z) : 0;
        this.depth[k] = field.seaLevel - field.heightAt(x, z);
        this.slope[k] = field.slopeAt(x, z);
        this.sheer[k] = field.sheerAt(x, z) ? 1 : 0;
        this.settled[k] = field.townSites.some((t) => field.inTown(t, x, z)) || outposts.some((t) => D.hypot(t.x - x, t.z - z) < t.radius) ? 1 : 0;
        this.city[k] = field.inCity(x, z) ? 1 : 0;
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
export class Heap {
  /** Cell indices, a binary heap on their scores (the same swaps as ever, so ties come out the same). */
  private items = new Int32Array(1024);
  private count = 0;
  constructor(private readonly score: Float32Array) {}

  get size(): number {
    return this.count;
  }

  push(i: number): void {
    if (this.count === this.items.length) {
      const more = new Int32Array(this.count * 2);
      more.set(this.items);
      this.items = more;
    }
    const a = this.items;
    const score = this.score;
    let c = this.count++;
    a[c] = i;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (score[a[p]] <= score[a[c]]) break;
      const tmp = a[p];
      a[p] = a[c];
      a[c] = tmp;
      c = p;
    }
  }

  pop(): number {
    const a = this.items;
    const score = this.score;
    const top = a[0];
    const n = --this.count;
    if (n > 0) {
      a[0] = a[n];
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < n && score[a[l]] < score[a[m]]) m = l;
        if (r < n && score[a[r]] < score[a[m]]) m = r;
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
    this.count = 0;
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
  /**
   * Extra route cost per cell from traffic: how busy the narrow passages
   * there are (see game/traffic.ts), for classes that queue on them (see
   * MoveRules.queues). Changing it doesn't re-plan anything; routes planned
   * from then on see it, so a group setting off together spreads over the
   * crossings there are.
   */
  readonly traffic: Float32Array;
  /** Always zero: what classes that don't queue see. */
  readonly calm: Float32Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.occupied = new Uint16Array(cols * rows);
    this.tall = new Uint16Array(cols * rows);
    this.none = new Uint16Array(cols * rows);
    this.traffic = new Float32Array(cols * rows);
    this.calm = new Float32Array(cols * rows);
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
  /** Extra cost per cell from busy narrow passages (NavObstacles.traffic), or zeros for a class that doesn't queue. */
  private readonly traffic: Float32Array;
  /** Distance from each cell centre to the nearest blocked cell centre (or the map edge). */
  private readonly clearance: Float32Array;
  /** Per cell, which of its 8 steps by a bridge deck have been read point by point (low byte) and are clear (high byte); see sideStep. */
  private readonly sides: Uint16Array;
  /** 1 on cells a deck's edge runs through or beside (railing cells, and deck cells next to one off the deck): see byDeck. */
  private readonly deckEdge: Uint8Array;
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
    /** Plans as a side at home in the woods would (Verdant): dense forest costs no more than open ground. */
    readonly woodland = false,
  ) {
    this.cols = Math.ceil(field.width / cellSize);
    this.rows = Math.ceil(field.depth / cellSize);
    this.rules = MOVE_RULES[move];
    this.obstacles = obstacles ?? new NavObstacles(this.cols, this.rows);
    const n = this.cols * this.rows;
    this.terrain = new Uint8Array(n);
    this.cost = new Float32Array(n);
    this.occupied = this.obstacles.for(this.rules.over);
    this.traffic = this.rules.queues ? this.obstacles.traffic : this.obstacles.calm;
    this.clearance = new Float32Array(n);
    this.sides = new Uint16Array(n);
    this.deckEdge = new Uint8Array(n);
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
    this.terrain[k] = terrainAllows(rules, depth, slope, samples.sheer[k] === 1) ? 0 : 1;
    let cost = 1;
    if (onDeck) cost *= rules.bridge;
    // Beside a deck, over its railings: vehicles take the ramps instead,
    // and keep off the deck's edge cells where they can, down the middle.
    if (!rules.flies && rules.minDepth === 0) {
      if (samples.rail[k] !== 0) cost *= rules.rail;
      else if (onDeck && rules.rail >= RAIL_WALL && this.besideRail(k)) cost *= DECK_EDGE;
    }
    if (depth > 0) cost *= rules.waterCost;
    else if (slope > STEEP_SLOPE && rules.steep !== Infinity) cost *= rules.steep;
    if (rules.town !== 1 && samples.settled[k] === 1) cost *= rules.town;
    if (!rules.flies && depth <= 0 && !(this.woodland && samples.ground[k].id === 'thicket')) cost *= samples.ground[k].cost[this.move] ?? 1;
    this.cost[k] = cost;
    this.deckEdge[k] = samples.rail[k] !== 0 || (samples.deck[k] === 1 && this.offDeckBeside(k)) ? 1 : 0;
  }

  /** Whether a cell has a cell off the deck next to it. */
  private offDeckBeside(k: number): boolean {
    const cols = this.cols;
    const i = k % cols;
    const j = (k - i) / cols;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < cols && nj < this.rows && this.samples.deck[nj * cols + ni] === 0) return true;
      }
    }
    return false;
  }

  /** Whether a cell has a railing cell next to it (see CellSamples.rail). */
  private besideRail(k: number): boolean {
    const { cols, rows } = this;
    const i = k % cols;
    const j = (k - i) / cols;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && nj >= 0 && ni < cols && nj < rows && this.samples.rail[nj * cols + ni] !== 0) return true;
      }
    }
    return false;
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
        this.sides[k] = 0;
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

  /**
   * What the cheapest way from a point to every cell costs over this
   * class's terrain (distance times ground cost, buildings aside, as
   * `connected`), Infinity where there's none. For weighing many places at
   * once (see commander/shortcuts.ts) without a search to each.
   */
  costsFrom(from: Point): Float32Array {
    const { cols, rows, terrain, cost } = this;
    const g = new Float32Array(cols * rows).fill(Infinity);
    let [si, sj] = this.cellOf(from.x, from.z);
    if (terrain[sj * cols + si] === 1) {
      const open = this.nearestOpen(from.x, from.z);
      if (!open) return g;
      [si, sj] = open;
    }
    const done = new Uint8Array(cols * rows);
    const heap = new Heap(g);
    const sk = sj * cols + si;
    g[sk] = 0;
    heap.push(sk);
    const free = (ci: number, cj: number) => ci >= 0 && cj >= 0 && ci < cols && cj < rows && terrain[cj * cols + ci] === 0;
    const walls = this.railWalls();
    const { rail, deck } = this.samples;
    while (heap.size > 0) {
      const k = heap.pop();
      if (done[k]) continue;
      done[k] = 1;
      const i = k % cols;
      const j = (k - i) / cols;
      for (let n = 0; n < 8; n++) {
        const di = NEIGHBOUR_DI[n];
        const dj = NEIGHBOUR_DJ[n];
        if (!free(i + di, j + dj)) continue;
        if (di !== 0 && dj !== 0 && (!free(i + di, j) || !free(i, j + dj))) continue;
        const nk = (j + dj) * cols + i + di;
        if (done[nk]) continue;
        if (walls && ((deck[k] === 1 && rail[nk] === 1) || (rail[k] === 1 && deck[nk] === 1))) continue;
        const ng = g[k] + NEIGHBOUR_STEP[n] * this.cellSize * cost[nk];
        if (ng >= g[nk]) continue;
        g[nk] = ng;
        heap.push(nk);
      }
    }
    return g;
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
    const sheer = f.sheerAt(x, z);
    return terrainAllows(this.rules, f.seaLevel - f.heightAt(x, z), this.rules.steep === Infinity || sheer ? f.slopeAt(x, z) : 0, sheer);
  }

  /**
   * Whether a step from a to b gets a mover down off a cliff face it's
   * stuck on (shoved there, or the ground reshaped under it): anywhere it
   * could be but for the slope, no steeper than where it is.
   */
  offCliff(ax: number, az: number, bx: number, bz: number): boolean {
    const f = this.field;
    if (!f.cliffs || this.rules.scales || this.rules.flies || !f.contains(bx, bz) || !f.cliffAt(ax, az)) return false;
    if (f.slopeAt(bx, bz) > f.slopeAt(ax, az)) return false;
    return terrainAllows(this.rules, f.seaLevel - f.heightAt(bx, bz), 0);
  }

  /**
   * Whether going from a to b means climbing over a bridge's railings (one
   * end on a deck, the other just outside its side), for a class that can't
   * (see RAIL_WALL). Movement and shoves check it, so vehicles only get on
   * and off bridges by the ramps.
   */
  railCrossing(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.railWalls()) return false;
    const [ai, aj] = this.cellOf(ax, az);
    const [bi, bj] = this.cellOf(bx, bz);
    // By cells, as routes see the map: a route along the deck's edge cells stays on the deck.
    return this.overRail(aj * this.cols + ai, bj * this.cols + bi);
  }

  /** Whether going from a to b climbs up over a railing onto a deck (see railCrossing), rather than down off one. */
  railBoarding(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.railWalls()) return false;
    const [ai, aj] = this.cellOf(ax, az);
    const [bi, bj] = this.cellOf(bx, bz);
    return this.samples.rail[aj * this.cols + ai] === 1 && this.samples.deck[bj * this.cols + bi] === 1;
  }

  /** Whether this class can't get over bridge railings (routes don't go over them at all). */
  private railWalls(): boolean {
    return this.rules.rail >= RAIL_WALL && !this.rules.flies && this.rules.minDepth === 0;
  }

  /** Whether a step between two cells is over a railing, between a deck and the strip outside it. */
  private overRail(a: number, b: number): boolean {
    const { rail, deck } = this.samples;
    return (deck[a] === 1 && rail[b] === 1) || (rail[a] === 1 && deck[b] === 1);
  }

  /**
   * Whether a land unit really can go straight from (ax, az) to (bx, bz) by a
   * bridge, reading the ground point by point as movement does (see
   * terrainAllowsAt). The cells only sample their middles, and a deck's edge
   * runs through cells: a cell whose middle is on the deck can be half deep
   * water, and a railing cell whose middle is on the bank can start in it.
   * Lines and routes used to cut over a deck's side there; movement wouldn't
   * let a walker go, so it stood wedged against the railing for good (and the
   * dome trucks escorting it parked round it, jamming the bridge).
   */
  private offSideClear(ax: number, az: number, bx: number, bz: number): boolean {
    const steps = Math.max(1, Math.ceil(D.hypot(bx - ax, bz - az) / SIDE_STEP));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.terrainAllowsAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /**
   * Whether a step between these cells runs by a bridge deck, where it's read
   * point by point (see offSideClear), for a class that can get over railings.
   * Vehicles that can't already keep to the deck's middle (see DECK_EDGE and
   * Traffic.keepOn) and only get on and off by the ramps.
   */
  private byDeck(a: number, b: number): boolean {
    if (this.rules.flies || this.railWalls()) return false;
    return this.deckEdge[a] + this.deckEdge[b] > 0;
  }

  /** offSideClear between a cell's middle and its neighbour n's (cell b), worked out once and kept. */
  private sideStep(a: number, n: number, b: number): boolean {
    const known = this.sides[a];
    if (known & (1 << n)) return (known & (256 << n)) !== 0;
    const cols = this.cols;
    const p = this.center(a % cols, Math.floor(a / cols));
    const q = this.center(b % cols, Math.floor(b / cols));
    const ok = this.offSideClear(p.x, p.z, q.x, q.z);
    this.sides[a] = known | (1 << n) | (ok ? 256 << n : 0);
    return ok;
  }

  /** Whether any building stands on a point's cell (whatever this class goes over). */
  builtAt(x: number, z: number): boolean {
    const [i, j] = this.cellOf(x, z);
    return this.obstacles.occupied[j * this.cols + i] > 0;
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
    this.capAlleys();
  }

  /**
   * In a city, a free cell between two blocked ones (east and west, or north
   * and south) is an alley: the buildings either side stand only a cell
   * apart, 1.5 units, though the cell centres are further apart than that.
   * Its room is half a cell, so infantry and the tiniest vehicles fit and
   * everything else keeps to the avenues. Once a building beside it is
   * razed, the gap opens up and it's ordinary ground again.
   */
  private capAlleys(): void {
    const city = this.samples.city;
    if (!this.samples.hasCity) return;
    const { cols, rows } = this;
    const c = this.clearance;
    const half = this.cellSize * 0.5;
    for (let j = 1; j < rows - 1; j++) {
      for (let i = 1; i < cols - 1; i++) {
        const k = j * cols + i;
        if (city[k] === 0 || c[k] <= half) continue;
        if ((c[k - 1] === 0 && c[k + 1] === 0) || (c[k - cols] === 0 && c[k + cols] === 0)) c[k] = half;
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
    const k = j * this.cols + i;
    return this.cost[k] + this.traffic[k];
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
    const walls = this.railWalls();
    const [ai, aj] = this.cellOf(a.x, a.z);
    let prev = aj * this.cols + ai;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const [i, j] = this.cellOf(x, z);
      if (!this.fits(i, j, radius)) return false;
      const k = j * this.cols + i;
      if (this.cost[k] + this.traffic[k] > maxCost + 1e-6) return false;
      // Not over a bridge's railings, even where it's no dearer than the rest of the way.
      if (walls && k !== prev && this.overRail(prev, k)) return false;
      // Nor off a deck's side into water too deep to wade.
      if (this.byDeck(prev, k)) {
        const back = (s - 1) / steps;
        if (!this.offSideClear(a.x + (b.x - a.x) * back, a.z + (b.z - a.z) * back, x, z)) return false;
      }
      prev = k;
    }
    return true;
  }

  /**
   * Whether going straight from a to b keeps, wherever it runs by a bridge
   * deck, to ground this class can stand on (see offSideClear): lineClear's
   * check on its own, for movement to try before heading somewhere close by
   * (the next waypoint, a sidestep when stuck).
   */
  sideClear(a: Point, b: Point): boolean {
    const dist = D.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(dist / (this.cellSize * 0.5));
    const [ai, aj] = this.cellOf(a.x, a.z);
    let prev = aj * this.cols + ai;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const [i, j] = this.cellOf(x, z);
      const k = j * this.cols + i;
      if (this.byDeck(prev, k)) {
        const back = (s - 1) / steps;
        if (!this.offSideClear(a.x + (b.x - a.x) * back, a.z + (b.z - a.z) * back, x, z)) return false;
      }
      prev = k;
    }
    return true;
  }

  /** The closest cell a unit of this radius fits in (searching outward in rings). */
  nearestOpen(x: number, z: number, maxRing = 12, radius = 0, deck = -1): [number, number] | null {
    const [ci, cj] = this.cellOf(x, z);
    const deckOk = (i: number, j: number) => deck < 0 || this.samples.deck[j * this.cols + i] === deck;
    if (this.fits(ci, cj, radius) && deckOk(ci, cj)) return [ci, cj];
    for (let r = 1; r <= maxRing; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (!this.fits(ci + di, cj + dj, radius) || !deckOk(ci + di, cj + dj)) continue;
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
    // Every open cell has at least a cell's width of room, so small units need no special treatment,
    // except in a city, where an alley has only half that (see capAlleys).
    const wide = radius + CLEARANCE_MARGIN > (this.samples.hasCity ? this.cellSize * 0.5 : this.cellSize);
    // In a city, the tighter fit still keeps out of the alleys (half a cell of room).
    const city = wide && this.samples.hasCity;
    const tighter = city ? Math.max(radius * 0.5, this.cellSize * 0.5) : radius * 0.5;
    for (const r of wide ? [radius, tighter] : []) {
      const route = this.route(from, to, r);
      if (route?.found) return route.points;
    }
    // A wide vehicle that squeezes down an alley sticks there: in a city it settles for the nearest spot it fits to
    // the goal (looking a little further round it), on the avenues, rather than take any open cell.
    if (city) {
      const near = this.route(from, to, tighter, 12);
      if (near) return near.points;
    }
    return this.route(from, to, 0)?.points ?? null;
  }

  private route(from: Point, to: Point, radius: number, goalRing = radius > 0 ? 6 : 12): { points: Point[]; found: boolean } | null {
    // A wide unit standing somewhere tight starts by backing out to the nearest roomy spot,
    // rather than planning onward through a gap it can't fit.
    // Not over a railing, though: from beside a bridge, the deck is no nearer than the ramp.
    const [fi, fj] = this.cellOf(from.x, from.z);
    const fk = fj * this.cols + fi;
    const side = this.railWalls() && (this.samples.rail[fk] === 1 || this.samples.deck[fk] === 1) ? this.samples.deck[fk] : -1;
    const start = (radius > 0 ? this.nearestOpen(from.x, from.z, 3, radius, side) : null) ?? this.nearestOpen(from.x, from.z, 12, 0, side) ?? this.nearestOpen(from.x, from.z);
    // A wide unit settles for a spot near the goal; much further away and it's better to squeeze in.
    // A goal this class can't get to at all (a boat sent inland, a hover past a cliff) becomes the
    // nearest spot it can: the shore closest to the enemy base, say.
    const reach = this.nearestInRegion(to.x, to.z, start ? this.region[start[1] * this.cols + start[0]] : -1);
    const goal = this.nearestOpen(reach.x, reach.z, goalRing, radius);
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
    const { terrain, occupied, clearance, cost, traffic, closed, stamp, g, f, parent, open } = this;
    if (radius > 0) this.updateClearance();
    const need = radius + CLEARANCE_MARGIN;
    const isBlocked = (ci: number, cj: number) => ci < 0 || cj < 0 || ci >= cols || cj >= rows || terrain[cj * cols + ci] === 1 || occupied[cj * cols + ci] > 0;
    const walls = this.railWalls();
    // overRail and byDeck, written out too.
    const { rail, deck } = this.samples;
    const deckEdge = this.deckEdge;
    const sides = !this.rules.flies && !walls;
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
        if (walls && ((deck[k] === 1 && rail[nk] === 1) || (rail[k] === 1 && deck[nk] === 1))) continue;
        if (sides && deckEdge[k] + deckEdge[nk] > 0 && !this.sideStep(k, n, nk)) continue;
        const ng = g[k] + NEIGHBOUR_STEP[n] * (cost[nk] + traffic[nk]);
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
    const walls = this.railWalls();
    let prev = -1;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const [i, j] = this.cellOf(x, z);
      const k = j * this.cols + i;
      if (walls && prev >= 0 && k !== prev && this.overRail(prev, k)) return Infinity;
      if (prev >= 0 && this.byDeck(prev, k)) {
        const back = (s - 1) / steps;
        if (!this.offSideClear(a.x + (b.x - a.x) * back, a.z + (b.z - a.z) * back, x, z)) return Infinity;
      }
      prev = k;
      if (s === 0) continue;
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
  private readonly woods = new Map<MoveClass, NavGrid>();
  /** The baseline land grid (tracked vehicles), used for lanes, spawn spots and anything not tied to one unit. */
  readonly land: NavGrid;

  constructor(private readonly field: Battlefield) {
    this.land = new NavGrid(field, 'tracked');
    this.grids.set('tracked', this.land);
    // A change to the map mid-battle re-reads those cells on every grid, and re-plans every route.
    field.onChange((area) => {
      for (const grid of this.grids.values()) grid.refresh(area);
      for (const grid of this.woods.values()) grid.refresh(area);
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

  /**
   * The grid a unit plans its routes on: its class's, or for a side at home
   * in the woods (Verdant), a copy that walks straight through dense forest.
   * Where it can go is the same either way; only what a route costs differs.
   */
  route(move: MoveClass, woodland: boolean): NavGrid {
    if (!woodland) return this.for(move);
    let grid = this.woods.get(move);
    if (!grid) {
      grid = new NavGrid(this.field, move, this.land.obstacles, this.land.cellSize, true);
      this.woods.set(move, grid);
    }
    return grid;
  }
}
