import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import type { Battlefield } from './battlefield';
import { groundCode } from './ground';
import * as D from '../core/dmath';

/**
 * Dense forest: patches of big trees, on dense-forest ground (see ground.ts,
 * 'thicket'), that stand in the way. Unlike the light woods (scenery props),
 * these trees are part of the battle:
 *
 * - they stop direct-fire shots (see lineOfFire.ts), so infantry in a forest
 *   are in cover;
 * - shots and blasts that hit them knock them down;
 * - vehicles and big walkers push through slowly (the ground's speed) and
 *   flatten the trees they drive into.
 *
 * Once a map cell has no trees standing, its ground goes back to open
 * ground, so a fought-over forest gets cleared over a battle.
 *
 * The trees are plain data rather than entities: there can be hundreds, and
 * they only matter where something is shooting through them or driving
 * into them, which a lookup by map cell answers cheaply.
 */

/** Trunk radius, for shots and for vehicles running into them. */
export const TREE_RADIUS = 0.45;
/** Height of a tree: shots above it pass over. */
export const TREE_HEIGHT = 3.4;
/** Damage a tree takes before it falls. */
const TREE_HP = 70;
/** Trees per map cell of dense forest. */
const PER_CELL = 2;

export interface Tree {
  x: number;
  z: number;
  /** Ground height at its foot. */
  y: number;
  hp: number;
  /** Which way it fell (radians), once it has; null while standing. */
  fell: number | null;
  /** Size, for looks (0.85 to 1.2). */
  size: number;
}

/** Something that wants to hear about trees falling (the renderer). */
export type TreeListener = (index: number) => void;

export class Woods {
  readonly trees: Tree[] = [];
  /** Tree indices per map cell. */
  private readonly byCell = new Map<number, number[]>();
  private readonly listeners: TreeListener[] = [];

  constructor(private readonly field: Battlefield) {}

  /** The cell index a point is in. */
  private cellOf(x: number, z: number): number {
    const [i, j] = this.field.cellAt(x, z);
    return j * this.field.config.cols + i;
  }

  add(x: number, z: number, size: number): void {
    const index = this.trees.length;
    this.trees.push({ x, z, y: this.field.heightAt(x, z), hp: TREE_HP, fell: null, size });
    const cell = this.cellOf(x, z);
    const list = this.byCell.get(cell);
    if (list) list.push(index);
    else this.byCell.set(cell, [index]);
  }

  /** Hear about every tree that falls. Returns an unsubscribe. */
  onFell(listener: TreeListener): () => void {
    this.listeners.push(listener);
    return () => this.listeners.splice(this.listeners.indexOf(listener), 1);
  }

