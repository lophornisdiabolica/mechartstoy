import { Entity, System, World } from '../core/ecs';
import { Battlefield } from '../world/battlefield';
import { MOVE_RULES } from '../world/moveClasses';
import { Armed, Arsenal, Building, Construction, Faction, Mover, Transform, Unit, Veiled } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';

/**
 * Veil's haze and stealth.
 *
 * Haze: smoke shells (WeaponDef.smoke) and smoke stacks (UnitDef.smokes,
 * BuildingDef.smokes) lay a thin, low haze on a coarse grid, which thins
 * out on its own. It hides nothing, but a shot whose line runs through
 * another side's haze goes wild (see hazeSpread): shots into it and out of
 * it miss a lot, scattering round their targets. The side that laid it
 * shoots through its own haze as if it were clear (thermal sights), which
 * is what makes it Veil's.
 *
 * Stealth (UnitDef.stealth): a unit that hasn't fired for a while fades
 * out of sight: enemies can't pick it out from further than CLOSE, unless
 * one of their spotters (towers' and copters' spotting, see targeting.ts)
 * has it in its radius. Firing gives it away at once. Some only fade while
 * they're in cover (`cover`: in a forest, by a building, or in their own
 * side's haze), moving or not.
 *
 * Kept per cell, only for cells with haze in them, so a battle without
 * Veil costs nothing (like frost.ts).
 */

export const SMOKE_CELL = 1.5;
/** Haze at which a cell counts: thick enough to throw shots off, or to hide a shade. */
export const THICK = 1;
const MAX_SMOKE = 10;
/** Smoke lost per second as it thins. */
const THIN = 0.5;
/** Spread (see WeaponDef.spread) a shot through haze picks up, at its worst. */
const HAZE_SPREAD = 0.35;
/** Depth of haze along a shot's line, world units, at which it throws the shot off at its worst. */
const HAZE_FULL = 3;
/** Anything this close (edge to edge) can be seen whatever the stealth. */
export const CLOSE = 4;
/** How near a building (edge to edge) a unit in `cover` has to be to hide by it. */
const BY_BUILDING = 1.5;

export class SmokeField {
  readonly cols: number;
  readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  readonly smoke: Float32Array;
  private readonly owner: Int16Array;
  private active: number[] = [];
  private readonly listed: Uint8Array;
  /** Changes whenever the smoke changes (see the mirror's snapshot). */
  version = 0;

  constructor(field: Battlefield) {
    this.minX = field.bounds.minX;
    this.minZ = field.bounds.minZ;
    this.cols = Math.ceil(field.width / SMOKE_CELL);
    this.rows = Math.ceil(field.depth / SMOKE_CELL);
    const n = this.cols * this.rows;
    this.smoke = new Float32Array(n);
    this.owner = new Int16Array(n);
    this.listed = new Uint8Array(n);
  }

  get count(): number {
    return this.active.length;
  }

  cellAt(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / SMOKE_CELL);
    const j = Math.floor((z - this.minZ) / SMOKE_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1;
    return j * this.cols + i;
  }

  center(k: number): { x: number; z: number } {
    const i = k % this.cols;
    return { x: this.minX + (i + 0.5) * SMOKE_CELL, z: this.minZ + ((k - i) / this.cols + 0.5) * SMOKE_CELL };
  }

  /** Smoke at a point (0 off the map). */
  at(x: number, z: number): number {
    if (this.active.length === 0) return 0;
    const k = this.cellAt(x, z);
    return k < 0 ? 0 : this.smoke[k];
  }

  /** Lay `amount` of smoke round a point, most in the middle. */
  add(x: number, z: number, radius: number, amount: number, faction: number): void {
    const r = Math.max(radius, SMOKE_CELL * 0.5);
    const i0 = Math.max(0, Math.floor((x - r - this.minX) / SMOKE_CELL));
    const i1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / SMOKE_CELL));
    const j0 = Math.max(0, Math.floor((z - r - this.minZ) / SMOKE_CELL));
    const j1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / SMOKE_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = this.minX + (i + 0.5) * SMOKE_CELL;
        const cz = this.minZ + (j + 0.5) * SMOKE_CELL;
        const d = D.hypot(cx - x, cz - z);
        if (d > r + SMOKE_CELL * 0.5) continue;
        const k = j * this.cols + i;
        this.smoke[k] = Math.min(MAX_SMOKE, this.smoke[k] + amount * (1 - 0.5 * Math.min(1, d / r)));
        this.owner[k] = faction;
        if (!this.listed[k]) {
          this.listed[k] = 1;
          this.active.push(k);
        }
      }
    }
    this.version++;
  }

  /**
   * How much haze a shot from (x0, z0) to (x1, z1) runs through that isn't
   * its own side's (or an ally's), world units.
   */
  depth(ctx: SimContext, x0: number, z0: number, x1: number, z1: number, shooter: number): number {
    if (this.active.length === 0) return 0;
    const len = D.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (SMOKE_CELL * 0.5)));
    const step = len / steps;
    let thick = 0;
    for (let s = 0; s <= steps; s++) {
      const k = this.cellAt(x0 + ((x1 - x0) * s) / steps, z0 + ((z1 - z0) * s) / steps);
      if (k < 0 || this.smoke[k] < THICK || ctx.sides.allied(this.owner[k], shooter)) continue;
      thick += step;
      if (thick >= HAZE_FULL) break;
    }
    return thick;
  }

  /** Whether a point is in side `faction`'s own (or an ally's) haze. */
  ownAt(ctx: SimContext, x: number, z: number, faction: number): boolean {
    if (this.active.length === 0) return false;
    const k = this.cellAt(x, z);
    return k >= 0 && this.smoke[k] >= THICK && ctx.sides.allied(this.owner[k], faction);
  }

  thin(dt: number): void {
    if (this.active.length === 0) return;
    const next: number[] = [];
    for (const k of this.active) {
      this.smoke[k] -= THIN * dt;
      if (this.smoke[k] > 0) next.push(k);
      else {
        this.smoke[k] = 0;
        this.listed[k] = 0;
      }
    }
    this.active = next;
    this.version++;
  }

  /** The smoky cells, for the page: cell, smoke, owner, in threes. */
  snapshot(): number[] {
    const out: number[] = [];
    for (const k of this.active) out.push(k, Math.round(this.smoke[k] * 10) / 10, this.owner[k]);
    return out;
  }

  apply(snapshot: number[]): void {
    for (const k of this.active) {
      this.smoke[k] = 0;
      this.listed[k] = 0;
    }
    this.active = [];
    for (let n = 0; n + 2 < snapshot.length; n += 3) {
      const k = snapshot[n];
      this.smoke[k] = snapshot[n + 1];
      this.owner[k] = snapshot[n + 2];
      this.listed[k] = 1;
      this.active.push(k);
    }
    this.version++;
  }

  forEach(visit: (k: number, smoke: number) => void): void {
    for (const k of this.active) visit(k, this.smoke[k]);
  }
}

