import { System, World } from '../core/ecs';
import { MOVE_RULES } from '../world/moveClasses';
import { CellArea } from '../world/ground';
import { IceSheet } from '../world/traits';
import { Health, Mover, Targetable, Transform, Unit } from './components';
import { SimContext } from './context';
import { LIT } from './fire';

/*
 * The Frozen lake trait's ice (laid out in world/traits.ts). The ice is a
 * way across for everyone, but it only takes so much: each patch of it
 * takes strain from the weight standing on it (by size: a soldier's
 * nothing, a tank's a lot, a super unit's far more) and from fire and
 * shells bursting on it, and gets over strain slowly. Too much and the
 * patch gives way, cracking the patches round it, and what's on it goes
 * into the water: land units out of their depth drown. A broken patch
 * freezes over again a while later, once nothing's in it.
 *
 * Heavy classes go round the ice where they can (the ice ground's route
 * cost, see world/ground.ts), and the holes are water, which the routes
 * know about like any other.
 */

/** Seconds between ice updates. */
const TICK = 0.5;
/** Strain a patch takes before it gives way, and how fast it gets over strain (a second). */
const STRENGTH = 8;
const RECOVER = 1;
/** Strain a burning patch takes a second (it melts), and per point of a shell's damage bursting on it. */
const MELT = 5;
const SHELL = 0.03;
/** Strain a patch giving way puts on the patches beside it. */
const CRACK = 3;
/** Seconds before a hole freezes over again (once nothing's in it). */
const REFREEZE = 90;
/** Seconds between telling the ticker the ice broke. */
const TELL_EVERY = 20;

/** The ice on a frozen lake: each map cell's strain, and which are holes now. */
export class Ice {
  /** Map cells with ice (or a hole in it), by cell: index into `cells`, or -1. */
  readonly slot: Int32Array;
  readonly cells: number[] = [];
  readonly strain: Float32Array;
  /** When each hole froze over (0) or will freeze over again. */
  readonly refreezeAt: Float32Array;
  /** The ice's vertices in each cell's patch (the cell's corners), and their lake bed heights. */
  readonly patch: { verts: number[]; bed: number[] }[] = [];

  constructor(
    readonly sheet: IceSheet,
    readonly cols: number,
    rows: number,
  ) {
    this.slot = new Int32Array(cols * rows).fill(-1);
    const stride = cols + 1;
    sheet.verts.forEach((k, n) => {
      const i = k % stride;
      const j = (k - i) / stride;
      for (const [ci, cj] of [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]]) {
        if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
        const c = cj * cols + ci;
        if (this.slot[c] < 0) {
          this.slot[c] = this.cells.length;
          this.cells.push(c);
          this.patch.push({ verts: [], bed: [] });
        }
        const p = this.patch[this.slot[c]];
        p.verts.push(k);
        p.bed.push(sheet.bed[n]);
      }
    });
    this.strain = new Float32Array(this.cells.length);
    this.refreezeAt = new Float32Array(this.cells.length);
  }

  /** Whether a map cell is a hole in the ice now. */
  holeAt(cell: number): boolean {
    const s = this.slot[cell];
    return s >= 0 && this.refreezeAt[s] > 0;
  }

  /** A shell burst on the ice: strain on the patches it lands on. */
  blast(ctx: SimContext, x: number, z: number, damage: number, splash: number): void {
    const field = ctx.field;
    const r = Math.max(splash, 0.5);
    const a = field.areaAround(x, z, r);
    for (let j = a.j0; j <= a.j1; j++) {
      for (let i = a.i0; i <= a.i1; i++) {
        const s = this.slot[j * this.cols + i];
        if (s >= 0 && this.refreezeAt[s] === 0) this.strain[s] += damage * SHELL;
      }
    }
  }
}

