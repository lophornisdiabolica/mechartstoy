import { System, World } from '../core/ecs';
import { Armed, Faction, Guard, Health, Transform, Unit } from './components';
import { SimContext } from './context';
import { AttackTiming, MAP_SIZES } from './settings';
import { Sides } from './sides';
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
}

/**
 * Fighting strength of a unit or armed building: the square root of how
 * much punishment it can take times how fast it deals damage, so a group's
 * strength is roughly the sum of its members' (Lanchester's square law).
 */
export function fightingStrength(world: World, e: number): number {
  const h = world.get(e, Health);
  const a = world.get(e, Armed);
  if (!h || !a) return 0;
  const w = a.weapon;
  const dps = (w.damage * w.burst) / Math.max(0.1, w.cooldown);
  return Math.sqrt((h.hp / Math.max(0.05, 1 - h.armor)) * dps);
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

  /** Whether a side is on the attack (before any player orders or a recall). */
  attacking(faction: number, time: number): boolean {
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

  /** Re-plan every team (see offensiveSystem). */
  update(world: World, ctx: SimContext): void {
    const { sides } = this;
    const time = world.time;
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
      const targeted = this.targetedSides();
      if (members.every((f) => targeted.has(f))) {
        plan.state = 'defending';
        continue;
      }
      plan.state = 'massing';
      plan.need = this.defence(world, ctx, target) * this.margin(time - plan.since);
      const units = members.reduce((s, f) => s + count[f], 0);
      const cap = members.reduce((s, f) => s + sides.unitCap(f, ctx.settings.armies.unitCap), 0);
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

  /** Sides some enemy team is attacking right now. */
  private targetedSides(): Set<number> {
    const out = new Set<number>();
    for (const [team, plan] of this.plans) {
      if (plan.state !== 'attacking') continue;
      const lead = this.sides.standing().find((f) => this.sides.teams[f] === team);
      if (lead === undefined) continue;
      const t = this.sides.target(lead, plan.attack);
      if (t !== null) out.add(t);
    }
    return out;
  }

  /** Strength at an enemy base: its team's units nearby and its armed buildings. */
  private defence(world: World, ctx: SimContext, target: number): number {
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
      if (ctx.settings.armies.attackTiming !== 'readiness' || world.time < next) return;
      next = world.time + CHECK_INTERVAL;
      ctx.offensive.update(world, ctx);
    },
  };
}
