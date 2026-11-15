import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import { BiomeId } from './biomes';
import { CellArea, GROUND_DEFS, GROUND_IDS, GroundDef, GroundId, groundCode } from './ground';
import { connectTowns } from './roads';
import { CITY_CELL, CityPlan, inCityPlan, planCity, snapToCell } from './city';
import { growWoods, Woods } from './woods';
import { bridgeChannels, bridgeLand, carveWaterways, cutBanks, landReach, vertexAt } from './waterways';
import * as D from '../core/dmath';

/**
 * The battlefield is pure data: a heightmap plus the sites where factions
 * build their bases. Gameplay reads it (heightAt, isWater, bounds) and the
 * renderer turns it into meshes; neither depends on the other.
 *
 * World axes: x runs along the long side (faction 0 on -x, faction 1 on +x),
 * z across, y up. The map is centred on the origin.
 */
export interface BattlefieldConfig {
  cols: number;
  rows: number;
  cellSize: number;
  maxHeight: number;
  seaLevel: number;
  /** Radius of the flattened pad reserved for each faction's base. */
  baseRadius: number;
  /**
   * Which faction sits at each base seat, going round the map from the west
   * (see seatPoint). Its length is the number of bases. Teammates are given
   * neighbouring seats.
   */
  seats: number[];
  /** Capturable outposts to place in no-man's land (fewer if they don't fit). */
  outposts: number;
  /**
   * What kinds of outpost to build (see OUTPOST_KINDS in game/outposts.ts):
   * the map deals them out in a shuffled order, cycling through the list,
   * with a hilltop gun going to the highest site.
   */
  outpostKinds: OutpostKind[];
  /** The map's look: ground and water colours, scenery and town style (see biomes.ts). */
  biome: BiomeId;
  /**
   * Join the bases' water with channels (see waterways.ts): 'off', 'joined'
   * (link the water bases already have, when two or more do) or 'everyBase'
   * (also dig an inlet to any base without water).
   */
  waterways: 'off' | 'joined' | 'everyBase';
  /** Dense forest (see woods.ts): roughly the share of open land it covers, 0 for none. */
  forest: number;
  /** Civilian towns in no-man's land, and their radius. */
  towns: number;
  townRadius: number;
  /** The first town is a city instead (see city.ts), reaching at most this far from its middle each way; 0 for none. */
  cityRadius: number;
  /** One city covering the whole map instead of any towns (see city.ts): blocks wherever the ground allows. */
  citySprawl: boolean;
  /**
   * Base positions per seat as fractions of the half-width and half-depth
   * (-1 to 1), or null to place them round the map's edge (see seatPoint).
   */
  places: { x: number; z: number }[] | null;
  /** Towns' and outposts' positions, in the same fractions, or null to place them automatically (towns then go by `towns`, outposts by `outposts`). */
  townPlaces: { x: number; z: number }[] | null;
  outpostPlaces: { x: number; z: number }[] | null;
}

export const DEFAULT_BATTLEFIELD: BattlefieldConfig = {
  cols: 84,
  rows: 64,
  cellSize: 1.5,
  maxHeight: 9,
  seaLevel: 1.4,
  baseRadius: 16,
  seats: [0, 1],
  outposts: 0,
  outpostKinds: ['supply'],
  biome: 'temperate',
  waterways: 'joined',
  forest: 0,
  towns: 1,
  townRadius: 11,
  cityRadius: 0,
  citySprawl: false,
  places: null,
  townPlaces: null,
  outpostPlaces: null,
};

/** Width of town streets and the roads between towns. */
export const STREET_WIDTH = 3.2;

/** Radius of an outpost's flattened pad. */
export const OUTPOST_RADIUS = 7;

/** Clear ground between neighbouring base pads, on top of their radii. */
const BASE_GAP = 12;

/**
 * Nominal centre of base seat `k` of `n`. Seats are spread evenly round a
 * rounded rectangle inset from the map edge, starting on the west side: two
 * seats sit at the west and east ends, four at the corners, and so on.
 * `jitter` (-1..1) nudges a seat along the edge so maps vary.
 */
export function seatPoint(k: number, n: number, width: number, depth: number, baseRadius: number, jitter = 0): { x: number; z: number } {
  const rx = width / 2 - baseRadius - 6;
  const rz = depth / 2 - baseRadius - 6;
  const angle = Math.PI / 2 + Math.PI / n + (2 * Math.PI * k) / n + jitter * (Math.PI / n) * 0.2;
  // A squircle rather than an ellipse, so corner seats sit out in the corners.
  const c = D.cos(angle);
  const s = D.sin(angle);
  return { x: rx * Math.sign(c) * Math.sqrt(Math.abs(c)), z: rz * Math.sign(s) * Math.sqrt(Math.abs(s)) };
}

/** Whether `n` bases fit on a map this size with room between neighbours (jitter included). */
export function seatsFit(n: number, width: number, depth: number, baseRadius: number): boolean {
  for (let k = 0; k < n; k++) {
    for (const [ja, jb] of [[1, -1], [0, 0]]) {
      const a = seatPoint(k, n, width, depth, baseRadius, ja);
      const b = seatPoint((k + 1) % n, n, width, depth, baseRadius, jb);
      if (n > 1 && D.hypot(a.x - b.x, a.z - b.z) < baseRadius * 2 + BASE_GAP) return false;
    }
  }
  return true;
}

export interface BaseSite {
  faction: number;
  x: number;
  z: number;
  radius: number;
  /** Ground height of the flattened pad. */
  height: number;
}

/** A flattened clearing in no-man's land where a civilian town stands. */
export interface TownSite {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Which way its streets run: the main street runs along this angle (radians from +x). */
  angle: number;
  /** A city's plan (see city.ts): its lots, avenues and alleys. Cities run square to the map (angle 0). */
  city?: CityPlan;
}

/**
 * The kinds of outpost (what each one gives is in game/outposts.ts): a supply
 * depot, an airstrip, a hilltop gun, a comms relay, a fuel depot or a ruined
 * factory.
 */
export type OutpostKind = 'supply' | 'airstrip' | 'gun' | 'relay' | 'fuel' | 'factory';
export const OUTPOST_KIND_IDS: OutpostKind[] = ['supply', 'airstrip', 'gun', 'relay', 'fuel', 'factory'];

/** A flattened clearing in no-man's land where a capturable outpost stands. */
export interface OutpostSite {
  /** Index in Battlefield.outpostSites (and SimContext.outposts). */
  index: number;
  kind: OutpostKind;
  x: number;
  z: number;
  radius: number;
  height: number;
}

/**
 * A bridge over water: a straight deck from bank to bank, wide enough for
 * tanks, that can't be destroyed. Land units drive over it and boats pass
 * underneath (see Battlefield.deckAt). It's part of the map, not a building.
 */
