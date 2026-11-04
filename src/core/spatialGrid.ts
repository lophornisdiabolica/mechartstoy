import { Entity } from './ecs';

/**
 * Uniform grid for "who is near this point" queries. Rebuilt every tick,
 * which is cheap and avoids having to track moves incrementally. Each entry
 * can carry some data of the caller's (`T`), handed back to `visit`, so a
 * query doesn't have to look up each neighbour's components again.
 */
export class SpatialGrid<T = undefined> {
  /** Each cell's entries, as indices into the flat arrays below, in insertion order. */
  private readonly cells = new Map<number, number[]>();
  private entities: Entity[] = [];
  private data: T[] = [];
  private xs = new Float64Array(256);
  private zs = new Float64Array(256);
  private count = 0;

  constructor(readonly cellSize: number) {}

  clear(): void {
    for (const list of this.cells.values()) list.length = 0;
    this.entities.length = 0;
    this.data.length = 0;
    this.count = 0;
  }

  insert(e: Entity, x: number, z: number, data?: T): void {
    const key = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    const n = this.count++;
    if (n === this.xs.length) {
      const xs = new Float64Array(n * 2);
      const zs = new Float64Array(n * 2);
      xs.set(this.xs);
      zs.set(this.zs);
      this.xs = xs;
      this.zs = zs;
    }
    this.entities[n] = e;
    this.data[n] = data as T;
    this.xs[n] = x;
    this.zs[n] = z;
    list.push(n);
  }

  /** Calls `visit` for every entity within `radius` of (x, z). */
  forEachNear(x: number, z: number, radius: number, visit: (e: Entity, distSq: number, data: T) => void): void {
    const r2 = radius * radius;
    const minI = Math.floor((x - radius) / this.cellSize);
    const maxI = Math.floor((x + radius) / this.cellSize);
    const minJ = Math.floor((z - radius) / this.cellSize);
    const maxJ = Math.floor((z + radius) / this.cellSize);
    const xs = this.xs;
    const zs = this.zs;
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const n = list[k];
          const dx = xs[n] - x;
          const dz = zs[n] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) visit(this.entities[n], d2, this.data[n]);
        }
      }
    }
  }

  private key(i: number, j: number): number {
    // Packs two signed 16-bit cell coords into one number.
    return ((i + 32768) << 16) | (j + 32768);
  }
}
