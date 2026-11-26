import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import type { Battlefield } from './battlefield';
import { CLIFF_SLOPE } from './moveClasses';
import * as D from '../core/dmath';

/**
 * High ground: mountains and mesas, raised on the rolling terrain before
 * the base pads are levelled (see generateBattlefield).
 *
 * - Mountains are tall massifs, up to about twice the usual hills' height,
 *   with ridged flanks: most of the way up is steep going, and the crags
 *   near the top are sheer, so only spiders and aircraft reach the peaks.
 *   Their slopes block shots and sight like any hill.
 * - Mesas are flat-topped tables with sheer sides all round but for a ramp
 *   or two: high ground that guns can hold and armies have to reach the
 *   long way round, by the ramps.
 *
 * Sheer means steeper than CLIFF_SLOPE, a wall to everything on the ground
 * but spiders (see Battlefield.cliffs). Each feature is kept clear of the
 * base pads, and taken back off the map again if it would leave a base cut
 * off from the rest (or a mesa's top out of reach), counting only ways wide
 * enough for a super unit; water counts as passable, since the bridges that
 * keep bases joined over it come later (see bridgeLand).
 */

/** Map area (in cells) the amounts are counted per: a Medium map's. */
const PER_AREA = 84 * 64;
/** Mountains and mesas per PER_AREA at the settings' top value of 1. */
const MOUNTAINS_PER_AREA = 3;
const MESAS_PER_AREA = 6;
/** Places tried for each feature before giving up on it. */
const TRIES = 40;
/** A raise counts a cell as high ground where it lifted one of the cell's corners more than this. */
const RAISED = 0.25;
/** Height the mountains' peaks are measured in: the usual hills' top height (DEFAULT_BATTLEFIELD.maxHeight). */
const HILL_HEIGHT = 9;
/** A mesa's sides: how far out a sheer edge falls (about a cell), and how gently a ramp climbs (rise over run, at its steepest). */
const CLIFF_FALL = 1;
const RAMP_GRADE = 0.6;
/** Half the width of a mesa's ramp where it leaves the top (world units), and the angle over which it steepens back into cliff on either side. */
const RAMP_HALF_WIDTH = 5;
const RAMP_SHOULDER = 0.3;
/** Room kept between a feature and a base pad, past the pad's levelling, and between two features. */
const PAD_GAP = 2;
const FEATURE_GAP = 3;

interface Feature {
  x: number;
  z: number;
  /** How far out its body reaches (ramps and foothills aside), for spacing. */
  core: number;
}

/** A feature planned at a spot: its size, and how to raise it (returning the points that must stay reachable). */
interface Plan {
  core: number;
  /** Furthest out it changes the ground. */
  reach: number;
  raise: () => { x: number; z: number }[];
}

/** Raise mountains and mesas as the map's settings ask (see BattlefieldConfig.mountains and cliffs). Returns how many it raised. */
export function raiseHighground(field: Battlefield, rng: Rng): number {
  const { cols, rows, mountains, cliffs } = field.config;
  const area = (cols * rows) / PER_AREA;
  const count = (amount: number, per: number) => (amount <= 0 ? 0 : Math.max(1, Math.round(amount * per * area)));
  const noise = createNoise2D(() => rng.next());
  const ways = new Ways(field);
  const placed: Feature[] = [];
  let raised = 0;
  for (let n = count(mountains, MOUNTAINS_PER_AREA); n > 0; n--) if (place(field, rng, ways, placed, (x, z) => planMountain(field, rng, noise, x, z))) raised++;
  for (let n = count(cliffs, MESAS_PER_AREA); n > 0; n--) if (place(field, rng, ways, placed, (x, z) => planMesa(field, rng, noise, x, z))) raised++;
  return raised;
}