export interface Bridge {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  /** Deck height in the middle; the ends ramp down to meet the banks, no steeper than DECK_GRADE. */
  level: number;
  /** Thrown across by a side's engineers (see commander/engineers.ts): it can come down. The side that built it. */
  builtBy?: number;
  /** Come down (see removeBridge): kept in the list so other bridges keep their indices, but it's no longer there. */
  gone?: boolean;
}

/** Room under a bridge deck, above the water. */
export const BRIDGE_CLEARANCE = 1.3;
/** Steepest a bridge's ramps get (rise over run). */
export const DECK_GRADE = 0.35;
/**
 * How far out from a bridge deck's edge its railings count (see railAt), and
 * how high the deck has to stand above the ground beside it for that to be a
 * railing rather than the open mouth of a ramp.
 */
export const RAIL_REACH = 1.6;
export const RAIL_DROP = 0.3;

/**
 * A paved road: a strip of road ground along a line of points (see
 * Battlefield.addRoad). Kept as a line, not just as cells, so it can be
 * drawn as a smooth strip rather than a staircase of cells.
 */
export interface Road {
  points: { x: number; z: number }[];
  width: number;
  /** Its width at each point, where it changes along the way (a city's avenue tapering to a country road); `width` throughout if left out. */
  widths?: number[];
  /** A town's main street (or a city's avenue), a road out in the country (see roads.ts), or a city's alley. */
  kind: RoadKind;
}

export type RoadKind = 'street' | 'road' | 'alley';

/**
 * Where roads meet on purpose: one road (the branch) ends on another's line
 * there, and the renderer draws every road's paving over every road's kerb
 * so the two read as one (see roads.ts and terrainMesh.ts). Roads are named
 * by their index in Battlefield.roads.
 */
export interface Junction {
  x: number;
  z: number;
  roads: number[];
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Some cells' contents, copied from one copy of a map to another (see Battlefield.cellState). */
export interface CellState {
  area: CellArea;
  ground: Uint8Array;
  roadCell: Uint8Array;
  bridgeCell: Int16Array;
  /** The area's vertex heights, (w + 1) * (h + 1). */
  heights: Float32Array;
  bridges: Bridge[];
  roads: Road[];
  junctions: Junction[];
}

/** Something that wants to know when the map changes (see Battlefield.onChange). */
export type MapChangeListener = (area: CellArea) => void;

export class Battlefield {
  readonly width: number;
  readonly depth: number;
  readonly bounds: Bounds;
  /** Ground kind per map cell (cols * rows, row-major along x), as codes into GROUND_IDS. */
  readonly ground: Uint8Array;
  readonly bridges: Bridge[] = [];
  readonly roads: Road[] = [];
  readonly junctions: Junction[] = [];
  /** Dense forest's trees (see woods.ts). */
  readonly woods: Woods;
  /** Per cell: 1 where a road (see addRoad) covers it, so the terrain leaves its colour to the road strip. */
  readonly roadCell: Uint8Array;
  /** Per cell: the index of the bridge over it, or -1. */
  private readonly bridgeCell: Int16Array;
  private readonly listeners: MapChangeListener[] = [];
  /** Bumps on every change, for anything that caches what the map looked like. */
  version = 0;
  /** Vertex heights as the map was made, before the battle reshaped anything (see markMade, wasWater). */
  private madeHeights: Float32Array | null = null;

  constructor(
    readonly config: BattlefieldConfig,
    /** Vertex heights, (cols + 1) * (rows + 1), row-major along x. */
    readonly heights: Float32Array,
    readonly baseSites: BaseSite[],
    readonly townSites: TownSite[] = [],
    readonly outpostSites: OutpostSite[] = [],
  ) {
    this.width = config.cols * config.cellSize;
    this.depth = config.rows * config.cellSize;
    this.bounds = {
      minX: -this.width / 2,
      maxX: this.width / 2,
      minZ: -this.depth / 2,
      maxZ: this.depth / 2,
    };
    this.ground = new Uint8Array(config.cols * config.rows);
    this.bridgeCell = new Int16Array(config.cols * config.rows).fill(-1);
    this.roadCell = new Uint8Array(config.cols * config.rows);
    this.woods = new Woods(this);
  }

  /** Whether a point is in a city (see city.ts): its blocks, alleys and avenues. */
  inCity(x: number, z: number, margin = 0): boolean {
    for (const t of this.townSites) if (t.city && inCityPlan(t.city, x, z, margin)) return true;
    return false;
  }

  /** Whether a point is inside a town (a city's squarish outline, or a town's circle). */
  inTown(t: TownSite, x: number, z: number): boolean {
    return t.city ? inCityPlan(t.city, x, z) : D.hypot(t.x - x, t.z - z) < t.radius;
  }

  /** The map cell (i, j) a point is in, clamped to the map. */
  cellAt(x: number, z: number): [number, number] {
    const { cellSize, cols, rows } = this.config;
    const i = Math.max(0, Math.min(cols - 1, Math.floor((x - this.bounds.minX) / cellSize)));
    const j = Math.max(0, Math.min(rows - 1, Math.floor((z - this.bounds.minZ) / cellSize)));
    return [i, j];
  }

  /** What covers the ground at a point (see ground.ts). */
  groundAt(x: number, z: number): GroundDef {
    const [i, j] = this.cellAt(x, z);
    return GROUND_DEFS[GROUND_IDS[this.ground[j * this.config.cols + i]]];
  }

  /**
   * Hear about every change to the map: the rectangle of cells whose
   * height, ground or bridges changed. Route grids, the terrain mesh and
   * anything else that caches the map listen, so a change made mid-battle
   * shows up everywhere.
   */
  onChange(listener: MapChangeListener): () => void {
    this.listeners.push(listener);
    return () => this.listeners.splice(this.listeners.indexOf(listener), 1);
  }

  /** Tell the listeners that these cells changed. */
  changed(area: CellArea): void {
    this.version++;
    for (const l of [...this.listeners]) l(area);
  }

  /**
   * Everything a change to these cells can have touched (ground, roads,
   * bridges and the heights of their corners), to copy onto another copy
   * of this map with applyCells (see sim/mirror.ts).
   */
  cellState(area: CellArea): CellState {
    const { cols } = this.config;
    const w = area.i1 - area.i0 + 1;
    const h = area.j1 - area.j0 + 1;
    const ground = new Uint8Array(w * h);
    const roadCell = new Uint8Array(w * h);
    const bridgeCell = new Int16Array(w * h);
    const heights = new Float32Array((w + 1) * (h + 1));
    for (let j = 0; j < h; j++) {
      const from = (area.j0 + j) * cols + area.i0;
      ground.set(this.ground.subarray(from, from + w), j * w);
      roadCell.set(this.roadCell.subarray(from, from + w), j * w);
      bridgeCell.set(this.bridgeCell.subarray(from, from + w), j * w);
    }
    for (let j = 0; j <= h; j++) {
      const from = (area.j0 + j) * (cols + 1) + area.i0;
      heights.set(this.heights.subarray(from, from + w + 1), j * (w + 1));
    }
    return { area, ground, roadCell, bridgeCell, heights, bridges: this.bridges.slice(), roads: this.roads.slice(), junctions: this.junctions.slice() };
  }

