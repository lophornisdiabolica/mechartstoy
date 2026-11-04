import { World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Battlefield } from '../../world/battlefield';
import { Armed, Faction, Health, Mover, Transform } from '../components';
import { fightingStrength } from '../offensive';

/** World units per strength-map cell. */
export const STRENGTH_CELL = 6;

/**
 * Where each side's fighting strength is (see fightingStrength), on a
 * coarse grid: ground strength (what holds ground: everything that isn't
 * flying), air (aircraft) and anti-air (whatever can shoot aircraft).
 * Outpost guards and armed buildings count for their side too.
 */
export class StrengthMap {
  readonly cols: number;
  readonly rows: number;
  /** Per side, per cell (row-major). */
  readonly ground: Float32Array[];
  readonly air: Float32Array[];
  readonly antiAir: Float32Array[];

  constructor(
    private readonly field: Battlefield,
    sides: number,
  ) {
    this.cols = Math.ceil(field.width / STRENGTH_CELL);
    this.rows = Math.ceil(field.depth / STRENGTH_CELL);
    const n = this.cols * this.rows;
    this.ground = Array.from({ length: sides }, () => new Float32Array(n));
    this.air = Array.from({ length: sides }, () => new Float32Array(n));
    this.antiAir = Array.from({ length: sides }, () => new Float32Array(n));
  }

  /** The cell a point is in. */
  cellAt(x: number, z: number): number {
    const i = Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.field.bounds.minX) / STRENGTH_CELL)));
    const j = Math.max(0, Math.min(this.rows - 1, Math.floor((z - this.field.bounds.minZ) / STRENGTH_CELL)));
    return j * this.cols + i;
  }

  /** Recount from scratch. */
  update(world: World): void {
    for (const a of [this.ground, this.air, this.antiAir]) for (const s of a) s.fill(0);
    for (const e of world.query(Armed, Health, Faction, Transform)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= this.ground.length) continue;
      const t = world.req(e, Transform);
      const k = this.cellAt(t.x, t.z);
      const s = fightingStrength(world, e);
      const mover = world.get(e, Mover);
      if (mover && MOVE_RULES[mover.move].flies) this.air[f][k] += s;
      else this.ground[f][k] += s;
      if (world.req(e, Armed).weapon.targets !== 'ground') this.antiAir[f][k] += s;
    }
  }

  /** A side's total of one layer within `radius` of a point. */
  near(layer: Float32Array[], side: number, x: number, z: number, radius: number): number {
    const { minX, minZ } = this.field.bounds;
    const i0 = Math.max(0, Math.floor((x - radius - minX) / STRENGTH_CELL));
    const i1 = Math.min(this.cols - 1, Math.floor((x + radius - minX) / STRENGTH_CELL));
    const j0 = Math.max(0, Math.floor((z - radius - minZ) / STRENGTH_CELL));
    const j1 = Math.min(this.rows - 1, Math.floor((z + radius - minZ) / STRENGTH_CELL));
    let sum = 0;
    const cells = layer[side];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) sum += cells[j * this.cols + i];
    return sum;
  }
}