/** Try a feature at random spots until one fits and leaves the map passable. */
function place(field: Battlefield, rng: Rng, ways: Ways, placed: Feature[], plan: (x: number, z: number) => Plan | null): boolean {
  const { width, depth } = field;
  for (let t = 0; t < TRIES; t++) {
    const x = rng.range(-width * 0.46, width * 0.46);
    const z = rng.range(-depth * 0.46, depth * 0.46);
    const p = plan(x, z);
    if (!p) continue;
    if (!field.baseSites.every((b) => D.hypot(b.x - x, b.z - z) > b.radius * 1.35 + p.core + PAD_GAP)) continue;
    if (!placed.every((f) => D.hypot(f.x - x, f.z - z) > f.core + p.core + FEATURE_GAP)) continue;
    // A city over the whole map has its middle (its main square's spot) at the map's.
    if (field.config.citySprawl && D.hypot(x, z) < p.core + PAD_GAP + 4) continue;
    const box = ways.box(x, z, p.reach + field.config.cellSize * 2);
    const heights = box.save();
    const targets = p.raise();
    const raised = ways.raised(box, heights);
    ways.mark(raised, 1);
    ways.update(box);
    if (ways.open(targets)) {
      placed.push({ x, z, core: p.core });
      // From here on this ground is high ground (see Battlefield.sheer).
      for (const k of raised) field.sheer[k] = 1;
      return true;
    }
    box.restore(heights);
    ways.mark(raised, 0);
    ways.update(box);
  }
  return false;
}

/** How much of a raise survives near the map's edge: the same taper the rolling terrain has (see generateBattlefield). */
function taper(field: Battlefield, i: number, j: number): number {
  const { cols, rows } = field.config;
  const edge = Math.min(i, cols - i, j, rows - j);
  const t = Math.max(0, Math.min(1, edge / 4));
  return 0.55 + 0.45 * t * t * (3 - 2 * t);
}

/** Every vertex within `reach` of a point, with its offset from it. */
function around(field: Battlefield, x: number, z: number, reach: number, each: (k: number, dx: number, dz: number, i: number, j: number) => void): void {
  const { cols, rows, cellSize } = field.config;
  const b = field.bounds;
  const i0 = Math.max(0, Math.floor((x - reach - b.minX) / cellSize));
  const i1 = Math.min(cols, Math.ceil((x + reach - b.minX) / cellSize));
  const j0 = Math.max(0, Math.floor((z - reach - b.minZ) / cellSize));
  const j1 = Math.min(rows, Math.ceil((z + reach - b.minZ) / cellSize));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const dx = field.vertexX(i) - x;
      const dz = field.vertexZ(j) - z;
      if (dx * dx + dz * dz <= reach * reach) each(j * (cols + 1) + i, dx, dz, i, j);
    }
  }
}

/** A wobble round a circle, -1 to 1, smooth all the way round (noise sampled on a ring). */
function wobble(noise: (x: number, z: number) => number, seed: number, angle: number): number {
  return noise(seed + D.cos(angle) * 1.2, seed * 0.7 + D.sin(angle) * 1.2);
}

function planMountain(field: Battlefield, rng: Rng, noise: (x: number, z: number) => number, x: number, z: number): Plan {
  const radius = rng.range(11, 19);
  const peak = HILL_HEIGHT * rng.range(1.2, 2.2);
  const seed = rng.range(0, 100);
  const reach = radius * 1.3;
  const raise = () => {
    const heights = field.heights;
    around(field, x, z, reach, (k, dx, dz, i, j) => {
      const r = radius * (1 + 0.3 * wobble(noise, seed, D.atan2(dz, dx)));
      const t = D.hypot(dx, dz) / r;
      if (t >= 1) return;
      // Ridged: sharp crests and gullies running down the flanks, sharpest up top.
      const ridge = 1 - Math.abs(noise(field.vertexX(i) / 7 + seed, field.vertexZ(j) / 7 - seed));
      heights[k] += peak * D.pow(1 - t, 1.4) * (0.65 + 0.35 * ridge) * taper(field, i, j);
    });
    return [];
  };
  // Its foothills are gentle enough to crowd other things.
  return { core: radius * 0.9, reach, raise };
}

