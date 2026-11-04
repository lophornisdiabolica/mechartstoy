import { System, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Armed, Faction, Guard, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { fightingStrength } from '../offensive';
import { findPlaces, Place } from './places';
import { StrengthMap } from './strength';
import { Needs, needsOf } from './advice';
import { Engineers } from './engineers';
import { Avoidance, ThreatMap } from './threats';
import { JobKind, Roles } from './roles';
import { TaskForce, TaskForces } from './taskForces';

/*
 * The Commander: a planner per side, above the squads (see the Commander
 * plan). It builds a picture of the battle, states the team plan as goals,
 * between attacks sends task forces off on jobs of their own (see
 * taskForces.ts), and gives some units jobs that suit them (roles.ts). The team attack itself is still decided in offensive.ts.
 */

/** Seconds between refreshes of the picture and goals. */
export const PICTURE_INTERVAL = 2;

/** What kinds of unit a side fields: the Commander's view of an army's make-up. */
export interface UnitMix {
  infantry: number;
  vehicle: number;
  air: number;
  super: number;
  /** Units that can shoot aircraft (flak, missiles), whatever their category. */
  antiAir: number;
  /** Artillery-role units. */
  artillery: number;
}

/** Team goals (push, defend, mass, regroup) and task force jobs (take or hold an outpost, see taskForces.ts). */
export type GoalKind = 'push' | 'defend' | 'mass' | 'regroup' | 'take' | 'hold';

/** Something a side means to do, and where. */
export interface Goal {
  kind: GoalKind;
  x: number;
  z: number;
  /** The enemy side it's aimed at, if any. */
  target: number | null;
  /** How much the side wants it, 0 to 1 (for now: how ready it is to push). */
  score: number;
  /** For a task force's job: the force. */
  force?: number;
}

/** One side's picture of the battle. */
export interface SidePicture {
  /** Its army's middle (units, not outpost guards), or null with no army. */
  armyX: number | null;
  armyZ: number | null;
  /** Its army's fighting strength: on the ground, in the air, and able to shoot aircraft. */
  ground: number;
  air: number;
  antiAir: number;
  mix: UnitMix;
  /** What its enemies field, together. */
  enemyMix: UnitMix;
  /** Its enemies' strength in the air, together. */
  enemyAir: number;
  /** What its army is short of, which leans its production (see advice.ts). */
  needs: Needs;
  goals: Goal[];
  /** How many of its units the Commander has given each kind of job (see roles.ts). */
  jobs: Record<JobKind, number>;
  /** Squads going round ground that's dangerous to them (see threats.ts). */
  detours: number;
}

function emptyMix(): UnitMix {
  return { infantry: 0, vehicle: 0, air: 0, super: 0, antiAir: 0, artillery: 0 };
}

/** What the page gets a copy of. */
export interface CommanderState {
  sides: SidePicture[];
  places: Place[];
  forces: TaskForce[];
  updatedAt: number;
}

/** Every side's picture, plus the map's key places. Lives in SimContext.commander. */
export class Commander {
  readonly sides: SidePicture[];
  places: Place[] = [];
  /** Sim time of the last refresh. */
  updatedAt = -Infinity;
  /** The strength map (worker only: the page's copy isn't kept up to date). */
  readonly strength: StrengthMap;
  /** Squads sent off on jobs of their own between attacks. */
  readonly taskForces = new TaskForces();
  /** Jobs that suit particular units: flak covering, artillery on high ground, escorts (worker only: the page doesn't need them). */
  readonly roles = new Roles();
  /** Engineers' building jobs (see engineers.ts). */
  readonly engineers = new Engineers();
  /** How dangerous each part of the field is to each kind of unit, per side (worker only). */
  readonly threats: ThreatMap;
  /** Lane choices and detours that keep squads out of where they're weak (see threats.ts). */
  readonly avoidance = new Avoidance();
  /** The land grid's passableVersion the places were found for (scrap and felled trees don't move them). */
  private placesVersion = -1;

  /** Finds the places now, while the battle loads, rather than on its first tick. */
  constructor(ctx: Pick<SimContext, 'field' | 'navs'>, sides: number) {
    this.strength = new StrengthMap(ctx.field, sides);
    this.threats = new ThreatMap(ctx.field, sides);
    this.places = findPlaces(ctx.field, ctx.navs.land);
    this.placesVersion = ctx.navs.land.passableVersion;
    this.sides = Array.from({ length: sides }, () => ({ armyX: null, armyZ: null, ground: 0, air: 0, antiAir: 0, mix: emptyMix(), enemyMix: emptyMix(), enemyAir: 0, needs: { antiAir: 0, antiArmour: 0 }, goals: [], jobs: { cover: 0, overwatch: 0, escort: 0, build: 0 }, detours: 0 }));
  }

  /** Rebuild the picture and the goals from the battle as it stands. Reads the battle only. */
  update(world: World, ctx: SimContext): void {
    this.updatedAt = world.time;
    if (this.placesVersion !== ctx.navs.land.passableVersion) {
      this.places = findPlaces(ctx.field, ctx.navs.land);
      this.placesVersion = ctx.navs.land.passableVersion;
    }
    this.strength.update(world);
    if (ctx.settings.armies.avoidance) this.threats.update(world);

    const sumX = this.sides.map(() => 0);
    const sumZ = this.sides.map(() => 0);
    const count = this.sides.map(() => 0);
    for (const s of this.sides) {
      s.ground = s.air = s.antiAir = 0;
      s.mix = emptyMix();
    }
    for (const e of world.query(Unit, Faction, Transform)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= this.sides.length || world.has(e, Guard)) continue;
      const side = this.sides[f];
      const def = world.req(e, Unit).def;
      // Engineers aren't part of the army (see engineers.ts).
      if (def.builds) continue;
      const t = world.req(e, Transform);
      sumX[f] += t.x;
      sumZ[f] += t.z;
      count[f]++;
      side.mix[def.category]++;
      if (def.role === 'artillery') side.mix.artillery++;
      const armed = world.get(e, Armed);
      const strength = fightingStrength(world, e);
      const flies = MOVE_RULES[world.get(e, Mover)?.move ?? def.move].flies;
      if (flies) side.air += strength;
      else side.ground += strength;
      if (armed && armed.weapon.targets !== 'ground') {
        side.antiAir += strength;
        side.mix.antiAir++;
      }
    }
    this.sides.forEach((side, f) => {
      side.armyX = count[f] > 0 ? sumX[f] / count[f] : null;
      side.armyZ = count[f] > 0 ? sumZ[f] / count[f] : null;
      side.enemyMix = emptyMix();
      side.enemyAir = 0;
    });
    for (let f = 0; f < this.sides.length; f++) {
      for (const g of ctx.sides.enemiesOf(f)) {
        if (g < 0 || g >= this.sides.length) continue;
        const mine = this.sides[f].enemyMix;
        const theirs = this.sides[g].mix;
        for (const k of Object.keys(mine) as (keyof UnitMix)[]) mine[k] += theirs[k];
        this.sides[f].enemyAir += this.sides[g].air;
      }
      this.sides[f].needs = needsOf(this.sides[f]);
    }
    this.taskForces.update(world, ctx);
    this.roles.update(world, ctx, this.strength, this.taskForces);
    this.engineers.update(world, ctx);
    this.avoidance.update(world, ctx);
    this.sides.forEach((side, f) => {
      side.jobs = { ...this.roles.counts(f), build: this.engineers.count(f) };
      side.detours = this.avoidance.detouring[f] ?? 0;
      side.goals = this.goalsFor(world, ctx, f);
      for (const tf of this.taskForces.forces) {
        if (tf.side !== f) continue;
        const o = ctx.outposts[tf.outpost];
        side.goals.push({ kind: tf.kind, x: o.x, z: o.z, target: null, score: tf.launch > 0 ? tf.strength / tf.launch : 1, force: tf.id });
      }
    });
  }

  /** Today's team plan, as goals: push the target base, defend home, or mass (or regroup) at the rally point. */
  private goalsFor(world: World, ctx: SimContext, f: number): Goal[] {
    if (ctx.sides.eliminated[f]) return [];
    const { offensive, sides, field } = ctx;
    const time = world.time;
    const attack = offensive.attack(f, time);
    const target = sides.target(f, attack);
    const home = field.baseSites[f];
    if (target === null) return [{ kind: 'defend', x: home.x, z: home.z, target: null, score: 1 }];
    if (offensive.attacking(f, time)) {
      const base = field.baseSites[target];
      return [{ kind: 'push', x: base.x, z: base.z, target, score: 1 }];
    }
    const readiness = ctx.settings.armies.attackTiming === 'readiness';
    const plan = readiness ? offensive.plan(f) : null;
    if (plan?.state === 'defending') return [{ kind: 'defend', x: home.x, z: home.z, target: null, score: 1 }];
    const rally = ctx.orders[f].rally ?? home;
    const kind: GoalKind = plan?.state === 'regrouping' ? 'regroup' : 'mass';
    const base = field.baseSites[target];
    return [
      { kind, x: rally.x, z: rally.z, target: null, score: 1 },
      { kind: 'push', x: base.x, z: base.z, target, score: plan ? plan.ready : 0 },
    ];
  }

  /** What the page shows (see sim/mirror.ts): everything but the strength map. */
  get state(): CommanderState {
    return { sides: this.sides, places: this.places, forces: this.taskForces.state, updatedAt: this.updatedAt };
  }

  set state(s: CommanderState) {
    this.sides.splice(0, this.sides.length, ...s.sides);
    this.places = s.places;
    this.taskForces.state = s.forces;
    this.updatedAt = s.updatedAt;
  }
}

/** Refreshes each side's Commander picture every PICTURE_INTERVAL seconds. */
export function commanderSystem(ctx: SimContext): System {
  return {
    name: 'commander',
    update(world) {
      if (world.time - ctx.commander.updatedAt < PICTURE_INTERVAL) return;
      ctx.commander.update(world, ctx);
    },
  };
}