  /** Standing trees in the cells round a point (within `radius` plus a cell). */
  *standingNear(x: number, z: number, radius: number): Generator<number> {
    const { cellSize, cols } = this.field.config;
    const [i0, j0] = this.field.cellAt(x - radius - cellSize, z - radius - cellSize);
    const [i1, j1] = this.field.cellAt(x + radius + cellSize, z + radius + cellSize);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const t of this.byCell.get(j * cols + i) ?? []) if (this.trees[t].fell === null) yield t;
      }
    }
  }

  /** The standing trees in one cell. */
  standingIn(cell: number): number[] {
    return (this.byCell.get(cell) ?? []).filter((t) => this.trees[t].fell === null);
  }

  /** Whether any trees stand in the cell a point is in. */
  hasTreesAt(x: number, z: number): boolean {
    return this.standingIn(this.cellOf(x, z)).length > 0;
  }

  /**
   * Hurt the trees within `radius` of a point whose trunks reach `y` (a
   * blast's height): `amount` at the centre, less further out.
   */
  damage(x: number, z: number, y: number, radius: number, amount: number, fallFrom: { x: number; z: number } | null = null): void {
    for (const t of [...this.standingNear(x, z, radius)]) {
      const tree = this.trees[t];
      const d = D.hypot(tree.x - x, tree.z - z) - TREE_RADIUS;
      if (d > radius || y > tree.y + TREE_HEIGHT * tree.size + 0.5) continue;
      tree.hp -= amount * (1 - 0.6 * Math.max(0, d) / Math.max(0.01, radius));
      if (tree.hp <= 0) this.fell(t, fallFrom ?? { x, z });
    }
  }

  /** Knock a tree down, away from `from`. */
  fell(t: number, from: { x: number; z: number }): void {
    const tree = this.trees[t];
    if (tree.fell !== null) return;
    tree.hp = 0;
    const away = D.atan2(tree.z - from.z, tree.x - from.x);
    tree.fell = Number.isFinite(away) ? away : 0;
    for (const l of [...this.listeners]) l(t);
    // A cell with no trees left standing is open ground again.
    const cell = this.cellOf(tree.x, tree.z);
    if (this.standingIn(cell).length === 0 && this.field.ground[cell] === groundCode('thicket')) this.field.setGround([cell], 'plain');
  }

  /**
   * Show a tree as fallen the way another copy of this map saw it fall (see
   * sim/mirror.ts). Only tells the listeners; the ground change comes with
   * the map's own changes.
   */
  showFell(t: number, angle: number): void {
    const tree = this.trees[t];
    if (tree.fell !== null) return;
    tree.hp = 0;
    tree.fell = angle;
    for (const l of [...this.listeners]) l(t);
  }

  /**
   * Flatten the trees a vehicle runs into (its footprint, `radius`, at a
   * point). Returns how many fell.
   */
  crush(x: number, z: number, radius: number, from: { x: number; z: number }): number {
    let n = 0;
    for (const t of [...this.standingNear(x, z, radius)]) {
      const tree = this.trees[t];
      if (D.hypot(tree.x - x, tree.z - z) > radius + TREE_RADIUS) continue;
      this.fell(t, from);
      n++;
    }
    return n;
  }

  /**
   * The first standing tree a straight path hits, as the distance along it
   * (or null): the path from (x, z) heading (ux, uz) per unit of ground,
   * at height `yAt(s)`, up to `end`.
   */
  firstHit(x: number, z: number, ux: number, uz: number, end: number, yAt: (s: number) => number): number | null {
    if (this.byCell.size === 0) return null;
    const step = this.field.config.cellSize * 0.5;
    const seen = new Set<number>();
    let best: number | null = null;
    for (let s = 0; s <= end + step; s += step) {
      // Once something's been hit, cells further on can't do better.
      if (best !== null && s > best + this.field.config.cellSize * 2) break;
      const cell = this.cellOf(x + ux * s, z + uz * s);
      if (seen.has(cell)) continue;
      seen.add(cell);
      for (const t of this.byCell.get(cell) ?? []) {
        const tree = this.trees[t];
        if (tree.fell !== null) continue;
        const ox = tree.x - x;
        const oz = tree.z - z;
        const along = ox * ux + oz * uz;
        const off2 = ox * ox + oz * oz - along * along;
        if (off2 > TREE_RADIUS * TREE_RADIUS) continue;
        const enter = along - Math.sqrt(TREE_RADIUS * TREE_RADIUS - off2);
        if (enter < 0.3 || enter > end) continue;
        const y = yAt(enter);
        if (y < tree.y - 0.2 || y > tree.y + TREE_HEIGHT * tree.size) continue;
        if (best === null || enter < best) best = enter;
      }
    }
    return best;
  }
}

/**
 * Grow dense forest: patches where a noise field is high, on dry, gentle
 * ground away from bases, towns, outposts, roads and bridges. `amount` (0 to
 * 1) is roughly the share of open land it covers. The patches' ground
 * becomes dense forest, with trees on it.
 */
export function growWoods(field: Battlefield, rng: Rng, amount: number): void {
  if (amount <= 0) return;
  const { cols, rows, cellSize } = field.config;
  const noise = createNoise2D(() => rng.next());
  // Noise is roughly normal round 0: this threshold leaves about `amount` of the cells above it.
  const threshold = 0.75 - amount * 1.2;
  const cells: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = field.bounds.minX + (i + 0.5) * cellSize;
      const z = field.bounds.minZ + (j + 0.5) * cellSize;
      const n = noise(x / 22, z / 22) * 0.7 + noise(x / 7, z / 7) * 0.3;
      if (n < threshold) continue;
      if (field.heightAt(x, z) < field.seaLevel + 0.3 || field.slopeAt(x, z) > 0.6) continue;
      if (field.roadCell[j * cols + i] || field.nearBridge(x, z, 3)) continue;
      if (field.baseSites.some((s) => D.hypot(s.x - x, s.z - z) < s.radius + 6)) continue;
      if (field.townSites.some((s) => D.hypot(s.x - x, s.z - z) < s.radius + 3)) continue;
      if (field.outpostSites.some((s) => D.hypot(s.x - x, s.z - z) < s.radius + 3)) continue;
      cells.push(j * cols + i);
      for (let k = 0; k < PER_CELL; k++) {
        // Spread round the cell, kept off its edges a little.
        const tx = x + ((k - (PER_CELL - 1) / 2) * 0.7 + rng.range(-0.25, 0.25)) * cellSize * 0.5;
        const tz = z + rng.range(-0.3, 0.3) * cellSize;
        field.woods.add(tx, tz, rng.range(0.85, 1.2));
      }
    }
  }
  field.setGround(cells, 'thicket');
}