  /** Copy cells from another copy of this map (see cellState) and tell the listeners. */
  applyCells(state: CellState): void {
    const { area } = state;
    const { cols } = this.config;
    const w = area.i1 - area.i0 + 1;
    const h = area.j1 - area.j0 + 1;
    for (let j = 0; j < h; j++) {
      const to = (area.j0 + j) * cols + area.i0;
      this.ground.set(state.ground.subarray(j * w, j * w + w), to);
      this.roadCell.set(state.roadCell.subarray(j * w, j * w + w), to);
      this.bridgeCell.set(state.bridgeCell.subarray(j * w, j * w + w), to);
    }
    for (let j = 0; j <= h; j++) {
      this.heights.set(state.heights.subarray(j * (w + 1), (j + 1) * (w + 1)), (area.j0 + j) * (cols + 1) + area.i0);
    }
    this.bridges.splice(0, this.bridges.length, ...state.bridges);
    this.roads.splice(0, this.roads.length, ...state.roads);
    this.junctions.splice(0, this.junctions.length, ...state.junctions);
    this.changed(area);
  }

  /** The cells within `radius` of a point, as a rectangle. */
  areaAround(x: number, z: number, radius: number): CellArea {
    const [i0, j0] = this.cellAt(x - radius, z - radius);
    const [i1, j1] = this.cellAt(x + radius, z + radius);
    return { i0, j0, i1, j1 };
  }

  /**
   * Lay a kind of ground over the cells whose centres are within `radius` of
   * a point (e.g. scrap where a wreck falls). `where` can skip cells, for
   * example to only cover plain ground. Returns how many cells changed.
   */
  paint(x: number, z: number, radius: number, ground: GroundId, where?: (current: GroundId, cx: number, cz: number) => boolean): number {
    const area = this.areaAround(x, z, radius);
    const code = groundCode(ground);
    const { cols, cellSize } = this.config;
    let n = 0;
    for (let j = area.j0; j <= area.j1; j++) {
      for (let i = area.i0; i <= area.i1; i++) {
        const cx = this.bounds.minX + (i + 0.5) * cellSize;
        const cz = this.bounds.minZ + (j + 0.5) * cellSize;
        const k = j * cols + i;
        if (this.ground[k] === code || D.hypot(cx - x, cz - z) > radius) continue;
        if (where && !where(GROUND_IDS[this.ground[k]], cx, cz)) continue;
        this.ground[k] = code;
        n++;
      }
    }
    if (n > 0) this.changed(area);
    return n;
  }

  /** Lay a kind of ground on these cells (indices into `ground`), announcing them as one change. */
  setGround(cells: number[], ground: GroundId): void {
    const code = groundCode(ground);
    const { cols } = this.config;
    let area: CellArea | null = null;
    for (const k of cells) {
      if (this.ground[k] === code) continue;
      this.ground[k] = code;
      const i = k % cols;
      const j = (k - i) / cols;
      area = area ? { i0: Math.min(area.i0, i), j0: Math.min(area.j0, j), i1: Math.max(area.i1, i), j1: Math.max(area.j1, j) } : { i0: i, j0: j, i1: i, j1: j };
    }
    if (area) this.changed(area);
  }

