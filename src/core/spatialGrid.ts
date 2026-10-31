import { Entity } from './ecs';

/**
 * Uniform grid for "who is near this point" queries. Rebuilt every tick,
 * which is cheap and avoids having to track moves incrementally.
 */
export class SpatialGrid {
  private readonly cells = new Map<number, Entity[]>();
  private readonly positions = new Map<Entity, { x: number; z: number }>();

  constructor(readonly cellSize: number) {}

  clear(): void {
    for (const list of this.cells.values()) list.length = 0;
    this.positions.clear();
  }

  insert(e: Entity, x: number, z: number): void {
    const key = this.key(Math.floor(x / this.cellSize), Math.floor(z / this.cellSize));
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(e);
    this.positions.set(e, { x, z });
  }

  /** Calls `visit` for every entity within `radius` of (x, z). */
  forEachNear(x: number, z: number, radius: number, visit: (e: Entity, distSq: number) => void): void {
    const r2 = radius * radius;
    const minI = Math.floor((x - radius) / this.cellSize);
    const maxI = Math.floor((x + radius) / this.cellSize);
    const minJ = Math.floor((z - radius) / this.cellSize);
    const maxJ = Math.floor((z + radius) / this.cellSize);
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const e of list) {
          const p = this.positions.get(e)!;
          const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d2 <= r2) visit(e, d2);
        }
      }
    }
  }

  private key(i: number, j: number): number {
    // Packs two signed 16-bit cell coords into one number.
    return ((i + 32768) << 16) | (j + 32768);
  }
}
