import { System, World } from '../core/ecs';
import { Armed, Arsenal, Faction, Guard, Health, Mover, Transform, Unit } from './components';
import { WeaponDef } from './units';
import { SimContext } from './context';
import { AttackTiming, MAP_SIZES } from './settings';
import { Sides } from './sides';
import { armyCap } from './caps';
import { CAPTURE_RADIUS, outpostBonus } from './outposts';
import { hillOf, hillReach, hillTimeLeft, hillUrgency } from './hill';
import { STYLES } from './commander/advice';
import { attackNumber, isAttacking, TideSettings } from './tide';

/*
 * When armies attack (the attackTiming setting, see AttackTiming):
 * - 'readiness': each team masses at home until its army outweighs what it
 *   expects to meet at the enemy base, attacks, and falls back to rebuild once
 *   the attack is spent. An attack waits until it has a real chance, and a
 *   side that has thrown back an attack can hit back once it has regrouped.
 *   Teams grow impatient the longer they wait, so evenly matched sides don't
 *   sit and stare at each other.
 * - 'tide': attacks follow the tide's clock (see tide.ts).
 *
 * Tuned on medium-map Conquest: without the regroup pause and the rule that a
 * side under attack stays home, both armies tended to set out at once for each
 * other's empty bases, and battles were a third shorter than on the tide.
 */

/** Seconds between readiness checks. */
const CHECK_INTERVAL = 1;
/** How far from an enemy base its units and towers count as its defence. */
const DEFENCE_RANGE = 36;
/** Army needed, as a multiple of the defence, right after the last attack... */
const START_MARGIN = 1.6;
/** ...falling to this once a team has waited PATIENCE seconds. */
const LEAST_MARGIN = 0.8;
/** Seconds (on a medium map) for a team's patience to run out. */
const PATIENCE = 150;
/** Share of the team's unit cap it has to field before attacking at all, so it attacks in force. */
const MIN_ARMY = 0.7;
/** An attack is spent once the units that set out are down to this share of their strength. */
const SPENT = 0.45;
/** Longest an attack goes on (on a medium map), so an army can't grind away somewhere for ever. */
const MAX_ATTACK = 120;
/** Seconds (on a medium map) after an attack before the next can set out, while the survivors get home. */
const REGROUP = 45;
/**
 * A base under attack only from the water doesn't keep its army home: once
 * at least this share of the enemy strength near it is afloat (boats
 * shelling from offshore, where most of an army can't get at them), the
 * side goes on massing and hits back at the enemy's base, which is on land.
 */
const AFLOAT = 0.6;
/**
 * King of the hill, near the end: a team goes all in (everything it has,
 * at once, and no falling back) once an enemy is this many seconds from
 * winning beyond what its army needs to get to the hill. Early enough that
 * the army arrives together for one big last fight, not so early that the
 * whole match is a trickle of half-built attacks.
 */
const ALL_IN_SLACK = 25;

/** What a team is doing, for the HUD. */
export type PlanState = 'massing' | 'attacking' | 'regrouping' | 'defending';

/** What a team's attack planner knows. */
export interface TeamPlan {
  state: PlanState;
  /** Which attack it's on or building up to (counts up when an attack ends). */
  attack: number;
  /** When the current attack or build-up began. */
  since: number;
  /** The units that set out on the attack (units built later join in, but don't count toward whether it's spent). */
  roster: number[];
  /** Their strength when they set out. */
  launch: number;
  /** The side being attacked. */
  target: number | null;
  /** Army strength at the last check. */
  army: number;
  /** Army strength it needs to attack (0 while not massing). */
  need: number;
  /** How ready it is to attack, 0 to 1, while massing: the lower of its strength and its numbers against what it needs. */
  ready: number;
  /**
   * King of the hill: an enemy is about to win on the hill, so the team has
   * thrown everything at it (see ALL_IN_SLACK): every unit attacks, nobody
   * holds other outposts or goes home to regroup, until the clock is stopped.
   */
  allIn?: boolean;
}