/** Something that spots for its side (see targeting.ts): it sees stealthy units in its radius. */
export interface Eye {
  x: number;
  z: number;
  radius: number;
  faction: number;
}

/**
 * Whether a unit of side `viewer` can pick out `target`, at `d` from it,
 * edge to edge: not when it's stealthed with none of the viewer's side's
 * spotters on it, unless it's close.
 */
export function canSee(world: World, ctx: SimContext, viewer: number, target: Entity, d: number, eyes: readonly Eye[]): boolean {
  if (d <= CLOSE || !world.get(target, Veiled)?.hidden) return true;
  const tt = world.req(target, Transform);
  return eyes.some((s) => ctx.sides.allied(s.faction, viewer) && D.sq(s.x - tt.x) + D.sq(s.z - tt.z) <= s.radius * s.radius);
}

/**
 * Extra spread for a shot of side `shooter` from (x0, z0) at (x1, z1): the
 * more of another side's haze it runs through, the wilder it goes (0 with
 * no haze on the map, so other battles are untouched).
 */
export function hazeSpread(ctx: SimContext, x0: number, z0: number, x1: number, z1: number, shooter: number): number {
  if (ctx.smoke.count === 0) return 0;
  return HAZE_SPREAD * Math.min(1, ctx.smoke.depth(ctx, x0, z0, x1, z1, shooter) / HAZE_FULL);
}

/** Whether a unit is in cover a `cover` stealth unit hides in: a forest, by a building, or its own side's haze. */
function inCover(world: World, ctx: SimContext, e: Entity, x: number, z: number): boolean {
  if (ctx.field.woods.hasTreesAt(x, z)) return true;
  const faction = world.req(e, Faction).id;
  if (ctx.smoke.ownAt(ctx, x, z, faction)) return true;
  let by = false;
  ctx.grid.forEachNear(x, z, BY_BUILDING + 6, (_other, d2, body) => {
    if (by || !body.building) return;
    if (Math.sqrt(d2) - (body.collider?.radius ?? body.building.def.radius) <= BY_BUILDING) by = true;
  });
  return by;
}

/** How fast a `still` stealth unit can be going and still count as still. */
const STILL = 0.05;

/**
 * Thins the haze, lets smoke stacks breathe it out (a little every tick,
 * so it stays steady rather than pulsing), and works out which stealthy
 * units have faded from sight (see UnitDef.stealth).
 */
export function smokeSystem(ctx: SimContext): System {
  return {
    name: 'smoke',
    update(world, dt) {
      const smoke = ctx.smoke;
      if (smoke.count > 0) smoke.thin(dt);
      for (const e of world.query(Veiled, Unit, Transform)) {
        const stealth = world.req(e, Unit).def.stealth;
        if (!stealth) continue;
        const t = world.req(e, Transform);
        const veiled = world.req(e, Veiled);
        if (stealth.haze && ctx.smoke.ownAt(ctx, t.x, t.z, world.req(e, Faction).id)) veiled.hidden = true;
        else if (world.time - firedAt(world, e) < stealth.after) veiled.hidden = false;
        else if (stealth.still && D.hypot(t.x - t.px, t.z - t.pz) > STILL * dt * 30) veiled.hidden = false;
        else veiled.hidden = !stealth.cover || inCover(world, ctx, e, t.x, t.z);
      }
      for (const e of world.query(Unit, Transform, Faction)) {
        const puff = world.req(e, Unit).def.smokes;
        if (!puff) continue;
        const m = world.get(e, Mover);
        if (m && MOVE_RULES[m.move].flies) continue;
        const t = world.req(e, Transform);
        smoke.add(t.x, t.z, puff.radius, puff.rate * dt, world.req(e, Faction).id);
      }
      for (const e of world.query(Building, Transform, Faction)) {
        const puff = world.req(e, Building).def.smokes;
        if (!puff || world.has(e, Construction)) continue;
        const t = world.req(e, Transform);
        smoke.add(t.x, t.z, puff.radius, puff.rate * dt, world.req(e, Faction).id);
      }
    },
  };
}

/** When any of a unit's weapons last fired. */
function firedAt(world: World, e: Entity): number {
  let at = world.get(e, Armed)?.firedAt ?? -Infinity;
  for (const a of world.get(e, Arsenal)?.arms ?? []) at = Math.max(at, a.firedAt);
  return at;
}
