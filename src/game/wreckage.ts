import { Battlefield } from '../world/battlefield';
import * as D from '../core/dmath';

/**
 * Wreckage: the scattered metal that wrecked vehicles leave on the ground.
 * A vehicle throws some of it about when it's destroyed, and the rest
 * comes down where its hulk falls apart (see wreckSystem), so wreckage
 * piles up where the fighting was heaviest, and a field fought over again
 * and again turns into a scrapyard. It rusts away slowly over many minutes
 * (a heavy pile lasts a quarter of an hour), so the map shows where the
 * old battles were for a good while, but not forever.
 *
 * What a watcher sees: heaps of torn plates, girders and drums round the
 * hulks (see render/wreckageGround.ts), growing as more vehicles die there.
 *
 * It's kept in the sim, not just drawn, because some doctrines will feed
 * on it (Hive's fabricators eat it, Lodestar's cranes throw it): `take`
 * removes wreckage, and the drawn heaps shrink as it does. It doesn't get
 * in anyone's way itself: the scrap ground (see scrap.ts) does that.
 *
 * Kept per cell of a coarse grid, only for cells with some on them.
 */

/** Size of a wreckage cell, world units. */
export const WRECKAGE_CELL = 1.5;
/** Most wreckage a cell holds, in tank-sized wrecks: past this it spills into the cells round it. */
export const MAX_WRECKAGE = 4;
/** Seconds wreckage takes to rust to about a third (a pile of 4 lasts about a quarter of an hour). */
const RUST = 420;
/** Below this a cell is clear. */
const GONE = 0.03;
/** Seconds between rusting steps. */
const RUST_EVERY = 3;

export class WreckageField {
  readonly cols: number;
  readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  readonly mass: Float32Array;
  private active: number[] = [];
  private readonly listed: Uint8Array;
  private sinceRust = 0;
  /** Changes whenever the wreckage changes (see the mirror's snapshot). */
  version = 0;

  constructor(field: Battlefield) {
    this.minX = field.bounds.minX;
    this.minZ = field.bounds.minZ;
    this.cols = Math.ceil(field.width / WRECKAGE_CELL);
    this.rows = Math.ceil(field.depth / WRECKAGE_CELL);
    const n = this.cols * this.rows;
    this.mass = new Float32Array(n);
    this.listed = new Uint8Array(n);
  }

  /** Cells with wreckage on them. */
  get count(): number {
    return this.active.length;
  }

