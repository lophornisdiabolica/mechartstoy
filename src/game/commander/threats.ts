import { World } from '../../core/ecs';
import { Battlefield } from '../../world/battlefield';
import { MOVE_RULES, MoveClass } from '../../world/moveClasses';
import { Ai, Armed, Building, Faction, Guard, Health, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { LaneId } from '../lanes';
import { fightingStrength } from '../offensive';
import { UnitDef, WeaponDef } from '../units';
import { ANTI_AIR } from './roles';
import { STRENGTH_CELL } from './strength';

/*
 * Keeping units out of where they're weak. Each side's Commander keeps a
 * map of how dangerous every part of the field is to each kind of unit:
 * artillery and anything that sprays to infantry, hard hitters to vehicles,
 * flak to aircraft, spread over each weapon's reach. With it:
 * - lanes: at the start of each attack, a squad whose lane is much more
 *   dangerous to its kind than another lane takes the safer one, so
 *   infantry go round the side the enemy's artillery covers;
 * - detours: on the march, a squad about to walk into ground that's more
 *   dangerous to it than it is strong swings out to whichever side is
 *   safer, then carries on (aircraft go round flak the same way).
 * Squads already fighting don't detour. The rally flag and stances override
 * it, like every other Commander job.
 */

export type ThreatKind = 'infantry' | 'vehicle' | 'air';
/** The kinds, plus 'any': every weapon at full weight, the yardstick a counter stands out against. */
type Layer = ThreatKind | 'any';
const LAYERS: Layer[] = ['infantry', 'vehicle', 'air', 'any'];
export const THREAT_KINDS: ThreatKind[] = ['infantry', 'vehicle', 'air'];

/** Most reach a weapon's danger is spread over (the longest artillery reaches about this far). */
const MOST_REACH = 42;
/** Margin added to a weapon's range, so squads see danger coming before they're in it. */
const REACH_PAD = 10;
/*
 * What's avoided is a kind's *counters*, not the enemy as a whole: the
 * danger to a kind beyond its usual share of the enemy's danger (its
 * "excess", see ThreatMap.excess). Artillery dug in on one lane, flak
 * round one outpost: those stand out. An enemy army that's simply strong
 * everywhere doesn't: there's no going round that.
 */
/** A lane is given up when its excess danger is at least this, for one with this much less. */
const LANE_PAD = 40;
/** How far ahead a marching squad looks for danger, and how often along the way. */
const LOOK_AHEAD = 45;
const SAMPLE_STEP = 5;
/** A squad detours when the danger ahead is more than this share of its own strength... */
const WEAK = 0.8;
/** ...and a detour cuts the danger to at most this share of going straight on. */
const BETTER = 0.6;
/** How far out to the side detours swing. */
const SWINGS = [16, 28];
/** A squad within this of its detour point has reached it. */
const REACHED = 6;

/** The kind of unit a unit counts as for danger: anything flying is an aircraft, foot soldiers are infantry, the rest vehicles. */
export function threatKindOf(def: UnitDef, move: MoveClass): ThreatKind {
  if (MOVE_RULES[move].flies) return 'air';
  return def.category === 'infantry' ? 'infantry' : 'vehicle';
}

/** How much a weapon endangers each kind of unit, 0 to 1. */
export function menace(w: WeaponDef, id: string): Record<ThreatKind, number> {
  const ground = w.targets !== 'air';
  return {
    // Shells lobbed in, big blasts and flame are what infantry should keep away from; a tank's gun less so.
    infantry: !ground ? 0 : w.arc || w.splash >= 2 || w.projectile === 'flame' ? 1 : w.damage <= 8 ? 0.5 : 0.3,
    vehicle: !ground ? 0 : w.damage >= 35 ? 1 : 0.2,
    air: ANTI_AIR.has(id) ? 1 : w.targets !== 'ground' ? 0.5 : 0,
  };
}

/** Each side's danger to each kind of unit, on the strength map's grid. */
export class ThreatMap {
  readonly cols: number;
  readonly rows: number;
  /** Per kind (and 'any'), per side: the danger that side's weapons pose there (row-major cells). */
  readonly layers: Record<Layer, Float32Array[]>;

  constructor(
    private readonly field: Battlefield,
    sides: number,
  ) {
    this.cols = Math.ceil(field.width / STRENGTH_CELL);
    this.rows = Math.ceil(field.depth / STRENGTH_CELL);
    const n = this.cols * this.rows;
    const make = () => Array.from({ length: sides }, () => new Float32Array(n));
    this.layers = { infantry: make(), vehicle: make(), air: make(), any: make() };
    const zeros = () => new Array<number>(sides).fill(0);
    this.totals = { infantry: zeros(), vehicle: zeros(), air: zeros(), any: zeros() };
  }

  /** Per layer, per side: its danger summed over the whole field (for each kind's usual share). */
  private totals: Record<Layer, number[]>;

  /** Recount from scratch: every armed unit and building spreads its danger over its reach. */
  update(world: World): void {
    for (const k of LAYERS) for (const l of this.layers[k]) l.fill(0);
    for (const k of LAYERS) this.totals[k].fill(0);
    const { minX, minZ } = this.field.bounds;
    for (const e of world.query(Armed, Health, Faction, Transform)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= this.layers.infantry.length) continue;
      const w = world.req(e, Armed).weapon;
      const id = world.get(e, Unit)?.def.id ?? world.get(e, Building)?.def.id ?? '';
      const m = menace(w, id);
      const s = fightingStrength(world, e);
      if (s <= 0) continue;
      const t = world.req(e, Transform);
      const reach = Math.min(MOST_REACH, w.range + REACH_PAD);
      const i0 = Math.max(0, Math.floor((t.x - reach - minX) / STRENGTH_CELL));
      const i1 = Math.min(this.cols - 1, Math.floor((t.x + reach - minX) / STRENGTH_CELL));
      const j0 = Math.max(0, Math.floor((t.z - reach - minZ) / STRENGTH_CELL));
      const j1 = Math.min(this.rows - 1, Math.floor((t.z + reach - minZ) / STRENGTH_CELL));
      const inf = this.layers.infantry[f];
      const veh = this.layers.vehicle[f];
      const air = this.layers.air[f];
      const any = this.layers.any[f];
      for (const k of THREAT_KINDS) this.totals[k][f] += s * m[k];
      this.totals.any[f] += s;
      for (let j = j0; j <= j1; j++) {
        const cz = minZ + (j + 0.5) * STRENGTH_CELL - t.z;
        for (let i = i0; i <= i1; i++) {
          const cx = minX + (i + 0.5) * STRENGTH_CELL - t.x;
          if (cx * cx + cz * cz > reach * reach) continue;
          const k = j * this.cols + i;
          inf[k] += s * m.infantry;
          veh[k] += s * m.vehicle;
          air[k] += s * m.air;
          any[k] += s;
        }
      }
    }
  }

  /** How dangerous a point is to a side's units of one kind: its enemies' danger there, added up. */
  danger(ctx: SimContext, side: number, kind: Layer, x: number, z: number): number {
    const { minX, minZ } = this.field.bounds;
    const i = Math.floor((x - minX) / STRENGTH_CELL);
    const j = Math.floor((z - minZ) / STRENGTH_CELL);
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return 0;
    const k = j * this.cols + i;
    let sum = 0;
    for (const g of ctx.sides.enemiesOf(side)) sum += this.layers[kind][g]?.[k] ?? 0;
    return sum;
  }

  /** Of all the danger a side's enemies pose, the share that's danger to this kind. */
  usualShare(ctx: SimContext, side: number, kind: ThreatKind): number {
    let mine = 0;
    let all = 0;
    for (const g of ctx.sides.enemiesOf(side)) {
      mine += this.totals[kind][g] ?? 0;
      all += this.totals.any[g] ?? 0;
    }
    return all > 0 ? mine / all : 0;
  }

  /**
   * How much more dangerous a point is to this kind than the enemy's usual
   * mix would make it: the danger to it, less its usual share of all the
   * danger there. Positive where its counters are gathered.
   */
  excess(ctx: SimContext, side: number, kind: ThreatKind, share: number, x: number, z: number): number {
    return this.danger(ctx, side, kind, x, z) - share * this.danger(ctx, side, 'any', x, z);
  }

  /** The worst excess danger (see excess) along the way from one point to another, looking every SAMPLE_STEP. */
  along(ctx: SimContext, side: number, kind: ThreatKind, ax: number, az: number, bx: number, bz: number, share = this.usualShare(ctx, side, kind)): number {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / SAMPLE_STEP));
    let worst = 0;
    for (let n = 1; n <= steps; n++) {
      const d = this.excess(ctx, side, kind, share, ax + ((bx - ax) * n) / steps, az + ((bz - az) * n) / steps);
      if (d > worst) worst = d;
    }
    return worst;
  }
}

