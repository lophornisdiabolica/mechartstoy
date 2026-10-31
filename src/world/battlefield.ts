import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';

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
  /** Put a civilian town in no-man's land. */
  town: boolean;
}

export const DEFAULT_BATTLEFIELD: BattlefieldConfig = {
  cols: 84,
  rows: 64,
  cellSize: 1.5,
  maxHeight: 9,
  seaLevel: 1.4,
  baseRadius: 16,
  town: true,
};

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
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class Battlefield {
  readonly width: number;
  readonly depth: number;
  readonly bounds: Bounds;

  constructor(
    readonly config: BattlefieldConfig,
    /** Vertex heights, (cols + 1) * (rows + 1), row-major along x. */
    readonly heights: Float32Array,
    readonly baseSites: BaseSite[],
    readonly townSites: TownSite[] = [],
  ) {
    this.width = config.cols * config.cellSize;
    this.depth = config.rows * config.cellSize;
    this.bounds = {
      minX: -this.width / 2,
      maxX: this.width / 2,
      minZ: -this.depth / 2,
      maxZ: this.depth / 2,
    };
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

  /** Height a unit should stand at: ground, or the water surface for anything over water. */
  surfaceAt(x: number, z: number): number {
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

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * With lots of water a base can end up on an island. If the bases aren't
 * joined by dry land, raise a causeway straight between them.
 */
function ensureLandBridge(field: Battlefield, heights: Float32Array): void {
  const { cols, rows, cellSize } = field.config;
  const [a, b] = field.baseSites;
  const index = (x: number, z: number) => {
    const i = Math.round((x - field.bounds.minX) / cellSize);
    const j = Math.round((z - field.bounds.minZ) / cellSize);
    return j * (cols + 1) + i;
  };
  const dry = (k: number) => heights[k] >= field.seaLevel;
  const start = index(a.x, a.z);
  const goal = index(b.x, b.z);
  const seen = new Uint8Array(heights.length);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (k === goal) return;
    const i = k % (cols + 1);
    const j = (k - i) / (cols + 1);
    for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (ni < 0 || nj < 0 || ni > cols || nj > rows) continue;
      const nk = nj * (cols + 1) + ni;
      if (!seen[nk] && dry(nk)) {
        seen[nk] = 1;
        stack.push(nk);
      }
    }
  }
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const deck = field.seaLevel + 0.5;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const px = field.vertexX(i);
      const pz = field.vertexZ(j);
      // Distance from the segment between the two bases.
      const t = Math.max(0, Math.min(1, ((px - a.x) * (b.x - a.x) + (pz - a.z) * (b.z - a.z)) / (length * length)));
      const d = Math.hypot(px - (a.x + (b.x - a.x) * t), pz - (a.z + (b.z - a.z) * t));
      const w = 1 - smoothstep(3, 6, d);
      const k = j * (cols + 1) + i;
      if (w > 0 && heights[k] < deck) heights[k] = heights[k] * (1 - w) + deck * w;
    }
  }
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

  // Base pads sit near each short end, at a random offset across the map.
  const baseSites: BaseSite[] = [0, 1].map((faction) => ({
    faction,
    x: (faction === 0 ? -1 : 1) * (width / 2 - baseRadius - 6),
    z: rng.range(-depth * 0.2, depth * 0.2),
    radius: baseRadius,
    height: 0,
  }));

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
  const field = new Battlefield(config, heights, baseSites, townSites);

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

  ensureLandBridge(field, heights);

  // A civilian town in no-man's land: pick the gentlest dry spot near the middle.
  const townRadius = 11;
  let best: { x: number; z: number; score: number } | null = null;
  for (let n = 0; n < 40; n++) {
    const x = rng.range(-width * 0.16, width * 0.16);
    const z = rng.range(-depth / 2 + townRadius + 2, depth / 2 - townRadius - 2);
    let score = 0;
    for (let a = 0; a < 8; a++) {
      const px = x + Math.cos((a / 8) * Math.PI * 2) * townRadius * 0.7;
      const pz = z + Math.sin((a / 8) * Math.PI * 2) * townRadius * 0.7;
      score += field.slopeAt(px, pz) + (field.isWater(px, pz) ? 3 : 0);
    }
    if (!best || score < best.score) best = { x, z, score };
  }
  // Candidates are always rolled so the rest of the map doesn't change with the town toggle.
  if (best && config.town) {
    const height = Math.max(seaLevel + 1, field.heightAt(best.x, best.z));
    townSites.push({ x: best.x, z: best.z, radius: townRadius, height });
    flatten(best.x, best.z, townRadius, height);
  }

  return field;
}