  /** All the wreckage on the map, in tank-sized wrecks. */
  get total(): number {
    let sum = 0;
    for (const k of this.active) sum += this.mass[k];
    return sum;
  }

  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / WRECKAGE_CELL);
    const j = Math.floor((z - this.minZ) / WRECKAGE_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  center(k: number): { x: number; z: number } {
    const i = k % this.cols;
    return { x: this.minX + (i + 0.5) * WRECKAGE_CELL, z: this.minZ + ((k - i) / this.cols + 0.5) * WRECKAGE_CELL };
  }

  /** Wreckage on the cell under a point. */
  at(x: number, z: number): number {
    const k = this.cellAt(x, z);
    return k < 0 ? 0 : this.mass[k];
  }

  /** Wreckage within `radius` of a point. */
  near(x: number, z: number, radius: number): number {
    let sum = 0;
    this.cells(x, z, radius, (k) => (sum += this.mass[k]));
    return sum;
  }

  /**
   * Scatter `amount` of wreckage round a point, thickest in the middle and
   * thinning out to `radius`. A cell that's full spills the rest outward,
   * so a much-fought spot spreads into a wider field rather than a spike.
   */
  add(x: number, z: number, radius: number, amount: number, spill = false): void {
    if (amount <= 0) return;
    const r = Math.max(radius, WRECKAGE_CELL * 0.75);
    const weights: [number, number][] = [];
    let sum = 0;
    this.cells(x, z, r, (k, d) => {
      // Spilt wreckage only lands where there's room.
      if (spill && this.mass[k] >= MAX_WRECKAGE - 1e-4) return;
      const w = 1 - 0.7 * Math.min(1, d / r);
      weights.push([k, w]);
      sum += w;
    });
    if (sum <= 0) {
      if (spill && r < 24) this.add(x, z, r + WRECKAGE_CELL * 1.5, amount, true);
      return;
    }
    let spilt = 0;
    for (const [k, w] of weights) {
      const want = this.mass[k] + (amount * w) / sum;
      this.set(k, Math.min(MAX_WRECKAGE, want));
      spilt += Math.max(0, want - MAX_WRECKAGE);
    }
    // What didn't fit lands a little further out.
    if (spilt > 0.01 && r < 24) this.add(x, z, r + WRECKAGE_CELL * 1.5, spilt, true);
    this.version++;
  }

  /**
   * Take up to `amount` of wreckage from within `radius` of a point,
   * nearest first, and return how much was taken (for whatever eats or
   * carries it).
   */
  take(x: number, z: number, radius: number, amount: number): number {
    const cells: [number, number][] = [];
    this.cells(x, z, radius, (k, d) => this.mass[k] > 0 && cells.push([k, d]));
    cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    let taken = 0;
    for (const [k] of cells) {
      if (taken >= amount) break;
      const bite = Math.min(this.mass[k], amount - taken);
      this.set(k, this.mass[k] - bite);
      taken += bite;
    }
    if (taken > 0) this.version++;
    return taken;
  }

  /** Rust everything a little. */
  rust(dt: number): void {
    this.sinceRust += dt;
    if (this.sinceRust < RUST_EVERY || this.active.length === 0) return;
    const keep = D.exp(-this.sinceRust / RUST);
    this.sinceRust = 0;
    const next: number[] = [];
    for (const k of this.active) {
      this.mass[k] *= keep;
      if (this.mass[k] >= GONE) next.push(k);
      else {
        this.mass[k] = 0;
        this.listed[k] = 0;
      }
    }
    this.active = next;
    this.version++;
  }

  /** The cells with wreckage, for the page: cell and mass, in pairs. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const k of this.active) out.push(k, Math.round(this.mass[k] * 100) / 100);
    return out;
  }

  apply(snapshot: number[]): void {
    for (const k of this.active) {
      this.mass[k] = 0;
      this.listed[k] = 0;
    }
    this.active = [];
    for (let n = 0; n + 1 < snapshot.length; n += 2) {
      const k = snapshot[n];
      this.mass[k] = snapshot[n + 1];
      this.listed[k] = 1;
      this.active.push(k);
    }
    this.version++;
  }

  forEach(visit: (k: number, mass: number) => void): void {
    for (const k of this.active) visit(k, this.mass[k]);
  }

  private set(k: number, mass: number): void {
    if (mass < GONE) {
      this.mass[k] = 0;
      if (this.listed[k]) {
        this.listed[k] = 0;
        this.active.splice(this.active.indexOf(k), 1);
      }
      return;
    }
    this.mass[k] = mass;
    if (!this.listed[k]) {
      this.listed[k] = 1;
      this.active.push(k);
    }
  }

  /** Visit the cells whose middles are within `radius` of a point (and the one under it), with their distance. */
  private cells(x: number, z: number, radius: number, visit: (k: number, d: number) => void): void {
    const i0 = Math.max(0, Math.floor((x - radius - this.minX) / WRECKAGE_CELL));
    const i1 = Math.min(this.cols - 1, Math.floor((x + radius - this.minX) / WRECKAGE_CELL));
    const j0 = Math.max(0, Math.floor((z - radius - this.minZ) / WRECKAGE_CELL));
    const j1 = Math.min(this.rows - 1, Math.floor((z + radius - this.minZ) / WRECKAGE_CELL));
    const under = this.cellAt(x, z);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i;
        const d = D.hypot(this.minX + (i + 0.5) * WRECKAGE_CELL - x, this.minZ + (j + 0.5) * WRECKAGE_CELL - z);
        if (d <= radius || k === under) visit(k, d);
      }
    }
  }
}

/** How much wreckage a vehicle leaves, in tank-sized wrecks (by its footprint, as the scrap does). */
export function wreckageOf(radius: number): number {
  return Math.min(6, radius * radius);
}
