import { System } from '../core/ecs';
import { Battlefield } from '../world/battlefield';
import { MOVE_RULES } from '../world/moveClasses';
import { Building, Construction, Faction, Mover, Transform, Unit } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';

/**
 * Frost (Rime). Cryo weapons, and the cold that Rime's Glacier walker and
 * cold tower give off, lay frost on the ground: it goes white, and enemies
 * of whoever froze it slow right down while they're on it (water freezes
 * over too, so boats crawl). Frost thaws on its own after a while (slowly: a canister's patch lasts about fifteen seconds), and
 * fire (Firestorm's burning ground) melts it at once. Shard guns hit
 * harder on anything standing on frost: frozen things shatter (see
 * WeaponDef.shatter).
 *
 * What a watcher sees: white patches spreading where Rime's sprayers and
 * freezer trucks work, enemy columns crawling across them, and the patches
 * steaming away where fire meets them.
 *
 * Kept per cell of a coarse grid, only for cells that are frosted, so a
 * battle with no Rime side costs nothing (like fire.ts).
 */

/** Size of a frost cell, world units. */
export const FROST_CELL = 1.5;
/** Frost at which ground counts as frozen. */
export const FROZEN = 0.3;
/** Most frost a patch can hold: seconds of thaw, about. */
const MAX_FROST = 14;
/** Frost lost per second as it thaws on its own. */
const THAW = 0.4;
/** Speed on fully frozen ground, as a share of the usual; it eases from 1 at FROZEN. */
export const ICE_PACE = 0.5;
/** Frost at which a patch slows as much as it ever will. */
const DEEP = 4;

export class FrostField {
  readonly cols: number;
  readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  readonly frost: Float32Array;
  /** The side whose frost it is. */
  private readonly owner: Int16Array;
  private active: number[] = [];
  private readonly listed: Uint8Array;
  /** Changes whenever something a watcher could see changes (see the mirror's snapshot). */
  version = 0;

  constructor(field: Battlefield) {
    this.minX = field.bounds.minX;
    this.minZ = field.bounds.minZ;
    this.cols = Math.ceil(field.width / FROST_CELL);
    this.rows = Math.ceil(field.depth / FROST_CELL);
    const n = this.cols * this.rows;
    this.frost = new Float32Array(n);
    this.owner = new Int16Array(n);
    this.listed = new Uint8Array(n);
  }

  get count(): number {
    return this.active.length;
  }

  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / FROST_CELL);
    const j = Math.floor((z - this.minZ) / FROST_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  center(k: number): { x: number; z: number } {
    const i = k % this.cols;
    return { x: this.minX + (i + 0.5) * FROST_CELL, z: this.minZ + ((k - i) / this.cols + 0.5) * FROST_CELL };
  }

  /** Frost at a point (0 off the map). */
  at(x: number, z: number): number {
    if (this.active.length === 0) return 0;
    const k = this.cellAt(x, z);
    return k < 0 ? 0 : this.frost[k];
  }

  /** Whether a point is frozen ground of an enemy of `faction`'s. */
  hostileAt(ctx: SimContext, x: number, z: number, faction: number): boolean {
    if (this.active.length === 0) return false;
    const k = this.cellAt(x, z);
    return k >= 0 && this.frost[k] >= FROZEN && ctx.sides.hostile(this.owner[k], faction);
  }

  /** How fast a unit of `faction` goes on the ground at a point, as a share of its usual: slower on an enemy's frost. */
  paceAt(ctx: SimContext, x: number, z: number, faction: number): number {
    if (this.active.length === 0) return 1;
    const k = this.cellAt(x, z);
    if (k < 0 || this.frost[k] < FROZEN || !ctx.sides.hostile(this.owner[k], faction)) return 1;
    const deep = Math.min(1, (this.frost[k] - FROZEN) / (DEEP - FROZEN));
    return 1 - (1 - ICE_PACE) * (0.5 + 0.5 * deep);
  }

  /** Lay `amount` of frost on the ground round a point, most in the middle. Frost of another side's is taken over. */
  add(x: number, z: number, radius: number, amount: number, faction: number): void {
    const r = Math.max(radius, FROST_CELL * 0.5);
    const i0 = Math.max(0, Math.floor((x - r - this.minX) / FROST_CELL));
    const i1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / FROST_CELL));
    const j0 = Math.max(0, Math.floor((z - r - this.minZ) / FROST_CELL));
    const j1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / FROST_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = this.minX + (i + 0.5) * FROST_CELL;
        const cz = this.minZ + (j + 0.5) * FROST_CELL;
        const d = D.hypot(cx - x, cz - z);
        if (d > r + FROST_CELL * 0.5) continue;
        const k = j * this.cols + i;
        this.frost[k] = Math.min(MAX_FROST, this.frost[k] + amount * (1 - 0.5 * Math.min(1, d / r)));
        this.owner[k] = faction;
        if (!this.listed[k]) {
          this.listed[k] = 1;
          this.active.push(k);
        }
      }
    }
    this.version++;
  }

  /** Thaw every patch a little, and melt at once what's burning (see fire.ts). */
  thaw(dt: number, burning: (x: number, z: number) => boolean): void {
    if (this.active.length === 0) return;
    const next: number[] = [];
    for (const k of this.active) {
      const c = this.center(k);
      this.frost[k] = burning(c.x, c.z) ? 0 : this.frost[k] - THAW * dt;
      if (this.frost[k] > 0) next.push(k);
      else {
        this.frost[k] = 0;
        this.listed[k] = 0;
      }
    }
    this.active = next;
    this.version++;
  }

  owners(k: number): number {
    return this.owner[k];
  }

  /** The frosted cells, for the page: cell, frost, owner, in threes. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const k of this.active) out.push(k, Math.round(this.frost[k] * 10) / 10, this.owner[k]);
    return out;
  }

  apply(snapshot: number[]): void {
    for (const k of this.active) {
      this.frost[k] = 0;
      this.listed[k] = 0;
    }
    this.active = [];
    for (let n = 0; n + 2 < snapshot.length; n += 3) {
      const k = snapshot[n];
      this.frost[k] = snapshot[n + 1];
      this.owner[k] = snapshot[n + 2];
      this.listed[k] = 1;
      this.active.push(k);
    }
    this.version++;
  }

  forEach(visit: (k: number, frost: number) => void): void {
    for (const k of this.active) visit(k, this.frost[k]);
  }
}


/**
 * Thaws the frost (fire melts it outright), and lets chilling units and
 * buildings (see UnitDef.chill) freeze the ground round them.
 */
export function frostSystem(ctx: SimContext): System {
  return {
    name: 'frost',
    update(world, dt) {
      const frost = ctx.frost;
      if (frost.count > 0) frost.thaw(dt, (x, z) => ctx.fire.count > 0 && ctx.fire.heatAt(x, z) > 0.25);
      // The cold comes off them steadily, every tick, so the edge of an aura doesn't pulse.
      for (const e of world.query(Unit, Transform, Faction)) {
        const chill = world.req(e, Unit).def.chill;
        if (!chill) continue;
        const m = world.get(e, Mover);
        if (m && MOVE_RULES[m.move].flies) continue;
        const t = world.req(e, Transform);
        frost.add(t.x, t.z, chill.radius, chill.rate * dt, world.req(e, Faction).id);
      }
      for (const e of world.query(Building, Transform, Faction)) {
        const chill = world.req(e, Building).def.chill;
        if (!chill || world.has(e, Construction)) continue;
        const t = world.req(e, Transform);
        frost.add(t.x, t.z, chill.radius, chill.rate * dt, world.req(e, Faction).id);
      }
    },
  };
}