/**
 * Fighting strength of a unit or armed building: the square root of how
 * much punishment it can take times how fast it deals damage, so a group's
 * strength is roughly the sum of its members' (Lanchester's square law).
 */
/** A typical hit's damage, for judging how much armour is worth (see fightingStrength). */
const ARMOUR_REF = 30;

export function fightingStrength(world: World, e: number): number {
  const h = world.get(e, Health);
  const a = world.get(e, Armed);
  if (!h || !a) return 0;
  const arsenal = world.get(e, Arsenal);
  return strengthOf(h.hp, h.armor, arsenal ? [a.weapon, ...arsenal.arms.map((x) => x.weapon)] : a.weapon);
}

/** A weapon's damage per second, flat out (bursts and cooldowns, not armour or misses). */
export function weaponDps(w: WeaponDef): number {
  return (w.damage * w.burst) / Math.max(0.1, w.cooldown);
}

/**
 * fightingStrength for given health, armour and weapon (a fresh unit of a
 * type: its def's hp, armor and weapon), or weapons: a unit with several
 * (see UnitDef.mounts) puts out all of their damage together.
 */
export function strengthOf(hp: number, armor: number, w: WeaponDef | readonly WeaponDef[]): number {
  const dps = isList(w) ? w.reduce((sum, x) => sum + weaponDps(x), 0) : weaponDps(w);
  // Armour is taken off each hit; against a typical hit (ARMOUR_REF damage) that's this share of it.
  const absorbed = armor / (armor + ARMOUR_REF);
  return Math.sqrt((hp / (1 - absorbed)) * dps);
}

export class Offensive {
  private readonly plans = new Map<number, TeamPlan>();
  /** Stretches the timings for bigger maps, like the tide. */
  private readonly scale: number;

  constructor(
    private readonly sides: Sides,
    private readonly tide: TideSettings,
    private readonly timing: () => AttackTiming,
    cols: number,
  ) {
    this.scale = Math.max(1, cols / MAP_SIZES.medium.cols);
    for (const team of sides.teamList) {
      this.plans.set(team, { state: 'massing', attack: 0, since: 0, roster: [], launch: 0, target: null, army: 0, need: 0, ready: 0 });
    }
  }

  /** Every team's plan, to copy onto a mirror of the battle (see sim/mirror.ts). */
  get plansState(): [number, TeamPlan][] {
    return [...this.plans];
  }

  set plansState(plans: [number, TeamPlan][]) {
    this.plans.clear();
    for (const [team, plan] of plans) this.plans.set(team, plan);
  }

  /** Whether a side is on the attack (before any player orders or a recall). */
  attacking(faction: number, time: number): boolean {
    if (this.plan(faction).allIn) return true;
    if (this.timing() === 'tide') return isAttacking(time, this.sides.phase[faction], this.tide);
    return this.plan(faction).state === 'attacking';
  }

  /** Which attack a side is on or building up to; it picks the target and lanes (see Sides.target). */
  attack(faction: number, time: number): number {
    if (this.timing() === 'tide') return attackNumber(time, this.sides.phase[faction], this.tide);
    return this.plan(faction).attack;
  }

  /** The plan of a side's team (readiness timing). */
  plan(faction: number): TeamPlan {
    return this.plans.get(this.sides.teams[faction])!;
  }

  /** Army needed, as a multiple of the defence, after waiting `waited` seconds. */
  margin(waited: number): number {
    const k = Math.min(1, waited / (PATIENCE * this.scale));
    return START_MARGIN - (START_MARGIN - LEAST_MARGIN) * k;
  }

  /** Whether a side's team has gone all in for the hill (see ALL_IN_SLACK). */
  allIn(faction: number): boolean {
    return this.plan(faction).allIn === true;
  }

  /**
   * King of the hill: whether a team should go all in, and say so when it
   * starts. Teams that hold the hill, or while nobody's clock is running
   * out, don't.
   */
  private goAllIn(world: World, ctx: SimContext, plan: TeamPlan, members: number[]): boolean {
    const left = hillTimeLeft(ctx, members[0]);
    // Once in, it stays in while the enemy still holds the hill, however the numbers wobble.
    const all = left < Infinity && (plan.allIn === true || left <= hillReach(world, ctx, members) + ALL_IN_SLACK);
    if (all && !plan.allIn) ctx.events.emit('hillAllIn', { faction: members[0], left });
    plan.allIn = all;
    return all;
  }