/** Strains, breaks and refreezes the ice. */
export function iceSystem(ctx: SimContext): System {
  const ice = ctx.ice!;
  const field = ctx.field;
  const { cols, rows } = field.config;
  const level = ice.sheet.level;
  let acc = 0;
  let toldAt = -Infinity;
  const weight = new Float32Array(ice.cells.length);
  const occupied = new Uint8Array(ice.cells.length);
  return {
    name: 'ice',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      // Weight on each patch.
      weight.fill(0);
      occupied.fill(0);
      for (const e of world.query(Unit, Transform)) {
        const move = world.get(e, Mover)?.move;
        if (!move || MOVE_RULES[move].flies) continue;
        const t = world.req(e, Transform);
        if (!field.contains(t.x, t.z)) continue;
        const [i, j] = field.cellAt(t.x, t.z);
        const s = ice.slot[j * cols + i];
        if (s < 0) continue;
        occupied[s] = 1;
        // (Boats in a hole weigh nothing on the ice.)
        if (MOVE_RULES[move].minDepth > 0) continue;
        const r = world.req(e, Unit).def.radius;
        weight[s] += r * r;
      }
      const breaking: number[] = [];
      for (let s = 0; s < ice.cells.length; s++) {
        if (ice.refreezeAt[s] > 0) continue;
        let strain = ice.strain[s] + (weight[s] - RECOVER) * step;
        // Fire on it melts it.
        const c = ice.cells[s];
        const cs = field.config.cellSize;
        const x = field.bounds.minX + ((c % cols) + 0.5) * cs;
        const z = field.bounds.minZ + (Math.floor(c / cols) + 0.5) * cs;
        if (ctx.fire.count > 0 && ctx.fire.heatAt(x, z) >= LIT) strain += MELT * step;
        ice.strain[s] = Math.max(0, strain);
        if (ice.strain[s] > STRENGTH) breaking.push(s);
      }
      let area: CellArea | null = null;
      const touch = (c: number) => {
        const i = c % cols;
        const j = (c - i) / cols;
        area = area ? { i0: Math.min(area.i0, i - 1), j0: Math.min(area.j0, j - 1), i1: Math.max(area.i1, i + 1), j1: Math.max(area.j1, j + 1) } : { i0: i - 1, j0: j - 1, i1: i + 1, j1: j + 1 };
      };
      for (const s of breaking) {
        ice.refreezeAt[s] = world.time + REFREEZE;
        ice.strain[s] = 0;
        const p = ice.patch[s];
        p.verts.forEach((k, n) => (field.heights[k] = p.bed[n]));
        touch(ice.cells[s]);
        // It cracks the ice round it.
        const c = ice.cells[s];
        for (const n of [c - 1, c + 1, c - cols, c + cols]) {
          if (n < 0 || n >= cols * rows) continue;
          const ns = ice.slot[n];
          if (ns >= 0 && ice.refreezeAt[ns] === 0) ice.strain[ns] += CRACK;
        }
      }
      // Holes freeze over again a while later, once nothing's in them.
      for (let s = 0; s < ice.cells.length; s++) {
        if (ice.refreezeAt[s] === 0 || world.time < ice.refreezeAt[s] || occupied[s]) continue;
        ice.refreezeAt[s] = 0;
        // (Only its corners that aren't still open in a hole beside it.)
        for (const k of ice.patch[s].verts) if (!openBeside(ice, k, cols, rows)) field.heights[k] = level;
        touch(ice.cells[s]);
      }
      if (area) {
        const a = area as CellArea;
        field.changed({ i0: Math.max(0, a.i0), j0: Math.max(0, a.j0), i1: Math.min(cols - 1, a.i1), j1: Math.min(rows - 1, a.j1) });
      }
      if (breaking.length > 0) {
        const drowned = drown(world, ctx, ice);
        if (drowned > 0 && world.time >= toldAt + TELL_EVERY) {
          toldAt = world.time;
          const c = ice.cells[breaking[0]];
          const cs = field.config.cellSize;
          ctx.events.emit('iceBroke', { x: field.bounds.minX + ((c % cols) + 0.5) * cs, z: field.bounds.minZ + (Math.floor(c / cols) + 0.5) * cs, drowned });
        }
      }
    },
  };
}

/** Whether a vertex is a corner of a hole in the ice (which keeps it open). */
function openBeside(ice: Ice, k: number, cols: number, rows: number): boolean {
  const stride = cols + 1;
  const i = k % stride;
  const j = (k - i) / stride;
  for (const [ci, cj] of [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]]) {
    if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
    if (ice.holeAt(cj * cols + ci)) return true;
  }
  return false;
}

/** Land units in a hole out of their depth drown. How many. */
function drown(world: World, ctx: SimContext, ice: Ice): number {
  const field = ctx.field;
  let n = 0;
  for (const e of world.query(Unit, Transform)) {
    if (world.get(e, Targetable)?.kind !== 'unit') continue;
    const move = world.get(e, Mover)?.move;
    if (!move) continue;
    const rules = MOVE_RULES[move];
    if (rules.flies || rules.maxDepth > 2) continue;
    const t = world.req(e, Transform);
    if (!field.contains(t.x, t.z)) continue;
    const [i, j] = field.cellAt(t.x, t.z);
    if (!ice.holeAt(j * field.config.cols + i) || field.deckAt(t.x, t.z) !== null) continue;
    const h = world.get(e, Health);
    if (!h || h.hp <= 0) continue;
    if (field.seaLevel - field.heightAt(t.x, t.z) > rules.maxDepth + 0.1) {
      h.hp = 0;
      ctx.bridges.drowned.add(e);
      n++;
    }
  }
  return n;
}
