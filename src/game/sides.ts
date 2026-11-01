import { System } from '../core/ecs';
import { hashSeed, Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { Faction, GARRISON, Transform, Unit } from './components';
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
/** Enemy units at a base before its holding units (and its allies') go to meet them. */
const DEFEND_THRESHOLD = 4;

/** Enemy units at a base, outnumbering its defenders, before a side calls off its attack and comes home. */
const RECALL_THRESHOLD = 6;

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
   * out, a side on a smaller team gets more, so every team fields about the
   * same army: (largest team / its team)^evenness, so alone against three
   * gets 3× at evenness 1.
   */
  readonly strength: number[];
  /** Enemy units at each side's base right now (see defenceSystem). */
  readonly threat: number[];
  /** Where those enemy units are (their average position), per side; meaningless while threat is 0. */
  readonly threatAt: { x: number; z: number }[];
  /** Units of the side and its allies at its base right now. */
  readonly guard: number[];
  /**
   * Sides whose base is under an attack its defenders can't hold: their
   * attack is called off and the army comes home until the base is safe.
   */
  readonly recalling: boolean[];
  private readonly targets = new Map<string, number | null>();

  constructor(
    /** Team of each side. */
    readonly teams: readonly number[],
    private readonly field: Battlefield,
    private readonly seed: number,
    /** Rotates which team surges first (a coin flip per map, so nobody always goes first). */
    rotation: number,
    /** How much bigger smaller teams' armies get, 0 (not at all) to 1 (in full proportion); see `strength`. */
    evenness = 1,
  ) {
    this.count = teams.length;
    this.teamList = [...new Set(teams)];
    const t = this.teamList.length;
    this.phase = teams.map((team) => ((this.teamList.indexOf(team) + rotation) % t) / t);
    this.eliminated = teams.map(() => false);
    this.eliminatedAt = teams.map(() => null);
    const size = (team: number) => teams.filter((t) => t === team).length;
    const largest = Math.max(...this.teamList.map(size));
    this.strength = teams.map((team) => (largest / size(team)) ** evenness);
    this.threat = teams.map(() => 0);
    this.threatAt = teams.map(() => ({ x: 0, z: 0 }));
    this.guard = teams.map(() => 0);
    this.recalling = teams.map(() => false);
  }

  /**
   * Where a side's holding units should go to defend, or null if nothing
   * needs defending: its own base if enemies are there, else the ally
   * that needs help most. The point is between the attackers and the base,
   * so defenders meet the attack on whichever side it comes from.
   */
  defencePoint(faction: number): { x: number; z: number; face: { x: number; z: number } } | null {
    const f = this.threat[faction] >= DEFEND_THRESHOLD ? faction : this.allyInNeed(faction);
    if (f === null) return null;
    const base = this.field.baseSites[f];
    const at = this.threatAt[f];
    return { x: base.x + (at.x - base.x) * 0.8, z: base.z + (at.z - base.z) * 0.8, face: at };
  }

  /** Whether enemies are at a side's own base in strength (see defencePoint). */
  underAttack(faction: number): boolean {
    return this.threat[faction] >= DEFEND_THRESHOLD;
  }

  /** Update a side's threat count and recall state (see defenceSystem). */
  assess(faction: number, threat: number, x: number, z: number, guard: number): void {
    this.threat[faction] = threat;
    this.threatAt[faction] = { x, z };
    this.guard[faction] = guard;
    // Call the army home when the defenders are outnumbered; stand down once the
    // attack is beaten off or enough defenders are back (with slack, so units don't
    // turn round and round as the numbers wobble).
    this.recalling[faction] = this.recalling[faction]
      ? threat >= DEFEND_THRESHOLD && guard < threat * 1.5
      : threat >= RECALL_THRESHOLD && guard < threat;
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

  /**
   * Whether a and b fight each other. The neutral town is nobody's enemy and
   * nobody's ally; an outpost's garrison fights every side.
   */
  hostile(a: number, b: number): boolean {
    if (a === GARRISON || b === GARRISON) return a !== b && (a >= 0 || b >= 0);
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

/**
 * Counts the enemy units at each side's base and the defenders there, so
 * holding units go to meet an attack (Sides.defencePoint) and an army out
 * attacking comes home when its base can't hold (Sides.recalling).
 */
export function defenceSystem(ctx: SimContext): System {
  let next = 0;
  return {
    name: 'defence',
    update(world) {
      if (world.time < next) return;
      next = world.time + THREAT_INTERVAL;
      const { sides, field } = ctx;
      for (let f = 0; f < sides.count; f++) {
        if (sides.eliminated[f]) {
          sides.assess(f, 0, 0, 0, 0);
          continue;
        }
        const base = field.baseSites[f];
        let n = 0;
        let guard = 0;
        let x = 0;
        let z = 0;
        ctx.grid.forEachNear(base.x, base.z, THREAT_RANGE, (other) => {
          if (!world.has(other, Unit)) return;
          const id = world.req(other, Faction).id;
          if (sides.allied(f, id)) {
            guard++;
          } else if (sides.hostile(f, id)) {
            const t = world.req(other, Transform);
            x += t.x;
            z += t.z;
            n++;
          }
        });
        sides.assess(f, n, n > 0 ? x / n : base.x, n > 0 ? z / n : base.z, guard);
      }
    },
  };
}