/** A marching squad, as the Commander sees it for detours. */
interface Marcher {
  side: number;
  kind: ThreatKind;
  move: MoveClass;
  strength: number;
  x: number;
  z: number;
  units: number;
  /** Any of its units fighting: no detours then. */
  fighting: boolean;
  /** Where it's heading: its next lane waypoint, or its objective in the enemy base. */
  toX: number;
  toZ: number;
}

/** Lane choices and detours that keep squads out of where they're weak, refreshed with the Commander's picture. */
export class Avoidance {
  private detours = new Map<number, { x: number; z: number }>();
  /** Per side, target and kind: each lane's danger, worked out when first asked for after an update. */
  private lanes = new Map<string, number[]>();
  /** For the panel and tests: per side, squads on a detour now, and squads ever moved to a safer lane. */
  detouring: number[] = [];
  relaned: number[] = [];
  /** Per side, each detour as the overlay draws it: from the squad to the point it's going round by. */
  paths: { fromX: number; fromZ: number; x: number; z: number }[][] = [];

  /** Where a squad should go first to stay out of danger, if anywhere. */
  detourFor(squad: number): { x: number; z: number } | undefined {
    return this.detours.get(squad);
  }

  /**
   * The lane a squad of this kind should take: the one it was given, unless
   * that's much more dangerous to it than the safest lane, in which case the
   * safest.
   */
  lane(ctx: SimContext, side: number, target: number, lane: LaneId, kind: ThreatKind): LaneId {
    if (!ctx.settings.armies.avoidance) return lane;
    const map = ctx.commander.threats;
    const key = `${side}:${target}:${kind}`;
    let excess = this.lanes.get(key);
    if (!excess) {
      // From the rally point to the lane's last waypoint: the enemy base itself is dangerous whichever way you come.
      const rally = ctx.lanes.rally(side, target, 0);
      const share = map.usualShare(ctx, side, kind);
      excess = ctx.lanes.lanes(side, target).map((points) => {
        let w = 0;
        let from = rally;
        for (const p of points) {
          w = Math.max(w, map.along(ctx, side, kind, from.x, from.z, p.x, p.z, share));
          from = p;
        }
        return w;
      });
      this.lanes.set(key, excess);
    }
    if (lane >= excess.length || excess[lane] < LANE_PAD) return lane;
    let best = lane;
    for (let l = 0; l < excess.length; l++) if (excess[l] < excess[best]) best = l;
    if (excess[best] > excess[lane] - LANE_PAD) return lane;
    this.relaned[side] = (this.relaned[side] ?? 0) + 1;
    return best;
  }

