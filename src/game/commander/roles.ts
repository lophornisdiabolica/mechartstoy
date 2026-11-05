import { Entity, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Ai, Faction, Guard, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { fightingStrength } from '../offensive';
import { UnitId } from '../units';
import { StrengthMap } from './strength';
import type { TaskForces } from './taskForces';
import * as D from '../../core/dmath';

/*
 * Using units for what they're for (Commander step 3). On top of the team
 * plan and task forces, the Commander gives some units a job that suits
 * them:
 * - cover: flak goes to whatever of its side's the enemy's aircraft are
 *   over (its army, its base, an outpost it holds, a task force), where its
 *   side has least anti-air for the aircraft there;
 * - overwatch: between attacks, artillery waits on high ground near the
 *   rally point instead of on the flat;
 * - escort: on an attack, the nearest vehicles stay round the side's super
 *   unit, so it doesn't walk in alone.
 * Jobs are per unit, refreshed with the Commander's picture. The rally flag,
 * a stance other than auto and an attack on the base override them.
 */

/** Anti-aircraft specialists: units built to shoot aircraft. */
export const ANTI_AIR: ReadonlySet<string> = new Set<UnitId>(['flakTank', 'flakWalker']);
/** How far round a spot enemy aircraft count as over it. */
const AIR_RADIUS = 18;
/** Most distance from the rally point to high ground artillery will wait on. */
const OVERWATCH_RANGE = 30;
/** High ground mustn't be more than this much nearer the enemy base than the rally point is. */
const OVERWATCH_AHEAD = 6;
/** It has to be at least this much higher than the rally point to be worth it. */
const OVERWATCH_RISE = 1.5;
/** Spacing of the points tried. */
const OVERWATCH_STEP = 3;
/** Vehicles that stay round each super unit on an attack. */
const ESCORTS = 3;
/** How far round the super unit its escorts keep. */
const ESCORT_RING = 5;

/** 'build' jobs are the engineers' (see engineers.ts); the rest are handed out here. */
export type JobKind = 'cover' | 'overwatch' | 'escort' | 'build';

/** A unit's job: where to be, and for an escort, whom to stay with. */
export interface Job {
  kind: JobKind;
  x: number;
  z: number;
  /** For an escort: the super unit. */
  lead: Entity | null;
}

/** A spot of its side's the Commander can send flak to. */
interface Asset {
  x: number;
  z: number;
  /** Enemy air over it, less its side's anti-air there; flak sent there takes its strength off. */
  need: number;
}

export class Roles {
  private jobs = new Map<Entity, Job>();
  /** Overwatch spots found, by side, rally point and land grid version. */
  private spots = new Map<string, { x: number; z: number } | null>();

  /** A unit's job, if it has one. */
  jobFor(e: Entity): Job | undefined {
    return this.jobs.get(e);
  }

  /** How many of a side's units have each kind of job, as of the last update (for the panel and tests). */
  counts(side: number): Record<JobKind, number> {
    return this.tally[side] ?? { cover: 0, overwatch: 0, escort: 0, build: 0 };
  }

  private tally: Record<JobKind, number>[] = [];

  /** Hand out jobs afresh. `forces` are the task forces (their squads are busy). */
  update(world: World, ctx: SimContext, strength: StrengthMap, forces: TaskForces): void {
    this.jobs.clear();
    this.tally = ctx.sides.teams.map(() => ({ cover: 0, overwatch: 0, escort: 0, build: 0 }));
    const time = world.time;
    const sides = ctx.sides;
    // Each side's candidates, in a fixed order (the query's).
    const flak: Entity[][] = sides.teams.map(() => []);
    const artillery: Entity[][] = sides.teams.map(() => []);
    const vehicles: Entity[][] = sides.teams.map(() => []);
    const supers: Entity[][] = sides.teams.map(() => []);
    for (const e of world.query(Ai, Unit, Faction, Transform, Mover)) {
      if (world.has(e, Guard)) continue;
      const side = world.req(e, Faction).id;
      if (side < 0 || side >= sides.count) continue;
      const def = world.req(e, Unit).def;
      const flies = MOVE_RULES[world.req(e, Mover).move].flies;
      if (def.category === 'super') {
        if (!flies) supers[side].push(e);
        continue;
      }
      // Squads on a task force do its job.
      if (forces.forSquad(world.req(e, Ai).squad)?.side === side) continue;
      if (ANTI_AIR.has(def.id)) flak[side].push(e);
      else if (def.role === 'artillery') artillery[side].push(e);
      else if (def.category === 'vehicle' && !flies && world.req(e, Mover).move !== 'naval') vehicles[side].push(e);
    }

    for (let side = 0; side < sides.count; side++) {
      const orders = ctx.orders[side];
      if (sides.eliminated[side] || orders.stance !== 'auto' || orders.rally !== null) continue;
      // An attack on the base calls everyone home, but flak still goes where the aircraft are.
      const home = !sides.recalling[side] && !sides.underAttack(side);
      const attacking = home && ctx.offensive.attacking(side, time);
      const target = sides.target(side, ctx.offensive.attack(side, time));

      // Cover: flak to whatever of ours enemy aircraft are over, most uncovered first.
      if (flak[side].length > 0) {
        const assets = this.assets(ctx, side, forces);
        for (const a of assets) {
          for (const g of sides.enemiesOf(side)) a.need += strength.near(strength.air, g, a.x, a.z, AIR_RADIUS);
          if (a.need > 0) a.need -= strength.near(strength.antiAir, side, a.x, a.z, AIR_RADIUS);
        }
        for (const e of flak[side]) {
          let best: Asset | null = null;
          for (const a of assets) if (a.need > 0 && (!best || a.need > best.need)) best = a;
          if (!best) break;
          this.give(side, e, { kind: 'cover', x: best.x, z: best.z, lead: null });
          best.need -= fightingStrength(world, e);
        }
      }

      // Overwatch: between attacks, artillery to the highest ground near the rally point (not out in front of it).
      if (home && !attacking && target !== null && artillery[side].length > 0) {
        const spot = this.overwatch(ctx, side, target);
        if (spot) for (const e of artillery[side]) this.give(side, e, { kind: 'overwatch', x: spot.x, z: spot.z, lead: null });
      }

      // Escort: on an attack, the nearest vehicles stay round each super unit.
      if (attacking) {
        const free = new Set(vehicles[side]);
        for (const lead of supers[side]) {
          const lt = world.req(lead, Transform);
          const near = [...free].sort((a, b) => dist(world, a, lt) - dist(world, b, lt) || a - b).slice(0, ESCORTS);
          near.forEach((e, i) => {
            free.delete(e);
            const angle = (i / ESCORTS) * Math.PI * 2;
            this.give(side, e, { kind: 'escort', x: D.cos(angle) * ESCORT_RING, z: D.sin(angle) * ESCORT_RING, lead });
          });
        }
      }
    }
  }

  private give(side: number, e: Entity, job: Job): void {
    this.jobs.set(e, job);
    this.tally[side][job.kind]++;
  }

  /**
   * The highest ground within OVERWATCH_RANGE of a side's rally point that
   * isn't out in front of it, if it's at least OVERWATCH_RISE above the
   * rally point. Rally points rarely move, so it's remembered per rally point.
   */
  private overwatch(ctx: SimContext, side: number, target: number): { x: number; z: number } | null {
    const rally = ctx.lanes.rally(side, target, 0);
    const key = `${side}:${rally.x}:${rally.z}:${ctx.navs.land.passableVersion}`;
    const known = this.spots.get(key);
    if (known !== undefined) return known;
    const { field } = ctx;
    const enemy = field.baseSites[target];
    const ahead = D.hypot(rally.x - enemy.x, rally.z - enemy.z) - OVERWATCH_AHEAD;
    const nav = ctx.navs.land;
    let best: { x: number; z: number } | null = null;
    let bestH = field.heightAt(rally.x, rally.z) + OVERWATCH_RISE;
    for (let dz = -OVERWATCH_RANGE; dz <= OVERWATCH_RANGE; dz += OVERWATCH_STEP) {
      for (let dx = -OVERWATCH_RANGE; dx <= OVERWATCH_RANGE; dx += OVERWATCH_STEP) {
        if (dx * dx + dz * dz > OVERWATCH_RANGE * OVERWATCH_RANGE) continue;
        const x = rally.x + dx;
        const z = rally.z + dz;
        if (!field.contains(x, z, 2) || nav.terrainBlocksCell(x, z) || D.hypot(x - enemy.x, z - enemy.z) < ahead) continue;
        const h = field.heightAt(x, z);
        if (h > bestH) {
          bestH = h;
          best = { x, z };
        }
      }
    }
    this.spots.set(key, best);
    return best;
  }

  /** What of a side's the enemy's aircraft might be over: its base, its army, outposts it holds and its task forces. */
  private assets(ctx: SimContext, side: number, forces: TaskForces): Asset[] {
    const out: Asset[] = [];
    const home = ctx.field.baseSites[side];
    out.push({ x: home.x, z: home.z, need: 0 });
    const picture = ctx.commander.sides[side];
    if (picture.armyX !== null && picture.armyZ !== null) out.push({ x: picture.armyX, z: picture.armyZ, need: 0 });
    for (const o of ctx.outposts) if (ctx.sides.allied(o.owner, side)) out.push({ x: o.x, z: o.z, need: 0 });
    for (const tf of forces.forces) if (tf.side === side) out.push({ x: tf.x, z: tf.z, need: 0 });
    return out;
  }
}

function dist(world: World, e: Entity, t: { x: number; z: number }): number {
  const et = world.req(e, Transform);
  return D.hypot(et.x - t.x, et.z - t.z);
}