  /**
   * Change the ground's height round a point: `shape` gets each vertex's
   * height and its distance from the point and returns the new height (dig
   * a canal, raise a wall's footing). Returns how many vertices moved.
   */
  reshape(x: number, z: number, radius: number, shape: (height: number, distance: number) => number): number {
    const { cols, cellSize } = this.config;
    const i0 = Math.max(0, Math.floor((x - radius - this.bounds.minX) / cellSize));
    const i1 = Math.min(cols, Math.ceil((x + radius - this.bounds.minX) / cellSize));
    const j0 = Math.max(0, Math.floor((z - radius - this.bounds.minZ) / cellSize));
    const j1 = Math.min(this.config.rows, Math.ceil((z + radius - this.bounds.minZ) / cellSize));
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = D.hypot(this.vertexX(i) - x, this.vertexZ(j) - z);
        if (d > radius) continue;
        const k = j * (cols + 1) + i;
        const h = shape(this.heights[k], d);
        if (h === this.heights[k]) continue;
        this.heights[k] = h;
        n++;
      }
    }
    // Cells touching a moved vertex change shape (and slope, one cell further out).
    if (n > 0) this.changed({ i0: Math.max(0, i0 - 2), j0: Math.max(0, j0 - 2), i1: Math.min(cols - 1, i1 + 1), j1: Math.min(this.config.rows - 1, j1 + 1) });
    return n;
  }

  /** Note that roads meet here (see Junction). Drawing only: the roads' own cells are paved already. */
  addJunction(junction: Junction): void {
    this.junctions.push(junction);
  }

  /** Put a bridge on the map (see waterways.ts placeBridge, which picks its ends and level and cuts the banks to fit). */
  addBridge(bridge: Bridge): void {
    const index = this.bridges.length;
    this.bridges.push(bridge);
    const { cols, cellSize } = this.config;
    const pad = bridge.width / 2 + RAIL_REACH;
    const area = this.areaAround((bridge.ax + bridge.bx) / 2, (bridge.az + bridge.bz) / 2, D.hypot(bridge.bx - bridge.ax, bridge.bz - bridge.az) / 2 + pad);
    for (let j = area.j0; j <= area.j1; j++) {
      for (let i = area.i0; i <= area.i1; i++) {
        const cx = this.bounds.minX + (i + 0.5) * cellSize;
        const cz = this.bounds.minZ + (j + 0.5) * cellSize;
        if (this.deckOf(bridge, cx, cz) !== null) this.bridgeCell[j * cols + i] = index;
      }
    }
    this.changed(area);
  }

  /**
   * Take a bridge off the map (an engineers' bridge coming down). It stays in
   * the list, marked gone, so the other bridges keep their indices.
   */
  removeBridge(index: number): void {
    const bridge = this.bridges[index];
    if (!bridge || bridge.gone) return;
    this.bridges[index] = { ...bridge, gone: true };
    const { cols } = this.config;
    const area = this.areaAround((bridge.ax + bridge.bx) / 2, (bridge.az + bridge.bz) / 2, D.hypot(bridge.bx - bridge.ax, bridge.bz - bridge.az) / 2 + bridge.width / 2 + RAIL_REACH + 1);
    for (let j = area.j0; j <= area.j1; j++) for (let i = area.i0; i <= area.i1; i++) if (this.bridgeCell[j * cols + i] === index) this.bridgeCell[j * cols + i] = -1;
    this.changed(area);
  }

  /** The index of the bridge whose deck is over a point, or -1. */
  bridgeAt(x: number, z: number): number {
    const [i, j] = this.cellAt(x, z);
    return this.bridgeCell[j * this.config.cols + i];
  }

  /** A bridge's deck height at a point, or null if the point isn't on it. */
  private deckOf(b: Bridge, x: number, z: number): number | null {
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const length = D.hypot(dx, dz);
    const t = ((x - b.ax) * dx + (z - b.az) * dz) / (length * length);
    if (t < 0 || t > 1) return null;
    const off = Math.abs((x - b.ax) * dz - (z - b.az) * dx) / length;
    if (off > b.width / 2) return null;
    // Level in the middle, ramping down to meet the ground at each end (wherever it is now).
    const ha = this.heightAt(b.ax, b.az);
    const hb = this.heightAt(b.bx, b.bz);
    return Math.min(b.level, ha + DECK_GRADE * t * length, hb + DECK_GRADE * (1 - t) * length);
  }

  /**
   * Whether a point is just outside a bridge deck's railings: beside the
   * deck (not off either end), within RAIL_REACH of its edge, where the deck
   * stands at least RAIL_DROP above the ground (or over water). Getting on or
   * off a bridge there means going over the railing, so routes keep to the
   * ramps at its ends (see NavGrid).
   */
  railAt(x: number, z: number): boolean {
    return this.railKind(x, z) !== 0;
  }

  /**
   * What's beside a bridge deck at a point (see railAt): 0 nothing; 1 a
   * railing, along the level middle and wherever the deck is over water;
   * 2 the open side of a ramp, which has no railing (and flares out a
   * little, see render/terrainMesh.ts): rough to drive up onto from the
   * side, but not a wall.
   */
  railKind(x: number, z: number): 0 | 1 | 2 {
    if (this.deckAt(x, z) !== null) return 0;
    let kind: 0 | 1 | 2 = 0;
    for (const b of this.bridges) {
      if (b.gone) continue;
      const dx = b.bx - b.ax;
      const dz = b.bz - b.az;
      const length = D.hypot(dx, dz);
      const t = ((x - b.ax) * dx + (z - b.az) * dz) / (length * length);
      if (t < 0 || t > 1) continue;
      const off = Math.abs((x - b.ax) * dz - (z - b.az) * dx) / length;
      if (off <= b.width / 2 - 0.01 || off > b.width / 2 + RAIL_REACH) continue;
      // The deck's height level with the point, against the ground (or water) there.
      const deck = this.deckOf(b, b.ax + dx * t, b.az + dz * t);
      if (deck === null) continue;
      if (deck - Math.max(this.heightAt(x, z), this.seaLevel) >= RAIL_DROP || this.isWater(x, z)) {
        if (this.railedAt(b, t)) return 1;
        kind = 2;
      }
    }
    return kind;
  }

  /** Whether a bridge has railings at `t` along it (0 at a, 1 at b): along its level middle, and wherever it's over water; not on its ramps. */
  railedAt(b: Bridge, t: number): boolean {
    const x = b.ax + (b.bx - b.ax) * t;
    const z = b.az + (b.bz - b.az) * t;
    if (this.isWater(x, z)) return true;
    const deck = this.deckOf(b, x, z);
    return deck !== null && deck >= b.level - 0.05;
  }

  /**
   * The height of bridge `index`'s deck level with a point, as if the deck
   * ran on out sideways: for laying a hull that's on the deck flat along it,
   * however far it hangs over the side (see systems/tilt.ts). Null off
   * either end, or once the bridge is gone.
   */
  deckLevelBeside(index: number, x: number, z: number): number | null {
    const b = this.bridges[index];
    if (!b || b.gone) return null;
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const length = D.hypot(dx, dz);
    const t = ((x - b.ax) * dx + (z - b.az) * dz) / (length * length);
    if (t < 0 || t > 1) return null;
    return this.deckOf(b, b.ax + dx * t, b.az + dz * t);
  }

  /** Whether a point is on or within `margin` of a bridge (buildings keep off them). */
  nearBridge(x: number, z: number, margin = 0): boolean {
    return this.bridges.some((b) => !b.gone && distanceToSegment(x, z, b.ax, b.az, b.bx, b.bz) < b.width / 2 + margin);
  }

  /**
   * Pave a road along a line of points: road ground on every dry cell within
   * half the width of the line (not on bridges, which are paved already).
   * Works mid-battle too, like paint. Returns the road's index in `roads`
   * (-1 for a line too short to be one).
   */
  addRoad(points: { x: number; z: number }[], width: number, kind: RoadKind = 'road', widths?: number[]): number {
    if (points.length < 2) return -1;
    const index = this.roads.length;
    this.roads.push(widths ? { points, width, kind, widths } : { points, width, kind });
    const { cols, cellSize } = this.config;
    const code = groundCode('road');
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    const [i0, j0] = this.cellAt(Math.min(...xs) - width, Math.min(...zs) - width);
    const [i1, j1] = this.cellAt(Math.max(...xs) + width, Math.max(...zs) + width);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = this.bounds.minX + (i + 0.5) * cellSize;
        const cz = this.bounds.minZ + (j + 0.5) * cellSize;
        // Inside any stretch's half-width (a tapering stretch counts as its narrower end).
        let inside = false;
        for (let k = 1; k < points.length && !inside; k++) {
          const w = widths ? Math.min(widths[k - 1], widths[k]) : width;
          inside = distanceToSegment(cx, cz, points[k - 1].x, points[k - 1].z, points[k].x, points[k].z) <= w / 2;
        }
        if (!inside || this.isWater(cx, cz) || this.deckAt(cx, cz) !== null) continue;
        this.ground[j * cols + i] = code;
        this.roadCell[j * cols + i] = 1;
      }
    }
    this.changed({ i0, j0, i1, j1 });
    return index;
  }

  /** Height of a bridge deck at a point, if a bridge is there and above the ground. */
  deckAt(x: number, z: number): number | null {
    const [i, j] = this.cellAt(x, z);
    const index = this.bridgeCell[j * this.config.cols + i];
    if (index < 0) return null;
    const deck = this.deckOf(this.bridges[index], x, z);
    return deck !== null && deck > this.heightAt(x, z) ? deck : null;
  }

  get seaLevel(): number {
    return this.config.seaLevel;
  }

  vertexHeight(i: number, j: number): number {
    const { cols, rows } = this.config;
    i = Math.max(0, Math.min(cols, i));
    j = Math.max(0, Math.min(rows, j));
    return this.heights[j * (cols + 1) + i];
  }

  /** World position of vertex (i, j). */
  vertexX(i: number): number {
    return this.bounds.minX + i * this.config.cellSize;
  }

  vertexZ(j: number): number {
    return this.bounds.minZ + j * this.config.cellSize;
  }

  /** Ground height at any world point, bilinearly interpolated and clamped to the map. */
  heightAt(x: number, z: number): number {
    const { cellSize, cols, rows } = this.config;
    const gx = Math.max(0, Math.min(cols, (x - this.bounds.minX) / cellSize));
    const gz = Math.max(0, Math.min(rows, (z - this.bounds.minZ) / cellSize));
    const i = Math.min(cols - 1, Math.floor(gx));
    const j = Math.min(rows - 1, Math.floor(gz));
    const fx = gx - i;
    const fz = gz - j;
    const h00 = this.vertexHeight(i, j);
    const h10 = this.vertexHeight(i + 1, j);
    const h01 = this.vertexHeight(i, j + 1);
    const h11 = this.vertexHeight(i + 1, j + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** Remember the map as it was made, so later changes can tell made water from the map's own (see wasWater). */
  markMade(): void {
    this.madeHeights = this.heights.slice();
  }

  /**
   * Whether a point was under water when the map was made: the sea, lakes
   * and rivers, not ponds that craters, quakes, god powers or engineers'
   * digging left mid-battle.
   */
  wasWater(x: number, z: number): boolean {
    const made = this.madeHeights;
    if (!made) return this.isWater(x, z);
    const { cellSize, cols, rows } = this.config;
    const gx = Math.max(0, Math.min(cols, (x - this.bounds.minX) / cellSize));
    const gz = Math.max(0, Math.min(rows, (z - this.bounds.minZ) / cellSize));
    const i = Math.min(cols - 1, Math.floor(gx));
    const j = Math.min(rows - 1, Math.floor(gz));
    const fx = gx - i;
    const fz = gz - j;
    const at = (a: number, b: number) => made[b * (cols + 1) + a];
    const h = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fz) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fz;
    return h < this.seaLevel;
  }

  /** Height a unit should stand at: ground, a bridge deck, or the water surface for anything over water. */
  surfaceAt(x: number, z: number): number {
    const deck = this.deckAt(x, z);
    return Math.max(this.heightAt(x, z), this.seaLevel, deck ?? -Infinity);
  }

  /** Height a boat floats at: the water surface (or the ground, if it's run aground), passing under bridges. */
  waterSurfaceAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), this.seaLevel);
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < this.seaLevel;
  }

  /** Rough steepness (rise over run) at a point, for placement and pathing decisions. */
  slopeAt(x: number, z: number): number {
    const d = this.config.cellSize * 0.5;
    const dx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const dz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return D.hypot(dx, dz) / (2 * d);
  }

  contains(x: number, z: number, margin = 0): boolean {
    const b = this.bounds;
    return x >= b.minX + margin && x <= b.maxX - margin && z >= b.minZ + margin && z <= b.maxZ - margin;
  }

  clampX(x: number, margin = 0): number {
    return Math.max(this.bounds.minX + margin, Math.min(this.bounds.maxX - margin, x));
  }

  clampZ(z: number, margin = 0): number {
    return Math.max(this.bounds.minZ + margin, Math.min(this.bounds.maxZ - margin, z));
  }
}