  /** Re-plan every team (see offensiveSystem). */
  update(world: World, ctx: SimContext): void {
    const { sides } = this;
    const time = world.time;
    // On the tide, the tide's clock times attacks; only a team's last push for the hill is planned here.
    if (this.timing() === 'tide') {
      if (!ctx.hill) return;
      for (const [team, plan] of this.plans) {
        const members = sides.standing().filter((f) => sides.teams[f] === team);
        if (members.length > 0) this.goAllIn(world, ctx, plan, members);
      }
      return;
    }
    // Each side's army: its units, not counting outpost guards.
    const army = new Array<number>(sides.count).fill(0);
    const count = new Array<number>(sides.count).fill(0);
    for (const e of world.query(Unit, Faction, Armed, Health)) {
      if (world.has(e, Guard)) continue;
      const f = world.req(e, Faction).id;
      if (f < 0) continue;
      army[f] += fightingStrength(world, e);
      count[f]++;
    }
    for (const [team, plan] of this.plans) {
      const members = sides.standing().filter((f) => sides.teams[f] === team);
      if (members.length === 0) continue;
      plan.army = members.reduce((s, f) => s + army[f], 0);
      plan.need = 0;
      plan.ready = 0;
      const target = sides.target(members[0], plan.attack);
      if (target === null) continue;

      // King of the hill, nearly lost: everything goes now, and keeps going.
      if (ctx.hill && this.goAllIn(world, ctx, plan, members)) {
        plan.ready = 1;
        if (plan.state !== 'attacking') {
          plan.state = 'attacking';
          plan.target = target;
          plan.roster = [];
        }
        // Counted from now, so once the clock is stopped the attack runs its usual course from here.
        plan.since = time;
        for (const e of world.query(Unit, Faction, Armed, Health)) {
          if (!world.has(e, Guard) && members.includes(world.req(e, Faction).id) && !plan.roster.includes(e)) plan.roster.push(e);
        }
        plan.launch = plan.roster.reduce((s, e) => s + (world.isAlive(e) ? fightingStrength(world, e) : 0), 0);
        continue;
      }

      if (plan.state === 'attacking') {
        // Spent, target knocked out, or gone on too long: fall back and build up for the next one.
        const left = plan.roster.reduce((s, e) => s + (world.isAlive(e) ? fightingStrength(world, e) : 0), 0);
        const won = plan.target !== null && sides.eliminated[plan.target];
        if (left < plan.launch * SPENT || won || time - plan.since > MAX_ATTACK * this.scale) {
          plan.state = 'regrouping';
          plan.attack++;
          plan.since = time;
          plan.roster = [];
        }
        continue;
      }
      if (plan.state === 'regrouping' && time - plan.since < REGROUP * this.scale) continue;
      // While every one of the team's bases is under attack, it stays home and fights it out first.
      const targeted = this.targetedSides(ctx);
      if (members.every((f) => targeted.has(f) && !this.shelledFromWater(world, ctx, f))) {
        plan.state = 'defending';
        continue;
      }
      plan.state = 'massing';
      // Comms relays make a team impatient sooner.
      const relays = members.reduce((sum, f) => sum + outpostBonus(ctx, f, 'readiness'), 0);
      // Its Commanders' styles make it want more or less of an edge (see commander/advice.ts).
      const style = members.reduce((sum, f) => sum + STYLES[ctx.settings.factions[f]?.style ?? 'balanced'].margin, 0) / members.length;
      // King of the hill: the closer the holder is to winning, the less of an edge a team waits for, and the smaller an army it goes with.
      const urgency = hillUrgency(ctx, members[0]);
      plan.need = this.defence(world, ctx, target, members[0]) * this.margin((time - plan.since) * (1 + relays)) * style * (1 - 0.5 * urgency);
      const units = members.reduce((s, f) => s + count[f], 0);
      const cap = members.reduce((s, f) => s + armyCap(ctx, f), 0) * (1 - 0.5 * urgency);
      plan.ready = Math.min(1, plan.need > 0 ? plan.army / plan.need : 1, units / (cap * MIN_ARMY));
      if (units >= cap * MIN_ARMY && plan.army >= plan.need) {
        plan.state = 'attacking';
        plan.since = time;
        plan.target = target;
        plan.roster = [];
        for (const e of world.query(Unit, Faction, Armed, Health)) {
          if (!world.has(e, Guard) && members.includes(world.req(e, Faction).id)) plan.roster.push(e);
        }
        plan.launch = plan.roster.reduce((s, e) => s + fightingStrength(world, e), 0);
      }
    }
  }

