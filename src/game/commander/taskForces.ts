import { Entity, World } from '../../core/ecs';
import { Ai, Faction, Guard, Health, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { fightingStrength } from '../offensive';
import { CAPTURE_RADIUS } from '../outposts';
import { MAP_SIZES } from '../settings';
import { ANTI_AIR } from './roles';

/*
 * Task forces (Commander step 2): between attacks, a side can send a few
 * squads off on a job of their own while the rest of its army masses for
 * the next team attack. A job is taking an outpost the side's team doesn't
 * hold, or holding one of its own outposts that an enemy is taking. When the
 * team attacks, every task force rejoins the attack, as before.
 *
 * The rally flag and a stance other than auto override task forces, like
 * everything else the AI decides, and so does an attack on the side's base.
 */

/** Most task forces a side runs at once. */
const MOST_FORCES = 2;
/** A force needs this many times the enemy strength at its outpost (garrison, guards and armies)... */
const TAKE_MARGIN = 1.6;
/** ...and at least this much strength (about two tanks), so it's worth sending. */
const LEAST_FORCE = 70;
/** How far round an outpost enemies count as defending it. */
const DEFENCE_RADIUS = CAPTURE_RADIUS + 10;
/** A force is spent, and comes back, once it's down to this share of the strength it set out with. */
const SPENT = 0.45;
/** Seconds (on a medium map) a force gets to take its outpost before it gives up and comes back. */
const TIMEOUT = 100;
/** Seconds (on a medium map) after a force at an outpost is spent or gives up before the side tries there again, so it doesn't feed squads in a few at a time. */
const COOLDOWN = 45;
/** Cost per world unit of distance when picking an outpost, in strength (so near outposts come first). */
const DISTANCE_COST = 0.6;

export type TaskKind = 'take' | 'hold';

/** A few squads sent off together on one job. */
export interface TaskForce {
  id: number;
  side: number;
  kind: TaskKind;
  /** The outpost it's taking or holding. */
  outpost: number;
  /** Its squads (see Ai.squad). */
  squads: number[];
  /** Strength it set out with, and what's left. */
  launch: number;
  strength: number;
  /** Sim time it set out. */
  since: number;
  /** Where its units are, on average. */
  x: number;
  z: number;
}

/** What a squad counts for when forces are picked: its side, strength and where it is. */
interface SquadInfo {
  side: number;
  strength: number;
  x: number;
  z: number;
  units: number;
  /** Whether it has flak in it (see roles.ts). */
  flak: boolean;
  /** Boats and super units stay with the main army (outposts are on land, and escorting the super unit is a later step). */
  free: boolean;
}

/** Every squad in the battle (outpost guards aside), in a fixed order. */
function squadsOf(world: World): Map<number, SquadInfo> {
  const out = new Map<number, SquadInfo>();
  for (const e of world.query(Ai, Unit, Faction, Transform, Health)) {
    if (world.has(e, Guard)) continue;
    const side = world.req(e, Faction).id;
    if (side < 0) continue;
    const squad = world.req(e, Ai).squad;
    const t = world.req(e, Transform);
    const def = world.req(e, Unit).def;
    const move = world.get(e, Mover)?.move ?? def.move;
    let s = out.get(squad);
    if (!s) out.set(squad, (s = { side, strength: 0, x: 0, z: 0, units: 0, flak: false, free: true }));
    s.strength += fightingStrength(world, e);
    s.x += t.x;
    s.z += t.z;
    s.units++;
    if (move === 'naval' || def.category === 'super') s.free = false;
    if (ANTI_AIR.has(def.id)) s.flak = true;
  }
  for (const s of out.values()) {
    s.x /= s.units;
    s.z /= s.units;
  }
  return out;
}

/** Enemy strength (armies, guards, garrison and towers) within DEFENCE_RADIUS of a point, as `side` sees it. */
function enemyNear(world: World, ctx: SimContext, side: number, x: number, z: number): number {
  let sum = 0;
  ctx.grid.forEachNear(x, z, DEFENCE_RADIUS, (e: Entity) => {
    const f = world.get(e, Faction);
    if (f && ctx.sides.hostile(side, f.id)) sum += fightingStrength(world, e);
  });
  return sum;
}

/** Each side's task forces, refreshed with the Commander's picture. */
export class TaskForces {
  forces: TaskForce[] = [];
  private bySquad = new Map<number, TaskForce>();
  private nextId = 0;
  /** Per side and outpost (side * outposts + outpost), when the side may next send a force there. */
  private retryAt = new Map<number, number>();

  /** The task force a squad is on, if any. */
  forSquad(squad: number): TaskForce | undefined {
    return this.bySquad.get(squad);
  }

  /** Re-plan every side's task forces. */
  update(world: World, ctx: SimContext): void {
    const share = ctx.settings.armies.taskForces;
    const time = world.time;
    const scale = Math.max(1, ctx.field.config.cols / MAP_SIZES.medium.cols);
    const squads = share > 0 ? squadsOf(world) : new Map<number, SquadInfo>();
    const kept: TaskForce[] = [];
    for (let side = 0; side < ctx.sides.count; side++) {
      const mine = this.forces.filter((tf) => tf.side === side);
      if (share <= 0 || !this.free(ctx, side, time)) continue;
      // Carry on with the forces still worth running.
      for (const tf of mine) {
        tf.squads = tf.squads.filter((q) => squads.has(q));
        let x = 0;
        let z = 0;
        let units = 0;
        tf.strength = 0;
        for (const q of tf.squads) {
          const s = squads.get(q)!;
          tf.strength += s.strength;
          x += s.x * s.units;
          z += s.z * s.units;
          units += s.units;
        }
        const o = ctx.outposts[tf.outpost];
        const ours = ctx.sides.allied(o.owner, side);
        if (tf.kind === 'take' && ours) tf.kind = 'hold';
        else if (tf.kind === 'hold' && !ours) tf.kind = 'take';
        if (units === 0 || tf.strength < tf.launch * SPENT || (tf.kind === 'take' && time - tf.since > TIMEOUT * scale)) {
          this.retryAt.set(side * ctx.outposts.length + tf.outpost, time + COOLDOWN * scale);
          continue;
        }
        tf.x = x / units;
        tf.z = z / units;
        kept.push(tf);
      }
      this.plan(world, ctx, side, share, squads, kept, time);
    }
    this.forces = kept;
    this.bySquad.clear();
    for (const tf of kept) for (const q of tf.squads) this.bySquad.set(q, tf);
  }

  /** Whether a side's army is free for task forces: auto stance, no rally flag, not attacking and its base not under attack. */
  private free(ctx: SimContext, side: number, time: number): boolean {
    const orders = ctx.orders[side];
    return (
      !ctx.sides.eliminated[side] &&
      orders.stance === 'auto' &&
      orders.rally === null &&
      !ctx.offensive.attacking(side, time) &&
      !ctx.sides.recalling[side] &&
      !ctx.sides.underAttack(side)
    );
  }

  /** Maybe send out a new force: to the cheapest outpost worth taking or holding that it can afford. */
  private plan(world: World, ctx: SimContext, side: number, share: number, squads: Map<number, SquadInfo>, forces: TaskForce[], time: number): void {
    const mine = forces.filter((tf) => tf.side === side);
    if (mine.length >= MOST_FORCES) return;
    const busy = new Set(forces.flatMap((tf) => tf.squads));
    let army = 0;
    const free: [number, SquadInfo][] = [];
    for (const [q, s] of squads) {
      if (s.side !== side) continue;
      army += s.strength;
      if (s.free && !busy.has(q)) free.push([q, s]);
    }
    const budget = army * share - mine.reduce((sum, tf) => sum + tf.strength, 0);
    if (budget < LEAST_FORCE) return;
    const home = ctx.field.baseSites[side];
    let best: { outpost: number; kind: TaskKind; need: number; cost: number } | null = null;
    for (const o of ctx.outposts) {
      if (mine.some((tf) => tf.outpost === o.index) || time < (this.retryAt.get(side * ctx.outposts.length + o.index) ?? 0)) continue;
      const ours = ctx.sides.allied(o.owner, side);
      // Its own outposts only need a force while an enemy is taking them.
      if (ours && (o.claimant < 0 || !ctx.sides.hostile(side, o.claimant))) continue;
      const need = Math.max(LEAST_FORCE, enemyNear(world, ctx, side, o.x, o.z) * TAKE_MARGIN);
      if (need > budget) continue;
      const cost = need + Math.hypot(o.x - home.x, o.z - home.z) * DISTANCE_COST;
      if (!best || cost < best.cost) best = { outpost: o.index, kind: ours ? 'hold' : 'take', need, cost };
    }
    if (!best) return;
    // The nearest free squads, until there's enough; flak first if enemy aircraft are about the outpost.
    const o = ctx.outposts[best.outpost];
    const air = ctx.sides.enemiesOf(side).reduce((sum, g) => sum + ctx.commander.strength.near(ctx.commander.strength.air, g, o.x, o.z, DEFENCE_RADIUS), 0) > 0;
    const first = (s: SquadInfo) => (air && s.flak ? 0 : 1);
    free.sort((a, b) => first(a[1]) - first(b[1]) || Math.hypot(a[1].x - o.x, a[1].z - o.z) - Math.hypot(b[1].x - o.x, b[1].z - o.z) || a[0] - b[0]);
    const picked: number[] = [];
    let strength = 0;
    let x = 0;
    let z = 0;
    let units = 0;
    for (const [q, s] of free) {
      if (strength >= best.need) break;
      picked.push(q);
      strength += s.strength;
      x += s.x * s.units;
      z += s.z * s.units;
      units += s.units;
    }
    if (strength < best.need || strength > budget * 1.25) return;
    forces.push({ id: this.nextId++, side, kind: best.kind, outpost: best.outpost, squads: picked, launch: strength, strength, since: time, x: x / units, z: z / units });
  }

  /** What the page shows (see sim/mirror.ts). */
  get state(): TaskForce[] {
    return this.forces;
  }

  set state(forces: TaskForce[]) {
    this.forces = forces;
    this.bySquad.clear();
    for (const tf of forces) for (const q of tf.squads) this.bySquad.set(q, tf);
  }
}