/** Distance from a point to the segment a-b. */
export function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return D.hypot(x - ax - dx * t, z - az - dz * t);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function generateBattlefield(rng: Rng, config: BattlefieldConfig = DEFAULT_BATTLEFIELD): Battlefield {
  const { cols, rows, cellSize, maxHeight, seaLevel, baseRadius } = config;
  const noise = createNoise2D(() => rng.next());
  const ridgeNoise = createNoise2D(() => rng.next());
  const width = cols * cellSize;
  const depth = rows * cellSize;

  const fbm = (x: number, z: number) => {
    let sum = 0;
    let amp = 1;
    let freq = 1 / 40;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += noise(x * freq, z * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  };

  // Base pads sit round the edge of the map, each nudged a little along it, unless the layout places them.
  const seats = config.seats;
  const baseSites: BaseSite[] = seats.map((faction, k) => {
    const nudge = rng.range(-1, 1);
    const place = config.places?.[k];
    // (A placed base is kept on the map, pad and all.)
    const inside = (v: number, half: number) => Math.max(-(half - baseRadius - 1), Math.min(half - baseRadius - 1, v * half));
    const at = place ? { x: inside(place.x, width / 2), z: inside(place.z, depth / 2) } : seatPoint(k, seats.length, width, depth, baseRadius, nudge);
    return { faction, ...at, radius: baseRadius, height: 0 };
  });
  // Indexed by faction, so baseSites[f] is faction f's base.
  baseSites.sort((a, b) => a.faction - b.faction);

  const heights = new Float32Array((cols + 1) * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = -width / 2 + i * cellSize;
      const z = -depth / 2 + j * cellSize;
      const rolling = fbm(x, z) * 0.5 + 0.5;
      const ridge = 1 - Math.abs(ridgeNoise(x / 55, z / 55));
      let h = D.pow(rolling, 1.5) * maxHeight * 0.75 + D.pow(ridge, 4) * maxHeight * 0.35;
      // Taper the outermost cells down a little so the board reads as a diorama.
      const edge = Math.min(i, cols - i, j, rows - j);
      h *= 0.55 + 0.45 * smoothstep(0, 4, edge);
      heights[j * (cols + 1) + i] = h;
    }
  }

  const townSites: TownSite[] = [];
  const field = new Battlefield(config, heights, baseSites, townSites, []);

  const flatten = (cx: number, cz: number, radius: number, height: number) => {
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const d = D.hypot(field.vertexX(i) - cx, field.vertexZ(j) - cz);
        const t = 1 - smoothstep(radius * 0.8, radius * 1.35, d);
        if (t <= 0) continue;
        const k = j * (cols + 1) + i;
        heights[k] = heights[k] * (1 - t) + height * t;
      }
    }
  };

  // Flatten each base pad, keeping it safely above water.
  for (const site of baseSites) {
    site.height = Math.max(seaLevel + 1.2, field.heightAt(site.x, site.z));
    flatten(site.x, site.z, site.radius, site.height);
  }

  // Water joined up between the bases (on their own random stream, so dry maps don't change), then
  // bridges wherever that, or the lakes themselves, cut the land.
  if (config.waterways !== 'off') bridgeChannels(field, carveWaterways(field, { everyBase: config.waterways === 'everyBase' }));
  bridgeLand(field);

  // A civilian town in no-man's land: pick the gentlest dry spot near the middle.
  const townRadius = config.townRadius;
  const townSpot = (x: number, z: number, townRadius = config.townRadius) => {
    let score = 0;
    for (let a = 0; a < 8; a++) {
      const px = x + D.cos((a / 8) * Math.PI * 2) * townRadius * 0.7;
      const pz = z + D.sin((a / 8) * Math.PI * 2) * townRadius * 0.7;
      score += field.slopeAt(px, pz) + (field.isWater(px, pz) ? 3 : 0) + (field.deckAt(px, pz) !== null ? 50 : 0);
    }
    // Levelling the town's ground would bury a bridge's end.
    if (field.nearBridge(x, z, townRadius * 1.35)) score += 50;
    // With bases along the long edges too, keep the town off their pads.
    for (const site of baseSites) if (D.hypot(site.x - x, site.z - z) < site.radius + townRadius + 4) score += 100;
    return score;
  };
  let best: { x: number; z: number; score: number } | null = null;
  for (let n = 0; n < 40; n++) {
    const x = rng.range(-width * 0.16, width * 0.16);
    const z = rng.range(-depth / 2 + townRadius + 2, depth / 2 - townRadius - 2);
    const score = townSpot(x, z);
    if (!best || score < best.score) best = { x, z, score };
  }
  // Candidates are always rolled so the rest of the map doesn't change with the number of towns.
  const townRng = rng.fork(0x746f776e);
  // A spot given as fractions of the half-width and half-depth, kept far enough in for a pad of this radius.
  const placedAt = (p: { x: number; z: number }, radius: number) => {
    const inside = (v: number, half: number) => Math.max(-(half - radius - 2), Math.min(half - radius - 2, v * half));
    return { x: inside(p.x, width / 2), z: inside(p.z, depth / 2) };
  };
  // A city instead of the first town: as near the middle as it can be, as big as fits between the
  // bases (longer one way if need be), on its own stream so maps without one don't change.
  const cityRng = rng.fork(0x63697479);
  let city: { x: number; z: number; rx: number; rz: number } | null = null;
  if (config.cityRadius > 0 && config.towns > 0) {
    const first = config.townPlaces?.[0];
    let best: { x: number; z: number; rx: number; rz: number; score: number } | null = null;
    for (let n = 0; n < (first ? 1 : 60); n++) {
      // The middle first, then a line down the middle, then anywhere near it.
      const line = [0, 0.1, -0.1, 0.2, -0.2];
      const at = first
        ? placedAt(first, 10)
        : n < line.length
          ? { x: 0, z: line[n] * depth }
          : { x: cityRng.range(-width * 0.2, width * 0.2), z: cityRng.range(-depth * 0.3, depth * 0.3) };
      const size = citySize(at.x, at.z, config.cityRadius, width, depth, baseSites);
      if (!size) continue;
      const r = Math.sqrt(size.rx * size.rz);
      // Big, flat, dry and central; clear of bridges, which levelling would bury.
      const score = townSpot(at.x, at.z, r) - r * 1.5 + (Math.abs(at.z) / (depth / 2)) * 30 + (Math.abs(at.x) / (width / 2)) * 30;
      if (!best || score < best.score) best = { ...at, ...size, score };
    }
    if (best && best.score < 50) city = best;
  }
  if (city) {
    const at = snapToCell(city.x, city.z, field.bounds.minX, field.bounds.minZ);
    const height = Math.max(seaLevel + 1, field.heightAt(at.x, at.z));
    const plan = planCity(at.x, at.z, city.rx, city.rz, cityRng.fork(0x706c616e));
    // The main avenue (where roads join) runs the long way.
    townSites.push({ ...at, radius: Math.max(city.rx, city.rz), height, angle: city.rz > city.rx ? Math.PI / 2 : 0, city: plan });
    // Level right out to the edge (towns only level most of the way): lots sit square on the ground.
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const dx = Math.max(0, Math.abs(field.vertexX(i) - at.x) - city.rx);
        const dz = Math.max(0, Math.abs(field.vertexZ(j) - at.z) - city.rz);
        const t = 1 - smoothstep(1.5, 8, D.hypot(dx, dz));
        if (t <= 0) continue;
        const k = j * (cols + 1) + i;
        heights[k] = heights[k] * (1 - t) + height * t;
      }
    }
    carvePonds(field, plan);
  }
  if (config.townPlaces) {
    for (const p of config.townPlaces.slice(city ? 1 : 0)) {
      const at = placedAt(p, townRadius);
      const height = Math.max(seaLevel + 1, field.heightAt(at.x, at.z));
      townSites.push({ ...at, radius: townRadius, height, angle: townRng.range(0, Math.PI / 2) });
      flatten(at.x, at.z, townRadius, height);
    }
  } else if (city) {
    // The city took the first town's place.
  } else if (best && config.towns > 0) {
    const height = Math.max(seaLevel + 1, field.heightAt(best.x, best.z));
    townSites.push({ x: best.x, z: best.z, radius: townRadius, height, angle: townRng.range(0, Math.PI / 2) });
    flatten(best.x, best.z, townRadius, height);
  }
  // More towns, on their own stream: spread over no-man's land, away from the bases and each other.
  for (let t = 1; t < (config.townPlaces ? 0 : config.towns); t++) {
    let pick: { x: number; z: number; score: number } | null = null;
    for (let n = 0; n < 60; n++) {
      const x = townRng.range(-width / 2 + townRadius + 3, width / 2 - townRadius - 3);
      const z = townRng.range(-depth / 2 + townRadius + 3, depth / 2 - townRadius - 3);
      // (A city's corners reach a fifth further out than its radius.)
      const gap = townSites.reduce((m, s) => Math.min(m, D.hypot(s.x - x, s.z - z) - s.radius * (s.city ? 1.2 : 1) - townRadius), Infinity);
      if (gap < 6) continue;
      // Contested ground: about as far from the nearest base as the next.
      const near = baseSites.map((b) => D.hypot(b.x - x, b.z - z)).sort((a, b) => a - b);
      const contest = near.length > 1 ? (near[1] - near[0]) / (near[0] + 1) : 0;
      const score = townSpot(x, z) * 2 + contest * 20 - Math.min(gap, 40) * 0.3;
      if (!pick || score < pick.score) pick = { x, z, score };
    }
    if (!pick || pick.score >= 50) break;
    const height = Math.max(seaLevel + 1, field.heightAt(pick.x, pick.z));
    townSites.push({ x: pick.x, z: pick.z, radius: townRadius, height, angle: townRng.range(0, Math.PI / 2) });
    flatten(pick.x, pick.z, townRadius, height);
  }
  // Or a city over the whole map: blocks wherever the ground is dry and gentle enough, round the
  // bases and bridges, each block levelled (so hills become terraces, avenues ramping between them).
  if (config.citySprawl) {
    const at = snapToCell(0, 0, field.bounds.minX, field.bounds.minZ);
    const keep = (x: number, z: number) => {
      if (!field.contains(x, z, 2) || field.nearBridge(x, z, 3) || field.slopeAt(x, z) > SPRAWL_SLOPE) return false;
      for (const [dx, dz] of [[0, 0], [1.5, 1.5], [-1.5, 1.5], [1.5, -1.5], [-1.5, -1.5]]) if (field.heightAt(x + dx, z + dz) < seaLevel + 0.3) return false;
      return baseSites.every((b) => D.hypot(b.x - x, b.z - z) > b.radius + 6);
    };
    const plan = planCity(at.x, at.z, width / 2 - 3, depth / 2 - 3, cityRng.fork(0x7370726c), { keep, centralToEdge: false });
    townSites.push({ ...at, radius: Math.max(width, depth) / 2, height: field.heightAt(at.x, at.z), angle: 0, city: plan });
    levelBlocks(field, plan);
    carvePonds(field, plan);
  }

  // Each town's main street is paved (a city's avenues and alleys), and roads join the towns.
  for (const t of townSites) {
    if (t.city) {
      for (const a of t.city.avenues) field.addRoad(a.points, a.width, 'street', a.widths);
      for (const a of t.city.alleys) field.addRoad(a.points, a.width, 'alley');
      // The square is paved right across (as road ground: a strip that wide would round off its corners over the lots round it).
      const sq = t.city.square;
      const paved: number[] = [];
      for (let z = sq.z - sq.hz + CITY_CELL / 2; z < sq.z + sq.hz; z += CITY_CELL) {
        for (let x = sq.x - sq.hx + CITY_CELL / 2; x < sq.x + sq.hx; x += CITY_CELL) {
          const [i, j] = field.cellAt(x, z);
          if (!field.isWater(x, z)) paved.push(j * cols + i);
        }
      }
      field.setGround(paved, 'road');
      continue;
    }
    const ux = D.cos(t.angle) * t.radius;
    const uz = D.sin(t.angle) * t.radius;
    field.addRoad([{ x: t.x - ux, z: t.z - uz }, { x: t.x + ux, z: t.z + uz }], STREET_WIDTH, 'street');
  }
  connectTowns(field);

  // Outposts come last, so a map with none is the same map as before outposts existed.
  // A city's square takes the first outpost: holding the middle of the city.
  const square = townSites.find((t) => t.city)?.city?.square;
  const spots = config.outpostPlaces
    ? config.outpostPlaces.map((p) => placedAt(p, OUTPOST_RADIUS))
    : square && config.outposts > 0
      ? [{ x: square.x, z: square.z }, ...placeOutposts(field, rng, config.outposts - 1, [{ x: square.x, z: square.z, r: OUTPOST_RADIUS }])]
      : placeOutposts(field, rng, config.outposts);
  const kinds = dealOutpostKinds(spots, config.outpostKinds, rng.fork(0x6b696e64), (p) => field.heightAt(p.x, p.z));
  spots.forEach((p, k) => {
    const height = Math.max(seaLevel + 1, field.heightAt(p.x, p.z));
    field.outpostSites.push({ index: field.outpostSites.length, kind: kinds[k], x: p.x, z: p.z, radius: OUTPOST_RADIUS, height });
    flatten(p.x, p.z, OUTPOST_RADIUS, height);
  });
  // Levelling towns and outposts may have raised ground by a bridge: cut it back.
  for (const b of field.bridges) cutBanks(field, b);
  // Dense forest last, on its own random stream, round everything else.
  growWoods(field, rng.fork(0x776f6f64), config.forest);
  // Cities' parks get their trees.
  for (const t of townSites) if (t.city) plantParks(field, t.city, rng.fork(0x7061726b));
  field.markMade();

  return field;
}