  /**
   * Sides some enemy team is attacking right now. In king of the hill every
   * attack is for the hill (a team holding it is only keeping it), so none
   * is on a base: an army that does turn up at one is met as any is (see
   * Sides.defencePoint), and the rest don't stay home for an attack that
   * isn't coming.
   */
  private targetedSides(ctx: SimContext): Set<number> {
    const out = new Set<number>();
    if (ctx.hill) return out;
    for (const [team, plan] of this.plans) {
      if (plan.state !== 'attacking') continue;
      const lead = this.sides.standing().find((f) => this.sides.teams[f] === team);
      if (lead === undefined) continue;
      const t = this.sides.target(lead, plan.attack);
      if (t !== null) out.add(t);
    }
    return out;
  }

  /** Whether the enemy strength near a side's base is mostly afloat (see AFLOAT). */
  private shelledFromWater(world: World, ctx: SimContext, side: number): boolean {
    const base = ctx.field.baseSites[side];
    let afloat = 0;
    let all = 0;
    ctx.grid.forEachNear(base.x, base.z, DEFENCE_RANGE, (e) => {
      const f = world.get(e, Faction);
      if (!f || !world.has(e, Unit) || !this.sides.hostile(side, f.id)) return;
      const s = fightingStrength(world, e);
      all += s;
      if (world.get(e, Mover)?.move === 'naval') afloat += s;
    });
    return all > 0 && afloat >= all * AFLOAT;
  }

  /**
   * Strength at an enemy base: its team's units nearby and its armed
   * buildings. In king of the hill, attacks go for the hill, so it's the
   * strength round the hill (its holder's or garrison's, and anyone else
   * fighting there) that `side` would have to beat.
   */
  private defence(world: World, ctx: SimContext, target: number, side: number): number {
    const hill = hillOf(ctx);
    if (hill) {
      if (this.sides.allied(hill.owner, side)) return 0;
      let sum = 0;
      ctx.grid.forEachNear(hill.x, hill.z, CAPTURE_RADIUS + 14, (e) => {
        const f = world.get(e, Faction);
        if (!f || !this.sides.hostile(f.id, side) || !world.has(e, Transform)) return;
        sum += fightingStrength(world, e);
      });
      return sum;
    }
    const base = ctx.field.baseSites[target];
    let sum = 0;
    ctx.grid.forEachNear(base.x, base.z, DEFENCE_RANGE, (e) => {
      const f = world.get(e, Faction);
      if (!f || !this.sides.allied(f.id, target) || !world.has(e, Transform)) return;
      sum += fightingStrength(world, e);
    });
    return sum;
  }
}

/** Decides, about once a second, when each team attacks and falls back (readiness timing only). */
export function offensiveSystem(ctx: SimContext): System {
  let next = 0;
  return {
    name: 'offensive',
    update(world) {
      // On the tide, only king of the hill's last pushes are planned here.
      if ((ctx.settings.armies.attackTiming !== 'readiness' && !ctx.hill) || world.time < next) return;
      next = world.time + CHECK_INTERVAL;
      ctx.offensive.update(world, ctx);
    },
  };
}

function isList(w: WeaponDef | readonly WeaponDef[]): w is readonly WeaponDef[] {
  return Array.isArray(w);
}
