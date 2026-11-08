import { System } from '../core/ecs';
import { Battlefield } from '../world/battlefield';
import { MOVE_RULES } from '../world/moveClasses';
import { Faction, Health, Hit, Mover, Transform, Unit } from './components';
import { SimContext } from './context';
import { applyDamage } from './systems/projectiles';
import { WeaponDef } from './units';
import * as D from '../core/dmath';

/**
 * Burning ground (Firestorm). Flame lands on the ground and keeps burning
 * there: a patch is hot at first, then cools into scorched ground that
 * smoulders for a while longer. One flamer keeps a patch burning but never
 * makes it more than hot; only when several pour fire onto the same spot
 * does it build up to white-hot, which burns straight through armour.
 *
 * What a watcher sees: orange patches where flamers have been working,
 * fading to dark scorch marks, and a glaring yellow-white blaze where a
 * Firestorm pack has ganged up on something.
 *
 * Heat is kept per cell of a coarse grid, only for cells that are burning or
 * scorched, so a battle with no Firestorm side costs nothing.
 */

/** Size of a fire cell, world units. */
export const FIRE_CELL = 1.5;
/** Seconds for a patch's heat to cool to about a third, once nothing's adding to it. */
const COOL_TIME = 2.2;
/** Heat at which a patch is burning (below it, it's scorched). */
export const LIT = 0.25;
/** Heat at which a patch is white-hot, and burns through armour. */
export const WHITE_HOT = 1.5;
/** Most heat a patch can hold. */
const MAX_HEAT = 3.5;
/** Seconds a patch stays scorched after it last burned. */
const SCORCH_TIME = 12;
/** One flamer pouring fire on one spot brings it to about this much heat (see heatPerShot). */
const ONE_FLAMER = 0.9;
/** Seconds between burns for whatever stands in the fire. */
const BURN_EVERY = 0.5;
/** Damage per second, per unit of heat, to what stands in burning ground; and in scorched ground. */
const BURN = 6;
const SMOULDER = 1.5;

/**
 * How much heat one gout of this weapon adds where it lands: enough that a
 * flamer firing steadily at one spot keeps it at about ONE_FLAMER, whatever
 * its rate of fire. So it takes two or three together to get white-hot.
 */
export function heatPerShot(w: WeaponDef): number {
  return (ONE_FLAMER * w.cooldown) / (w.burst * COOL_TIME);
}

export class FireField {
  readonly cols: number;
  readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  readonly heat: Float32Array;
  /** Seconds of scorch left. */
  readonly scorch: Float32Array;
  /** The side whose fire it is, and the unit whose (an index into `sources`), for kill credit. */
  private readonly owner: Int16Array;
  private readonly source: Int16Array;
  private readonly sources: string[] = [];
  /** Cells burning or scorched, in the order they caught. */
  private active: number[] = [];
  private readonly listed: Uint8Array;
  /** Changes whenever something a watcher could see changes (see snapshot). */
  version = 0;

  constructor(field: Battlefield) {
    this.minX = field.bounds.minX;
    this.minZ = field.bounds.minZ;
    this.cols = Math.ceil(field.width / FIRE_CELL);
    this.rows = Math.ceil(field.depth / FIRE_CELL);
    const n = this.cols * this.rows;
    this.heat = new Float32Array(n);
    this.scorch = new Float32Array(n);
    this.owner = new Int16Array(n);
    this.source = new Int16Array(n);
    this.listed = new Uint8Array(n);
  }