/**
 * How far a city centred at (x, z) can reach along x and z: up to `most`
 * each way, inside the map, and clear of every base pad by CITY_GAP (on one
 * axis or the other, whichever leaves the bigger city). Null if it would be
 * smaller than CITY_LEAST either way, or more than twice as long as wide.
 */
function citySize(x: number, z: number, most: number, width: number, depth: number, bases: BaseSite[]): { rx: number; rz: number } | null {
  let rx = Math.min(most, width / 2 - Math.abs(x) - 4);
  let rz = Math.min(most, depth / 2 - Math.abs(z) - 4);
  for (const b of bases) {
    const gx = Math.abs(b.x - x) - b.radius - CITY_GAP;
    const gz = Math.abs(b.z - z) - b.radius - CITY_GAP;
    if (rx <= gx || rz <= gz) continue;
    // Pull in whichever side keeps more of the city.
    if (Math.max(gx, 0) * rz >= rx * Math.max(gz, 0)) rx = gx;
    else rz = gz;
  }
  if (rx < CITY_LEAST || rz < CITY_LEAST) return null;
  // Not too long and thin.
  rx = Math.min(rx, rz * 2);
  rz = Math.min(rz, rx * 2);
  return { rx, rz };
}

/** Steepest ground a sprawling city puts a lot on. */
const SPRAWL_SLOPE = 0.7;
/** How far past a levelled block the ground eases back to what it was. */
const BLOCK_EASE = 2.2;
/** A pond's water depth, and how wide its banks are. */
const POND_DEPTH = 0.7;
const POND_BANK = 2;
/** A block higher than this above the sea is a park instead of a pond (it would be a pit). */
const POND_HIGHEST = 2.5;

