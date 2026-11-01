import { EventBus } from '../core/events';
import { GameEvents } from '../game/context';
import { Bounds } from '../world/battlefield';

/** Size of a heat cell, in world units. */
const CELL = 12;
/** Seconds for heat to fall to about a third: how long a fight stays "hot" after it stops. */
const COOL = 5;
/** Seconds between looks for a better fight. */
const LOOK_INTERVAL = 0.5;
/** Seconds to stay on a fight before moving to a hotter one, so the camera doesn't flit about. */
const MIN_DWELL = 7;
/** How much hotter another fight must be to move there. */
const SWITCH_RATIO = 1.6;
/** Below this share of the hottest fight, the current one is over and the camera moves on straight away. */
const FIZZLED = 0.15;

/** How much each kind of event says "something worth watching is happening here". */
const HEAT = { fired: 1, impact: 0.5, unitDestroyed: 4, buildingDamaged: 3, buildingDestroyed: 10 };

/**
 * Finds where the fighting is, for the spectator camera. Shots, hits and
 * deaths warm a coarse grid over the map, which cools over time; the
 * watch settles on the hottest area and follows it as it drifts, moving
 * to another fight only when that one is clearly bigger or this one is
 * over. Runs on sim time, so it holds still while the game is paused.
 *
 * Reads events only, so it can't affect the battle.
 */
export class FightWatch {
  private readonly cols: number;
  private readonly rows: number;
  private readonly heat: Float32Array;
  private sinceLook = 0;
  private dwell = 0;
  /** Cell the camera is watching, or -1 before the first fight. */
  private cell = -1;
  /** The point to look at, or null while nothing is happening. */
  focus: { x: number; z: number } | null = null;

  constructor(
    events: EventBus<GameEvents>,
    private readonly bounds: Bounds,
  ) {
    this.cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / CELL));
    this.rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / CELL));
    this.heat = new Float32Array(this.cols * this.rows);
    for (const kind of Object.keys(HEAT) as (keyof typeof HEAT)[]) {
      events.on(kind, (e) => this.warm(e.x, e.z, HEAT[kind]));
    }
  }

  /** Add heat at a point. */
  warm(x: number, z: number, amount: number): void {
    const i = this.cellAt(x, z);
    if (i >= 0) this.heat[i] += amount;
  }

  /** Advance by `dt` seconds of sim time. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.dwell += dt;
    this.sinceLook += dt;
    if (this.sinceLook < LOOK_INTERVAL) return;
    const decay = Math.exp(-this.sinceLook / COOL);
    this.sinceLook = 0;
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= decay;

    let best = -1;
    let bestHeat = 0;
    for (let i = 0; i < this.heat.length; i++) {
      const h = this.area(i);
      if (h > bestHeat) {
        bestHeat = h;
        best = i;
      }
    }
    if (best < 0 || bestHeat < 1) {
      // Nothing much happening anywhere: keep looking where we were.
      return;
    }
    // Follow the current fight as it drifts into a neighbouring cell.
    if (this.cell >= 0) this.cell = this.hottestNear(this.cell);
    const current = this.cell >= 0 ? this.area(this.cell) : 0;
    const over = current < bestHeat * FIZZLED;
    const better = this.dwell >= MIN_DWELL && bestHeat > current * SWITCH_RATIO;
    if (this.cell < 0 || over || better) {
      if (this.cell !== best) this.dwell = 0;
      this.cell = best;
    }
    this.focus = this.centre(this.cell);
  }

  private cellAt(x: number, z: number): number {
    const c = Math.floor((x - this.bounds.minX) / CELL);
    const r = Math.floor((z - this.bounds.minZ) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** Visit a cell and its neighbours. */
  private around(i: number, visit: (j: number) => void): void {
    const c0 = i % this.cols;
    const r0 = Math.floor(i / this.cols);
    for (let r = Math.max(0, r0 - 1); r <= Math.min(this.rows - 1, r0 + 1); r++) {
      for (let c = Math.max(0, c0 - 1); c <= Math.min(this.cols - 1, c0 + 1); c++) visit(r * this.cols + c);
    }
  }

  /** Heat of a cell and its neighbours: one fight usually spans a few cells. */
  private area(i: number): number {
    let sum = 0;
    this.around(i, (j) => (sum += this.heat[j]));
    return sum;
  }

  private hottestNear(i: number): number {
    let best = i;
    let bestHeat = this.area(i);
    this.around(i, (j) => {
      const h = this.area(j);
      if (h > bestHeat * 1.2) {
        bestHeat = h;
        best = j;
      }
    });
    return best;
  }

  /** Heat-weighted middle of a cell and its neighbours. */
  private centre(i: number): { x: number; z: number } {
    let sum = 0;
    let x = 0;
    let z = 0;
    this.around(i, (j) => {
      const h = this.heat[j];
      sum += h;
      x += h * ((j % this.cols) + 0.5);
      z += h * (Math.floor(j / this.cols) + 0.5);
    });
    return { x: this.bounds.minX + (x / sum) * CELL, z: this.bounds.minZ + (z / sum) * CELL };
  }
}