function planMesa(field: Battlefield, rng: Rng, noise: (x: number, z: number) => number, x: number, z: number): Plan | null {
  // A little smaller on small maps, where there's less room between the bases.
  const scale = Math.max(0.75, Math.min(1, Math.sqrt((field.config.cols * field.config.rows) / PER_AREA)));
  const radius = rng.range(8, 14) * scale;
  const rise = rng.range(5.5, 8);
  const seed = rng.range(0, 100);
  // The first ramp comes down facing a base (the way armies will come at it), roughly.
  const base = field.baseSites[Math.floor(rng.next() * field.baseSites.length)];
  const ramps = [D.atan2(base.z - z, base.x - x) + rng.range(-0.7, 0.7)];
  if (radius > 11) ramps.push(ramps[0] + Math.PI + rng.range(-0.8, 0.8));
  const run = (rise * 1.5) / RAMP_GRADE;
  const half = RAMP_HALF_WIDTH / radius;
  const reach = radius * 1.2 + run + 1;
  // Ramps have to come down onto dry land on the map.
  for (const a of ramps) {
    const fx = x + D.cos(a) * (radius + run + 1);
    const fz = z + D.sin(a) * (radius + run + 1);
    if (!field.contains(fx, fz, 2) || field.heightAt(fx, fz) < field.seaLevel + 0.5) return null;
  }
  if (field.heightAt(x, z) < field.seaLevel + 0.5) return null;
  const raise = () => {
    // A flat top, the height of the ground under it on average plus the rise.
    let ground = field.heightAt(x, z);
    for (let a = 0; a < 8; a++) ground += field.heightAt(x + D.cos((a / 8) * Math.PI * 2) * radius * 0.7, z + D.sin((a / 8) * Math.PI * 2) * radius * 0.7);
    const top = ground / 9 + rise;
    const heights = field.heights;
    around(field, x, z, reach, (k, dx, dz, i, j) => {
      if (heights[k] >= top) return;
      const angle = D.atan2(dz, dx);
      const d = D.hypot(dx, dz) - radius * (1 + 0.18 * wobble(noise, seed, angle));
      // How much of a ramp this way out is: all of one, none, or the shoulder between.
      let ramp = 0;
      for (const a of ramps) {
        let off = Math.abs(angle - a) % (Math.PI * 2);
        if (off > Math.PI) off = Math.PI * 2 - off;
        ramp = Math.max(ramp, 1 - smoothstep(half, half + RAMP_SHOULDER, off));
      }
      const fall = CLIFF_FALL + (run - CLIFF_FALL) * ramp;
      const m = d <= 0 ? 1 : 1 - smoothstep(0, fall, d);
      if (m <= 0) return;
      heights[k] += (top - heights[k]) * m * taper(field, i, j);
    });
    return [{ x, z }];
  };
  return { core: radius * 1.18, reach, raise };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A rectangle of map cells, and the vertices round it. */
interface Box {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  save: () => Float32Array;
  restore: (saved: Float32Array) => void;
}

/**
 * The cliffs being raised, kept up to date a feature at a time, to check
 * the bases (and mesa tops) can still be reached (see open): which cells
 * are high ground, and which of those are sheer. The base pads never
 * count as cliffs, since they'll be levelled; water doesn't either, since
 * it gets bridged.
 */
class Ways {
  private readonly cliff: Uint8Array;
  /** High ground so far, kept and being tried. */
  private readonly high: Uint8Array;

  constructor(private readonly field: Battlefield) {
    const n = field.config.cols * field.config.rows;
    this.cliff = new Uint8Array(n);
    this.high = new Uint8Array(n);
  }

  box(x: number, z: number, reach: number): Box {
    const field = this.field;
    const { cols, rows } = field.config;
    const [i0, j0] = field.cellAt(x - reach, z - reach);
    const [i1, j1] = field.cellAt(x + reach, z + reach);
    const stride = cols + 1;
    const save = () => {
      const out = new Float32Array((i1 - i0 + 2) * (j1 - j0 + 2));
      let n = 0;
      for (let j = j0; j <= Math.min(rows, j1 + 1); j++) for (let i = i0; i <= Math.min(cols, i1 + 1); i++) out[n++] = field.heights[j * stride + i];
      return out;
    };
    const restore = (saved: Float32Array) => {
      let n = 0;
      for (let j = j0; j <= Math.min(rows, j1 + 1); j++) for (let i = i0; i <= Math.min(cols, i1 + 1); i++) field.heights[j * stride + i] = saved[n++];
    };
    return { i0, j0, i1, j1, save, restore };
  }

  /** The cells in a box that a raise changed (any of their corners), going by the heights saved before it. */
  raised(box: Box, saved: Float32Array): number[] {
    const field = this.field;
    const { cols, rows } = field.config;
    const stride = cols + 1;
    const iMax = Math.min(cols, box.i1 + 1);
    const jMax = Math.min(rows, box.j1 + 1);
    const w = iMax - box.i0 + 1;
    const moved = (i: number, j: number) => i <= iMax && j <= jMax && Math.abs(field.heights[j * stride + i] - saved[(j - box.j0) * w + (i - box.i0)]) > RAISED;
    const out: number[] = [];
    for (let j = box.j0; j <= Math.min(rows - 1, box.j1); j++) {
      for (let i = box.i0; i <= Math.min(cols - 1, box.i1); i++) {
        if (moved(i, j) || moved(i + 1, j) || moved(i, j + 1) || moved(i + 1, j + 1)) out.push(j * cols + i);
      }
    }
    return out;
  }

  /** Mark cells as high ground being tried (1) or not (0), never taking back ground already kept. */
  mark(cells: number[], value: number): void {
    for (const k of cells) if (this.field.sheer[k] === 0) this.high[k] = value;
  }

  /** Work out which cells in a box (and a cell round it) are cliffs now. */
  update(box: Box): void {
    const field = this.field;
    const { cols, rows, cellSize } = field.config;
    for (let j = Math.max(0, box.j0 - 1); j <= Math.min(rows - 1, box.j1 + 1); j++) {
      for (let i = Math.max(0, box.i0 - 1); i <= Math.min(cols - 1, box.i1 + 1); i++) {
        const k = j * cols + i;
        const x = field.bounds.minX + (i + 0.5) * cellSize;
        const z = field.bounds.minZ + (j + 0.5) * cellSize;
        const pad = field.baseSites.some((s) => D.hypot(s.x - x, s.z - z) < s.radius);
        this.cliff[k] = this.high[k] && !pad && field.heightAt(x, z) >= field.seaLevel && field.slopeAt(x, z) > CLIFF_SLOPE ? 1 : 0;
      }
    }
  }

  /**
   * Whether every base, and these points, can be reached from the first
   * base without climbing a cliff, by ways at least three cells wide (room
   * for a super unit): through cells with no cliff in them or next to them.
   */
  open(targets: { x: number; z: number }[]): boolean {
    const field = this.field;
    const { cols, rows } = field.config;
    const n = cols * rows;
    const cliff = this.cliff;
    const clear = (k: number) => {
      const i = k % cols;
      const j = (k - i) / cols;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < cols && nj < rows && cliff[nj * cols + ni]) return false;
        }
      }
      return true;
    };
    const cellOf = (p: { x: number; z: number }) => {
      const [i, j] = field.cellAt(p.x, p.z);
      return j * cols + i;
    };
    const reach = new Uint8Array(n);
    const start = cellOf(field.baseSites[0]);
    const stack = [start];
    reach[start] = 1;
    while (stack.length > 0) {
      const k = stack.pop()!;
      const i = k % cols;
      if (i > 0) visit(k - 1);
      if (i < cols - 1) visit(k + 1);
      if (k >= cols) visit(k - cols);
      if (k + cols < n) visit(k + cols);
    }
    function visit(k: number): void {
      if (reach[k] || !clear(k)) return;
      reach[k] = 1;
      stack.push(k);
    }
    // A point counts as reached if its cell or one next to it is.
    const reached = (p: { x: number; z: number }) => {
      const k = cellOf(p);
      const i = k % cols;
      for (const nk of [k, i > 0 ? k - 1 : -1, i < cols - 1 ? k + 1 : -1, k - cols, k + cols]) if (nk >= 0 && nk < n && reach[nk]) return true;
      return false;
    };
    return field.baseSites.every(reached) && targets.every(reached);
  }
}