/** The ground each block of a city covers (its lots, and the alleys between them), as rectangles. */
function cityBlocks(plan: CityPlan): { x0: number; z0: number; x1: number; z1: number }[] {
  const blocks = new Map<string, { x0: number; z0: number; x1: number; z1: number }>();
  const h = CITY_CELL;
  for (const l of plan.lots) {
    const key = `${l.bi},${l.bj}`;
    const b = blocks.get(key);
    if (!b) blocks.set(key, { x0: l.x - h, x1: l.x + h, z0: l.z - h, z1: l.z + h });
    else {
      b.x0 = Math.min(b.x0, l.x - h);
      b.x1 = Math.max(b.x1, l.x + h);
      b.z0 = Math.min(b.z0, l.z - h);
      b.z1 = Math.max(b.z1, l.z + h);
    }
  }
  return [...blocks.values()];
}

/** Level each block of a city to its average height, easing back to the ground round it (a sprawling city on hills). */
function levelBlocks(field: Battlefield, plan: CityPlan): void {
  const { cols, rows } = field.config;
  const heights = field.heights;
  for (const b of cityBlocks(plan)) {
    let sum = 0;
    let n = 0;
    for (let j = 0; j <= rows; j++) {
      const z = field.vertexZ(j);
      if (z < b.z0 || z > b.z1) continue;
      for (let i = 0; i <= cols; i++) {
        const x = field.vertexX(i);
        if (x < b.x0 || x > b.x1) continue;
        sum += heights[j * (cols + 1) + i];
        n++;
      }
    }
    if (n === 0) continue;
    const level = Math.max(field.seaLevel + 0.4, sum / n);
    for (let j = 0; j <= rows; j++) {
      const dz = Math.max(0, b.z0 - field.vertexZ(j), field.vertexZ(j) - b.z1);
      if (dz > BLOCK_EASE) continue;
      for (let i = 0; i <= cols; i++) {
        const dx = Math.max(0, b.x0 - field.vertexX(i), field.vertexX(i) - b.x1);
        const t = 1 - smoothstep(0, BLOCK_EASE, D.hypot(dx, dz));
        if (t <= 0) continue;
        const k = j * (cols + 1) + i;
        heights[k] = heights[k] * (1 - t) + level * t;
      }
    }
  }
}