  update(world: World, ctx: SimContext): void {
    this.lanes.clear();
    const previous = this.detours;
    this.detours = new Map();
    this.detouring = new Array(ctx.sides.count).fill(0);
    this.paths = ctx.sides.teams.map(() => []);
    if (!ctx.settings.armies.avoidance) return;
    const time = world.time;
    const marching = ctx.sides.teams.map((_, side) => {
      const orders = ctx.orders[side];
      return !ctx.sides.eliminated[side] && orders.stance === 'auto' && orders.rally === null && !ctx.sides.recalling[side] && ctx.offensive.attacking(side, time);
    });
    if (!marching.some(Boolean)) return;

    // Every squad of a side on the march, in a fixed order.
    const squads = new Map<number, Marcher>();
    for (const e of world.query(Ai, Unit, Faction, Transform, Mover)) {
      if (world.has(e, Guard)) continue;
      const side = world.req(e, Faction).id;
      if (side < 0 || side >= ctx.sides.count || !marching[side]) continue;
      const def = world.req(e, Unit).def;
      const move = world.req(e, Mover).move;
      if (def.builds || move === 'naval') continue;
      const ai = world.req(e, Ai);
      const t = world.req(e, Transform);
      let s = squads.get(ai.squad);
      if (!s) {
        if (ai.target < 0) continue;
        const next = ctx.lanes.nextWaypoint(side, ai.target, ai.lane, t.x, t.z);
        s = { side, kind: threatKindOf(def, move), move, strength: 0, x: 0, z: 0, units: 0, fighting: false, toX: next?.x ?? ai.objectiveX, toZ: next?.z ?? ai.objectiveZ };
        squads.set(ai.squad, s);
      }
      s.strength += fightingStrength(world, e);
      s.x += t.x;
      s.z += t.z;
      s.units++;
      const armed = world.get(e, Armed);
      if (armed && armed.target !== null && world.isAlive(armed.target)) s.fighting = true;
    }

    const map = ctx.commander.threats;
    for (const [squad, s] of squads) {
      if (s.fighting) continue;
      const x = s.x / s.units;
      const z = s.z / s.units;
      // Look ahead at most LOOK_AHEAD along the way.
      const len = Math.hypot(s.toX - x, s.toZ - z);
      if (len < REACHED) continue;
      const k = Math.min(1, LOOK_AHEAD / len);
      const ax = x + (s.toX - x) * k;
      const az = z + (s.toZ - z) * k;
      // Only go round counters to its kind that outgun it (see ThreatMap.excess).
      const straight = map.along(ctx, s.side, s.kind, x, z, ax, az);
      if (straight <= s.strength * WEAK) continue;
      // Keep a detour it's still on its way to, if it's still worth it.
      const kept = previous.get(squad);
      const cost = (px: number, pz: number) => Math.max(map.along(ctx, s.side, s.kind, x, z, px, pz), map.along(ctx, s.side, s.kind, px, pz, ax, az));
      if (kept && Math.hypot(kept.x - x, kept.z - z) > REACHED && cost(kept.x, kept.z) < straight * BETTER) {
        this.detours.set(squad, kept);
        this.detouring[s.side]++;
        this.paths[s.side].push({ fromX: x, fromZ: z, x: kept.x, z: kept.z });
        continue;
      }
      // Otherwise swing out to whichever side is safest, if any is safe enough.
      const nx = -(az - z) / (len * k);
      const nz = (ax - x) / (len * k);
      const mx = (x + ax) / 2;
      const mz = (z + az) / 2;
      const grid = ctx.navs.for(s.move);
      let best: { x: number; z: number } | null = null;
      let bestCost = straight * BETTER;
      for (const swing of SWINGS) {
        for (const sign of [1, -1]) {
          const px = mx + nx * swing * sign;
          const pz = mz + nz * swing * sign;
          if (!ctx.field.contains(px, pz, 4) || !grid.terrainAllowsAt(px, pz)) continue;
          const c = cost(px, pz);
          if (c < bestCost) {
            bestCost = c;
            best = { x: px, z: pz };
          }
        }
      }
      if (best) {
        this.detours.set(squad, best);
        this.detouring[s.side]++;
        this.paths[s.side].push({ fromX: x, fromZ: z, x: best.x, z: best.z });
      }
    }
  }
}

