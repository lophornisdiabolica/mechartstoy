import { System, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Armed, Faction, Guard, Mover, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { fightingStrength } from '../offensive';
import { findPlaces, Place } from './places';
import { StrengthMap } from './strength';

/*
 * The Commander: a planner per side, above the squads (see the Commander
 * plan). This first step only builds its picture of the battle and states
 * today's team plan as goals; nothing in the battle reads it yet, so it
 * changes nothing. Later steps give task forces their own goals.
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

export type GoalKind = 'push' | 'defend' | 'mass' | 'regroup';

/** Something a side means to do, and where. */
export interface Goal {
  kind: GoalKind;
  x: number;
  z: number;
  /** The enemy side it's aimed at, if any. */
  target: number | null;
  /** How much the side wants it, 0 to 1 (for now: how ready it is to push). */
  score: number;
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
  goals: Goal[];
}

function emptyMix(): UnitMix {
  return { infantry: 0, vehicle: 0, air: 0, super: 0, antiAir: 0, artillery: 0 };
}

/** Every side's picture, plus the map's key places. Lives in SimContext.commander. */
export class Commander {
  readonly sides: SidePicture[];
  places: Place[] = [];
  /** Sim time of the last refresh. */
  updatedAt = -Infinity;
  /** The strength map (worker only: the page's copy isn't kept up to date). */
  readonly strength: StrengthMap;
  /** The land grid's passableVersion the places were found for (scrap and felled trees don't move them). */
  private placesVersion = -1;

  /** Finds the places now, while the battle loads, rather than on its first tick. */
  constructor(ctx: Pick<SimContext, 'field' | 'navs'>, sides: number) {
    this.strength = new StrengthMap(ctx.field, sides);
    this.places = findPlaces(ctx.field, ctx.navs.land);
    this.placesVersion = ctx.navs.land.passableVersion;
    this.sides = Array.from({ length: sides }, () => ({ armyX: null, armyZ: null, ground: 0, air: 0, antiAir: 0, mix: emptyMix(), enemyMix: emptyMix(), goals: [] }));
  }

  /** Rebuild the picture and the goals from the battle as it stands. Reads the battle only. */
  update(world: World, ctx: SimContext): void {
    this.updatedAt = world.time;
    if (this.placesVersion !== ctx.navs.land.passableVersion) {
      this.places = findPlaces(ctx.field, ctx.navs.land);
      this.placesVersion = ctx.navs.land.passableVersion;
    }
    this.strength.update(world);

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
    });
    for (let f = 0; f < this.sides.length; f++) {
      for (const g of ctx.sides.enemiesOf(f)) {
        if (g < 0 || g >= this.sides.length) continue;
        const mine = this.sides[f].enemyMix;
        const theirs = this.sides[g].mix;
        for (const k of Object.keys(mine) as (keyof UnitMix)[]) mine[k] += theirs[k];
      }
      this.sides[f].goals = this.goalsFor(world, ctx, f);
    }
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
  get state(): { sides: SidePicture[]; places: Place[]; updatedAt: number } {
    return { sides: this.sides, places: this.places, updatedAt: this.updatedAt };
  }

  set state(s: { sides: SidePicture[]; places: Place[]; updatedAt: number }) {
    this.sides.splice(0, this.sides.length, ...s.sides);
    this.places = s.places;
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
