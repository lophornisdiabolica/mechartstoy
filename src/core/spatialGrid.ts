import { Entity } from './ecs';

/**
 * Uniform grid for "who is near this point" queries. Rebuilt every tick,
 * which is cheap and avoids having to track moves incrementally. Each entry
 * can carry some data of the caller's (`T`), handed back to `visit`, so a
 * query doesn't have to look up each neighbour's components again.
 *
 * Entries go into flat arrays as they're inserted; the first query after
 * that sorts them by cell (keeping insertion order within a cell) over the
 * box of cells they cover, so a query reads runs of an array rather than
 * hashing each cell it looks at.
 */
export class SpatialGrid<T = undefined> {
  private entities: Entity[] = [];
  private data: T[] = [];
  private xs = new Float64Array(256);
  private zs = new Float64Array(256);
  /** Each entry's cell, as an index into the box (see sort). */
  private cellOf = new Int32Array(256);
  private count = 0;

  /** The box of cells entries are in (inclusive), and its width. */
  private minI = 0;
  private minJ = 0;
  private maxI = -1;
  private maxJ = -1;
  private width = 0;
  /** Where each cell's entries start in `order` (one more than there are cells, so a cell's run ends where the next starts). */
  private starts = new Int32Array(2);
  /** Entry indices, cell by cell. */
  private order = new Int32Array(256);
  private sorted = true;

  constructor(readonly cellSize: number) {}

  clear(): void {
    this.entities.length = 0;
    this.data.length = 0;
    this.count = 0;
    this.maxI = this.maxJ = -1;
    this.minI = this.minJ = 0;
    this.sorted = false;
  }

  insert(e: Entity, x: number, z: number, data?: T): void {
    const n = this.count++;
    if (n === this.xs.length) {
      const grow = <A extends Float64Array | Int32Array>(a: A, make: (size: number) => A): A => {
        const b = make(n * 2);
        b.set(a);
        return b;
      };
      this.xs = grow(this.xs, (s) => new Float64Array(s));
      this.zs = grow(this.zs, (s) => new Float64Array(s));
      this.cellOf = grow(this.cellOf, (s) => new Int32Array(s));
      this.order = new Int32Array(n * 2);
    }
    this.entities[n] = e;
    this.data[n] = data as T;
    this.xs[n] = x;
    this.zs[n] = z;
    this.sorted = false;
  }

  /** Calls `visit` for every entity within `radius` of (x, z). */
  forEachNear(x: number, z: number, radius: number, visit: (e: Entity, distSq: number, data: T) => void): void {
    if (!this.sorted) this.sort();
    const r2 = radius * radius;
    const size = this.cellSize;
    const minI = Math.max(this.minI, Math.floor((x - radius) / size));
    const maxI = Math.min(this.maxI, Math.floor((x + radius) / size));
    const minJ = Math.max(this.minJ, Math.floor((z - radius) / size));
    const maxJ = Math.min(this.maxJ, Math.floor((z + radius) / size));
    const { xs, zs, starts, order, entities, data, width } = this;
    for (let j = minJ; j <= maxJ; j++) {
      const row = (j - this.minJ) * width - this.minI;
      for (let i = minI; i <= maxI; i++) {
        const c = row + i;
        const end = starts[c + 1];
        for (let k = starts[c]; k < end; k++) {
          const n = order[k];
          const dx = xs[n] - x;
          const dz = zs[n] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) visit(entities[n], d2, data[n]);
        }
      }
    }
  }

  /** Bucket the entries by cell: a counting sort, stable, so each cell keeps its insertion order. */
  private sort(): void {
    this.sorted = true;
    const n = this.count;
    if (n === 0) {
      this.maxI = this.maxJ = -1;
      return;
    }
    const size = this.cellSize;
    const { xs, zs } = this;
    let minI = Infinity;
    let maxI = -Infinity;
    let minJ = Infinity;
    let maxJ = -Infinity;
    for (let k = 0; k < n; k++) {
      const i = Math.floor(xs[k] / size);
      const j = Math.floor(zs[k] / size);
      if (i < minI) minI = i;
      if (i > maxI) maxI = i;
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
    const width = maxI - minI + 1;
    const cells = width * (maxJ - minJ + 1);
    if (this.starts.length < cells + 1) this.starts = new Int32Array(Math.max(cells + 1, this.starts.length * 2));
    const starts = this.starts;
    starts.fill(0, 0, cells + 1);
    const cellOf = this.cellOf;
    for (let k = 0; k < n; k++) {
      const c = (Math.floor(zs[k] / size) - minJ) * width + Math.floor(xs[k] / size) - minI;
      cellOf[k] = c;
      starts[c + 1]++;
    }
    for (let c = 0; c < cells; c++) starts[c + 1] += starts[c];
    // Fill each cell's run from its start, counting back up to where it ended.
    const order = this.order;
    for (let k = 0; k < n; k++) order[starts[cellOf[k]]++] = k;
    for (let c = cells; c > 0; c--) starts[c] = starts[c - 1];
    starts[0] = 0;
    this.minI = minI;
    this.maxI = maxI;
    this.minJ = minJ;
    this.maxJ = maxJ;
    this.width = width;
  }
}
