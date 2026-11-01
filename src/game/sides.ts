import { System } from '../core/ecs';
import { hashSeed, Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { Faction, Unit } from './components';
import { SimContext } from './context';

/**
 * Who is fighting whom. Each side (faction) belongs to a team; sides on the
 * same team are allies, everyone else is an enemy. This is the one place
 * those relations are decided, so later rules (say, a side that only fights
 * certain others) only need to change here.
 *
 * It also decides which enemy a team goes after in each attack, and when
 * each team's tide surges.
 */
/** Enemy units at an ally's base before its teammates come to help. */
const DEFEND_THRESHOLD = 4;

export class Sides {
  /** Number of sides. */
  readonly count: number;
  /** Distinct teams, in order of their lowest-numbered side. */
  readonly teamList: number[];
  /** Tide phase offset per side, 0..1: allies share one, teams are spread evenly round the cycle. */
  readonly phase: number[];
  /** Conquest: sides that have lost every production building. */
  readonly eliminated: boolean[];
  /** When each side was knocked out, or null. */
  readonly eliminatedAt: (number | null)[];
  /**
   * Production and unit cap multiplier per side. With uneven teams evened
   * out, a side on a smaller team gets more (alone against three, 3×), so
   * every team fields about the same army.
   */
  readonly strength: number[];
  /** Enemy units at each side's base right now (see defenceSystem). */
  readonly threat: number[];
  private readonly targets = new Map<string, number | null>();

  constructor(
    /** Team of each side. */
    readonly teams: readonly number[],
    private readonly field: Battlefield,
    private readonly seed: number,
    /** Rotates which team surges first (a coin flip per map, so nobody always goes first). */
    rotation: number,
    /** Give smaller teams bigger armies (see `strength`). */
    evenTeams = true,
  ) {
    this.count = teams.length;
    this.teamList = [...new Set(teams)];
    const t = this.teamList.length;
    this.phase = teams.map((team) => ((this.teamList.indexOf(team) + rotation) % t) / t);
    this.eliminated = teams.map(() => false);
    this.eliminatedAt = teams.map(() => null);
    const size = (team: number) => teams.filter((t) => t === team).length;
    const largest = Math.max(...this.teamList.map(size));
    this.strength = teams.map((team) => (evenTeams ? largest / size(team) : 1));
    this.threat = teams.map(() => 0);
  }

  /** A side's unit cap after its strength is applied. */
  unitCap(faction: number, cap: number): number {
    return Math.round(cap * this.strength[faction]);
  }

  /**
   * The ally (not `faction` itself) whose base is under the heaviest attack,
   * if it's a real attack and worse than anything at home. Holding units go
   * and help there, so a team defends together.
   */
  allyInNeed(faction: number): number | null {
    let best: number | null = null;
    let worst = Math.max(DEFEND_THRESHOLD, this.threat[faction]);
    for (let f = 0; f < this.count; f++) {
      if (f === faction || this.eliminated[f] || !this.allied(f, faction)) continue;
      if (this.threat[f] > worst) {
        worst = this.threat[f];
        best = f;
      }
    }
    return best;
  }

  /** Knock a side out of the battle. */
  eliminate(faction: number, time: number): void {
    this.eliminated[faction] = true;
    this.eliminatedAt[faction] = time;
  }

  /** Whether a and b fight each other. The neutral town (-1) is nobody's enemy and nobody's ally. */
  hostile(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && a !== b && this.teams[a] !== this.teams[b];
  }

  /** Whether a and b are on the same side or team. */
  allied(a: number, b: number): boolean {
    return a === b || (a >= 0 && b >= 0 && this.teams[a] === this.teams[b]);
  }

  /** Sides still in the fight that `faction` is at war with. */
  enemiesOf(faction: number): number[] {
    const out: number[] = [];
    for (let f = 0; f < this.count; f++) if (!this.eliminated[f] && this.hostile(faction, f)) out.push(f);
    return out;
  }

  /** Sides still in the fight. */
  standing(): number[] {
    const out: number[] = [];
    for (let f = 0; f < this.count; f++) if (!this.eliminated[f]) out.push(f);
    return out;
  }

  /**
   * The enemy side `faction` attacks in attack number `attack`, or null if it
   * has no enemies left. Picked once per team and attack, so allies push the
   * same enemy together. Nearer enemies are likelier picks, so neighbours
   * fight most but far sides still get visited.
   */
  target(faction: number, attack: number): number | null {
    const team = this.teams[faction];
    const key = `${team}:${attack}:${this.eliminated.map((e) => (e ? 1 : 0)).join('')}`;
    let pick = this.targets.get(key);
    if (pick !== undefined) return pick;
    // Picks are deterministic, so forgetting old ones only costs a recompute.
    if (this.targets.size > 500) this.targets.clear();
    const enemies = this.enemiesOf(faction);
    const allies = this.teams.map((t, f) => (t === team && !this.eliminated[f] ? f : -1)).filter((f) => f >= 0);
    const from = allies.length > 0 ? allies : [faction];
    // Distance from the team's bases to each enemy base.
    const weights = enemies.map((e) => {
      const b = this.field.baseSites[e];
      const d = from.reduce((s, f) => s + Math.hypot(this.field.baseSites[f].x - b.x, this.field.baseSites[f].z - b.z), 0) / from.length;
      return 1 / (d * d);
    });
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = new Rng(hashSeed(`${this.seed}:target:${team}:${attack}`)).range(0, total);
    pick = enemies.find((_, i) => (roll -= weights[i]) <= 0) ?? enemies[enemies.length - 1] ?? null;
    this.targets.set(key, pick);
    return pick;
  }
}

/** How far from a base's centre enemy units count as attacking it. */
const THREAT_RANGE = 30;

/** Seconds between threat counts; sending help doesn't need to be instant. */
const THREAT_INTERVAL = 1;

/** Counts the enemy units at each side's base, for allies coming to help (Sides.allyInNeed). */
export function defenceSystem(ctx: SimContext): System {
  let next = 0;
  return {
    name: 'defence',
    update(world) {
      if (world.time < next) return;
      next = world.time + THREAT_INTERVAL;
      const { sides, field } = ctx;
      for (let f = 0; f < sides.count; f++) {
        const base = field.baseSites[f];
        let n = 0;
        ctx.grid.forEachNear(base.x, base.z, THREAT_RANGE, (other) => {
          if (world.has(other, Unit) && sides.hostile(f, world.req(other, Faction).id)) n++;
        });
        sides.threat[f] = n;
      }
    },
  };
}
