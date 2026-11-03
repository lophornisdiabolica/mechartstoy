import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import { BiomeId } from './biomes';
import { CellArea, GROUND_DEFS, GROUND_IDS, GroundDef, GroundId, groundCode } from './ground';
import { connectTowns } from './roads';
import { growWoods, Woods } from './woods';
import { bridgeChannels, bridgeLand, carveWaterways, cutBanks, landReach, vertexAt } from './waterways';

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
  /**
   * Base positions per seat as fractions of the half-width and half-depth
   * (-1 to 1), or null to place them round the map's edge (see seatPoint).
   */
  places: { x: number; z: number }[] | null;
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
  places: null,
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
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: rx * Math.sign(c) * Math.sqrt(Math.abs(c)), z: rz * Math.sign(s) * Math.sqrt(Math.abs(s)) };
}

/** Whether `n` bases fit on a map this size with room between neighbours (jitter included). */
export function seatsFit(n: number, width: number, depth: number, baseRadius: number): boolean {
  for (let k = 0; k < n; k++) {
    for (const [ja, jb] of [[1, -1], [0, 0]]) {
      const a = seatPoint(k, n, width, depth, baseRadius, ja);
      const b = seatPoint((k + 1) % n, n, width, depth, baseRadius, jb);
      if (n > 1 && Math.hypot(a.x - b.x, a.z - b.z) < baseRadius * 2 + BASE_GAP) return false;
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
}

/** Room under a bridge deck, above the water. */
export const BRIDGE_CLEARANCE = 1.3;
/** Steepest a bridge's ramps get (rise over run). */
export const DECK_GRADE = 0.35;

/**
 * A paved road: a strip of road ground along a line of points (see
 * Battlefield.addRoad). Kept as a line, not just as cells, so it can be
 * drawn as a smooth strip rather than a staircase of cells.
 */
export interface Road {
  points: { x: number; z: number }[];
  width: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
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
  /** Dense forest's trees (see woods.ts). */
  readonly woods: Woods;
  /** Per cell: 1 where a road (see addRoad) covers it, so the terrain leaves its colour to the road strip. */
  readonly roadCell: Uint8Array;
  /** Per cell: the index of the bridge over it, or -1. */
  private readonly bridgeCell: Int16Array;
  private readonly listeners: MapChangeListener[] = [];
  /** Bumps on every change, for anything that caches what the map looked like. */
  version = 0;

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
        if (this.ground[k] === code || Math.hypot(cx - x, cz - z) > radius) continue;
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
        const d = Math.hypot(this.vertexX(i) - x, this.vertexZ(j) - z);
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

  /** Put a bridge on the map (see waterways.ts placeBridge, which picks its ends and level and cuts the banks to fit). */
  addBridge(bridge: Bridge): void {
    const index = this.bridges.length;
    this.bridges.push(bridge);
    const { cols, cellSize } = this.config;
    const pad = bridge.width / 2;
    const area = this.areaAround((bridge.ax + bridge.bx) / 2, (bridge.az + bridge.bz) / 2, Math.hypot(bridge.bx - bridge.ax, bridge.bz - bridge.az) / 2 + pad);
    for (let j = area.j0; j <= area.j1; j++) {
      for (let i = area.i0; i <= area.i1; i++) {
        const cx = this.bounds.minX + (i + 0.5) * cellSize;
        const cz = this.bounds.minZ + (j + 0.5) * cellSize;
        if (this.deckOf(bridge, cx, cz) !== null) this.bridgeCell[j * cols + i] = index;
      }
    }
    this.changed(area);
  }

  /** A bridge's deck height at a point, or null if the point isn't on it. */
  private deckOf(b: Bridge, x: number, z: number): number | null {
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const length = Math.hypot(dx, dz);
    const t = ((x - b.ax) * dx + (z - b.az) * dz) / (length * length);
    if (t < 0 || t > 1) return null;
    const off = Math.abs((x - b.ax) * dz - (z - b.az) * dx) / length;
    if (off > b.width / 2) return null;
    // Level in the middle, ramping down to meet the ground at each end (wherever it is now).
    const ha = this.heightAt(b.ax, b.az);
    const hb = this.heightAt(b.bx, b.bz);
    return Math.min(b.level, ha + DECK_GRADE * t * length, hb + DECK_GRADE * (1 - t) * length);
  }

  /** Whether a point is on or within `margin` of a bridge (buildings keep off them). */
  nearBridge(x: number, z: number, margin = 0): boolean {
    return this.bridges.some((b) => distanceToSegment(x, z, b.ax, b.az, b.bx, b.bz) < b.width / 2 + margin);
  }

  /**
   * Pave a road along a line of points: road ground on every dry cell within
   * half the width of the line (not on bridges, which are paved already).
   * Works mid-battle too, like paint.
   */
  addRoad(points: { x: number; z: number }[], width: number): void {
    if (points.length < 2) return;
    this.roads.push({ points, width });
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
        let d = Infinity;
        for (let k = 1; k < points.length; k++) d = Math.min(d, distanceToSegment(cx, cz, points[k - 1].x, points[k - 1].z, points[k].x, points[k].z));
        if (d > width / 2 || this.isWater(cx, cz) || this.deckAt(cx, cz) !== null) continue;
        this.ground[j * cols + i] = code;
        this.roadCell[j * cols + i] = 1;
      }
    }
    this.changed({ i0, j0, i1, j1 });
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
    return Math.hypot(dx, dz) / (2 * d);
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
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
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
    const at = place ? { x: (place.x * width) / 2, z: (place.z * depth) / 2 } : seatPoint(k, seats.length, width, depth, baseRadius, nudge);
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
      let h = Math.pow(rolling, 1.5) * maxHeight * 0.75 + Math.pow(ridge, 4) * maxHeight * 0.35;
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
        const d = Math.hypot(field.vertexX(i) - cx, field.vertexZ(j) - cz);
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
  const townSpot = (x: number, z: number) => {
    let score = 0;
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * townRadius * 0.7;
      const pz = z + Math.sin((a / 8) * Math.PI * 2) * townRadius * 0.7;
      score += field.slopeAt(px, pz) + (field.isWater(px, pz) ? 3 : 0) + (field.deckAt(px, pz) !== null ? 50 : 0);
    }
    // Levelling the town's ground would bury a bridge's end.
    if (field.nearBridge(x, z, townRadius * 1.35)) score += 50;
    // With bases along the long edges too, keep the town off their pads.
    for (const site of baseSites) if (Math.hypot(site.x - x, site.z - z) < site.radius + townRadius + 4) score += 100;
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
  if (best && config.towns > 0) {
    const height = Math.max(seaLevel + 1, field.heightAt(best.x, best.z));
    townSites.push({ x: best.x, z: best.z, radius: townRadius, height, angle: townRng.range(0, Math.PI / 2) });
    flatten(best.x, best.z, townRadius, height);
  }
  // More towns, on their own stream: spread over no-man's land, away from the bases and each other.
  for (let t = 1; t < config.towns; t++) {
    let pick: { x: number; z: number; score: number } | null = null;
    for (let n = 0; n < 60; n++) {
      const x = townRng.range(-width / 2 + townRadius + 3, width / 2 - townRadius - 3);
      const z = townRng.range(-depth / 2 + townRadius + 3, depth / 2 - townRadius - 3);
      const gap = townSites.reduce((m, s) => Math.min(m, Math.hypot(s.x - x, s.z - z) - s.radius - townRadius), Infinity);
      if (gap < 6) continue;
      // Contested ground: about as far from the nearest base as the next.
      const near = baseSites.map((b) => Math.hypot(b.x - x, b.z - z)).sort((a, b) => a - b);
      const contest = near.length > 1 ? (near[1] - near[0]) / (near[0] + 1) : 0;
      const score = townSpot(x, z) * 2 + contest * 20 - Math.min(gap, 40) * 0.3;
      if (!pick || score < pick.score) pick = { x, z, score };
    }
    if (!pick || pick.score >= 50) break;
    const height = Math.max(seaLevel + 1, field.heightAt(pick.x, pick.z));
    townSites.push({ x: pick.x, z: pick.z, radius: townRadius, height, angle: townRng.range(0, Math.PI / 2) });
    flatten(pick.x, pick.z, townRadius, height);
  }
  // Each town's main street is paved, and roads join the towns.
  for (const t of townSites) {
    const ux = Math.cos(t.angle) * t.radius;
    const uz = Math.sin(t.angle) * t.radius;
    field.addRoad([{ x: t.x - ux, z: t.z - uz }, { x: t.x + ux, z: t.z + uz }], STREET_WIDTH);
  }
  connectTowns(field);

  // Outposts come last, so a map with none is the same map as before outposts existed.
  const spots = placeOutposts(field, rng, config.outposts);
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

  return field;
}

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
function placeOutposts(field: Battlefield, rng: Rng, count: number): { x: number; z: number }[] {
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
    const near = field.baseSites.map((b) => Math.hypot(b.x - x, b.z - z) - b.radius).sort((a, b) => a - b);
    if (near[0] < r + 8) continue;
    let flat = 0;
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * r * 0.8;
      const pz = z + Math.sin((a / 8) * Math.PI * 2) * r * 0.8;
      flat += field.slopeAt(px, pz) + (field.isWater(px, pz) ? 3 : 0);
    }
    // 0 when exactly between two bases, growing as one base gets the closer claim.
    const contest = near.length > 1 ? (near[1] - near[0]) / (near[0] + 1) : 0;
    candidates.push({ x, z, flat, contest });
  }

  // The town's edge counts as close as it can get: an outpost by a town is fine, two outposts together aren't.
  const placed: { x: number; z: number; r: number }[] = field.townSites.map((t) => ({ x: t.x, z: t.z, r: t.radius - 6 }));
  const out: { x: number; z: number }[] = [];
  const cap = Math.max(field.width, field.depth) * 0.5;
  for (let k = 0; k < count; k++) {
    let best: (typeof candidates)[number] | null = null;
    let bestScore = -Infinity;
    for (const c of candidates) {
      const gap = placed.reduce((m, p) => Math.min(m, Math.hypot(p.x - c.x, p.z - c.z) - p.r - r), cap);
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