  /** How many cells are burning or scorched. */
  get count(): number {
    return this.active.length;
  }

  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / FIRE_CELL);
    const j = Math.floor((z - this.minZ) / FIRE_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  /** The middle of a cell. */
  center(k: number): { x: number; z: number } {
    const i = k % this.cols;
    return { x: this.minX + (i + 0.5) * FIRE_CELL, z: this.minZ + ((k - i) / this.cols + 0.5) * FIRE_CELL };
  }

  /** Heat at a point (0 off the map). */
  heatAt(x: number, z: number): number {
    const k = this.cellAt(x, z);
    return k < 0 ? 0 : this.heat[k];
  }

  /** Pour `amount` of heat onto the ground round a point, most in the middle. */
  add(x: number, z: number, radius: number, amount: number, faction: number, source: string): void {
    let s = this.sources.indexOf(source);
    if (s < 0) s = this.sources.push(source) - 1;
    const r = Math.max(radius, FIRE_CELL * 0.5);
    const i0 = Math.floor((x - r - this.minX) / FIRE_CELL);
    const i1 = Math.floor((x + r - this.minX) / FIRE_CELL);
    const j0 = Math.floor((z - r - this.minZ) / FIRE_CELL);
    const j1 = Math.floor((z + r - this.minZ) / FIRE_CELL);
    for (let j = Math.max(0, j0); j <= Math.min(this.rows - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.cols - 1, i1); i++) {
        const cx = this.minX + (i + 0.5) * FIRE_CELL;
        const cz = this.minZ + (j + 0.5) * FIRE_CELL;
        const d = D.hypot(cx - x, cz - z);
        if (d > r + FIRE_CELL * 0.5) continue;
        const k = j * this.cols + i;
        this.heat[k] = Math.min(MAX_HEAT, this.heat[k] + amount * (1 - 0.5 * Math.min(1, d / r)));
        this.owner[k] = faction;
        this.source[k] = s;
        if (!this.listed[k]) {
          this.listed[k] = 1;
          this.active.push(k);
        }
      }
    }
    this.version++;
  }

  /** Cool every patch, and let cold scorch marks go. */
  cool(dt: number): void {
    if (this.active.length === 0) return;
    const keep = D.exp(-dt / COOL_TIME);
    const next: number[] = [];
    for (const k of this.active) {
      if (this.heat[k] >= LIT) this.scorch[k] = SCORCH_TIME;
      else this.scorch[k] -= dt;
      this.heat[k] = this.heat[k] * keep;
      if (this.heat[k] < 0.01) this.heat[k] = 0;
      if (this.heat[k] > 0 || this.scorch[k] > 0) next.push(k);
      else {
        this.listed[k] = 0;
        this.scorch[k] = 0;
      }
    }
    this.active = next;
    this.version++;
  }

  /** Who started the fire in a cell (for the burns' kill credit). */
  hit(k: number): Hit {
    return { source: this.sources[this.source[k]] ?? 'flameTrooper', faction: this.owner[k] };
  }

  owners(k: number): number {
    return this.owner[k];
  }

  /** The burning and scorched cells, for the page to draw: cell, heat, seconds of scorch left, in threes. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const k of this.active) out.push(k, Math.round(this.heat[k] * 100) / 100, Math.round(this.scorch[k] * 10) / 10);
    return out;
  }

  /** Take on a snapshot (the page's copy of a battle playing in the worker). */
  apply(snapshot: number[]): void {
    for (const k of this.active) {
      this.heat[k] = 0;
      this.scorch[k] = 0;
      this.listed[k] = 0;
    }
    this.active = [];
    for (let n = 0; n + 2 < snapshot.length; n += 3) {
      const k = snapshot[n];
      this.heat[k] = snapshot[n + 1];
      this.scorch[k] = snapshot[n + 2];
      this.listed[k] = 1;
      this.active.push(k);
    }
    this.version++;
  }

  /** Each burning or scorched cell, in order. */
  forEach(visit: (k: number, heat: number, scorch: number) => void): void {
    for (const k of this.active) visit(k, this.heat[k], this.scorch[k]);
  }
}

/**
 * Cools the fires, and burns what stands in them twice a second: enemies of
 * whoever lit it, on the ground. Hot ground burns, armour taking its share
 * as with any hit; white-hot ground burns straight through armour; scorched
 * ground just smoulders, which only really bothers infantry.
 */
export function fireSystem(ctx: SimContext): System {
  let burnAt = 0;
  return {
    name: 'fire',
    update(world, dt) {
      const fire = ctx.fire;
      if (fire.count === 0) return;
      fire.cool(dt);
      if (world.time < burnAt) return;
      burnAt = world.time + BURN_EVERY;
      for (const e of world.query(Unit, Health, Transform, Mover)) {
        if (MOVE_RULES[world.req(e, Mover).move].flies) continue;
        const t = world.req(e, Transform);
        const k = fire.cellAt(t.x, t.z);
        if (k < 0) continue;
        const heat = fire.heat[k];
        const scorch = fire.scorch[k];
        if (heat < LIT && scorch <= 0) continue;
        if (!ctx.sides.hostile(fire.owners(k), world.req(e, Faction).id)) continue;
        const damage = (heat >= LIT ? BURN * heat : SMOULDER) * BURN_EVERY;
        applyDamage(world, ctx, e, damage, fire.hit(k), heat >= WHITE_HOT);
      }
    },
  };
}