/** Dig a city's ponds: water below sea level, with banks easing down from the street. */
function carvePonds(field: Battlefield, plan: CityPlan): void {
  const { cols, rows } = field.config;
  const heights = field.heights;
  const floor = field.seaLevel - POND_DEPTH;
  for (const f of plan.features) {
    if (f.kind !== 'pond') continue;
    if (field.heightAt((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2) > field.seaLevel + POND_HIGHEST) {
      f.kind = 'park';
      for (const l of plan.lots) if (l.use === 'pond' && l.x > f.x0 && l.x < f.x1 && l.z > f.z0 && l.z < f.z1) l.use = 'park';
      continue;
    }
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const x = field.vertexX(i);
        const z = field.vertexZ(j);
        // How far inside the pond's edge (a little in from its block's edge), negative outside.
        const d = Math.min(x - f.x0, f.x1 - x, z - f.z0, f.z1 - z) - 0.4;
        if (d <= 0) continue;
        const k = j * (cols + 1) + i;
        const t = smoothstep(0, POND_BANK, d);
        heights[k] = heights[k] * (1 - t) + Math.min(heights[k], floor) * t;
      }
    }
  }
}

/** Trees in a city's parks: clumps of dense forest that infantry hide in, with open lawns between. */
function plantParks(field: Battlefield, plan: CityPlan, rng: Rng): void {
  const { cols, cellSize } = field.config;
  const cells: number[] = [];
  for (const f of plan.features) {
    if (f.kind !== 'park') continue;
    let first = true;
    for (let z = f.z0 + cellSize / 2; z < f.z1; z += cellSize) {
      for (let x = f.x0 + cellSize / 2; x < f.x1; x += cellSize) {
        // (Every park gets a tree or two, even a lone lot's.)
        const plant = first || rng.chance(0.55);
        first = false;
        if (!plant || field.isWater(x, z)) continue;
        const [i, j] = field.cellAt(x, z);
        if (field.roadCell[j * cols + i]) continue;
        cells.push(j * cols + i);
        const n = rng.chance(0.5) ? 1 : 2;
        for (let k = 0; k < n; k++) field.woods.add(x + rng.range(-0.4, 0.4), z + rng.range(-0.4, 0.4), rng.range(0.8, 1.15));
      }
    }
  }
  field.setGround(cells, 'thicket');
}

/** Ground kept between a city's edge and a base pad, and the least a city reaches from its middle. */
const CITY_GAP = 7;
const CITY_LEAST = 10;

/**
 * Which kind each outpost is: the allowed kinds in a shuffled order (cycling
 * if there are more outposts than kinds), except that a hilltop gun, if
 * dealt, goes to the highest site.
 */
function dealOutpostKinds<P>(sites: P[], allowed: OutpostKind[], rng: Rng, height: (p: P) => number): OutpostKind[] {
  if (sites.length === 0) return [];
  const pool = allowed.length > 0 ? [...allowed] : ['supply' as OutpostKind];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const dealt = sites.map((_, k) => pool[k % pool.length]);
  const gun = dealt.indexOf('gun');
  if (gun >= 0) {
    let top = 0;
    sites.forEach((p, k) => {
      if (height(p) > height(sites[top])) top = k;
    });
    [dealt[gun], dealt[top]] = [dealt[top], dealt[gun]];
  }
  return dealt;
}

/**
 * Where outposts go: contested ground (about as far from the nearest base as
 * from the next nearest, so no side gets one for free), flat and dry, on land
 * the bases can walk to, and spread out from the town and each other. Picked
 * greedily, best spot first, from random candidates.
 */
function placeOutposts(field: Battlefield, rng: Rng, count: number, taken: { x: number; z: number; r: number }[] = []): { x: number; z: number }[] {
  if (count <= 0) return [];
  // Land the bases can reach (over bridges too).
  const reach = landReach(field);
  const index = (x: number, z: number) => vertexAt(field, x, z);
  const r = OUTPOST_RADIUS;
  const candidates: { x: number; z: number; flat: number; contest: number }[] = [];
  for (let n = 0; n < 300; n++) {
    const x = rng.range(field.bounds.minX + r + 4, field.bounds.maxX - r - 4);
    const z = rng.range(field.bounds.minZ + r + 4, field.bounds.maxZ - r - 4);
    if (!reach[index(x, z)] || field.nearBridge(x, z, r * 1.35)) continue;
    const near = field.baseSites.map((b) => D.hypot(b.x - x, b.z - z) - b.radius).sort((a, b) => a - b);
    if (near[0] < r + 8) continue;
    let flat = 0;
    for (let a = 0; a < 8; a++) {
      const px = x + D.cos((a / 8) * Math.PI * 2) * r * 0.8;
      const pz = z + D.sin((a / 8) * Math.PI * 2) * r * 0.8;
      flat += field.slopeAt(px, pz) + (field.isWater(px, pz) ? 3 : 0);
    }
    // 0 when exactly between two bases, growing as one base gets the closer claim.
    const contest = near.length > 1 ? (near[1] - near[0]) / (near[0] + 1) : 0;
    candidates.push({ x, z, flat, contest });
  }

  // The town's edge counts as close as it can get: an outpost by a town is fine, two outposts together aren't.
  // (A city covering the map leaves room anywhere: its square is in `taken`, and other outposts clear lots.)
  const towns = field.config.citySprawl ? [] : field.townSites;
  const placed: { x: number; z: number; r: number }[] = [...towns.map((t) => ({ x: t.x, z: t.z, r: t.radius - 6 })), ...taken];
  const out: { x: number; z: number }[] = [];
  const cap = Math.max(field.width, field.depth) * 0.5;
  for (let k = 0; k < count; k++) {
    let best: (typeof candidates)[number] | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const gap = placed.reduce((m, p) => Math.min(m, D.hypot(p.x - c.x, p.z - c.z) - p.r - r), cap);
      if (gap < 6) continue;
      // As far from the town and other outposts as possible (so they spread over the
      // map), on contested ground, and flat.
      // One side's backyard is a last resort.
      const score = gap * (1 - Math.min(c.contest, 0.9)) - c.flat * 4 - (c.contest > 0.4 ? 1000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    placed.push({ x: best.x, z: best.z, r });
    out.push({ x: best.x, z: best.z });
  }
  return out;
}
