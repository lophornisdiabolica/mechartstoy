import { hashSeed, Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { NavGrid, Point } from '../world/navGrid';

/**
 * Lanes are the routes armies attack along: one straight from base to base
 * and one swinging wide to each side of that line. Each attack, a side
 * splits its squads between the centre and the flanks, so fighting spreads
 * across the whole battlefield instead of one front line.
 */
export const LANES = ['centre', 'north', 'south'] as const;
export type LaneId = 0 | 1 | 2;

/** Where lane waypoints sit, as fractions of the way from one base to the other. */
const STATIONS = [0.24, 0.5, 0.76];
/**
 * How far each flank swings out from the centre line at each station, as a
 * fraction of the swing room: the map depth, or a little more than the
 * distance between the bases if that's shorter (neighbouring bases).
 */
const FLANK_SWING = [0.24, 0.33, 0.24];
/** Waypoints are placed where a Titan fits. */
const WAYPOINT_ROOM = 1.6;
/** Share of flanking squads that take this attack's favoured flank. */
const FAVOURED_FLANK = 0.7;

/**
 * The lanes between every pair of bases. Routes are worked out the first
 * time a pair is used (most pairs never fight in a two-sided battle) and
 * shared both ways: the north flank from A to B is the same ground as from B
 * to A.
 */
export class Lanes {
  /** Lanes per base pair, keyed "a-b" with a < b, waypoints ordered from a to b. */
  private readonly pairs = new Map<string, Point[][]>();

  constructor(
    private readonly field: Battlefield,
    private readonly nav: NavGrid,
    private readonly seed: number,
  ) {}

  /** Waypoints of every lane from `from`'s base to `to`'s, in travel order. Index by LaneId. */
  lanes(from: number, to: number): Point[][] {
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const key = `${a}-${b}`;
    let lanes = this.pairs.get(key);
    if (!lanes) {
      lanes = this.build(a, b);
      this.pairs.set(key, lanes);
    }
    return from === a ? lanes : lanes.map((points) => [...points].reverse());
  }

  private build(from: number, to: number): Point[][] {
    const a = this.field.baseSites[from];
    const b = this.field.baseSites[to];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    // Unit normal to the line between the bases; lane 1 swings to its left (north, for west to east).
    const nx = -(b.z - a.z) / length;
    const nz = (b.x - a.x) / length;
    const room = Math.min(this.field.depth, length * 1.2);
    return LANES.map((_, lane) =>
      STATIONS.map((t, n) => {
        const side = lane === 1 ? 1 : lane === 2 ? -1 : 0;
        return this.place(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, nx, nz, side * FLANK_SWING[n] * room, a);
      }),
    );
  }

  /**
   * Find a usable waypoint near (x, z) + offset along the normal: dry, roomy,
   * and on the same land as the bases. If the flank is cut off by water, pull
   * it toward the centre line until it isn't.
   */
  private place(x: number, z: number, nx: number, nz: number, offset: number, base: Point): Point {
    for (let k = 1; k >= 0; k -= 0.125) {
      const px = this.field.clampX(x + nx * offset * k, 6);
      const pz = this.field.clampZ(z + nz * offset * k, 6);
      const cell = this.nav.nearestOpen(px, pz, 4, WAYPOINT_ROOM);
      if (!cell) continue;
      const p = this.nav.center(cell[0], cell[1]);
      if (this.nav.connected(p, base)) return p;
    }
    return { x, z };
  }

  /** How far a point is along the way from one base to another, 0 at `from` and 1 at `to`. */
  progress(from: number, to: number, x: number, z: number): number {
    const a = this.field.baseSites[from];
    const b = this.field.baseSites[to];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz);
  }

  /** The next lane waypoint ahead of a unit heading from `from`'s base to `to`'s, or null once it's past them all (time to hit the base). */
  nextWaypoint(from: number, to: number, lane: LaneId, x: number, z: number): Point | null {
    const here = this.progress(from, to, x, z);
    // A little slack so a unit that's level with a waypoint moves on rather than circling it.
    return this.lanes(from, to)[lane].find((p) => this.progress(from, to, p.x, p.z) > here + 0.03) ?? null;
  }

  /** Where a squad forms up before attacking `to` down this lane: in front of its base, leaning toward the lane. */
  rally(from: number, to: number, lane: LaneId): Point {
    const base = this.field.baseSites[from];
    const first = this.lanes(from, to)[lane][0];
    return { x: base.x + (first.x - base.x) * 0.5, z: base.z + (first.z - base.z) * 0.5 };
  }

  /**
   * The lane a squad takes in a given attack. `flanking` is the share of
   * squads sent wide; each attack favours one flank, so a side's push
   * changes shape from one attack to the next. Deterministic per
   * (faction, attack, squad), so a squad stays together.
   */
  laneFor(faction: number, attack: number, squad: number, flanking: number): LaneId {
    const plan = new Rng(hashSeed(`${this.seed}:${faction}:${attack}`));
    const favoured: LaneId = plan.chance(0.5) ? 1 : 2;
    const roll = new Rng(hashSeed(`${this.seed}:${faction}:${attack}:${squad}`));
    if (!roll.chance(flanking)) return 0;
    return roll.chance(FAVOURED_FLANK) ? favoured : favoured === 1 ? 2 : 1;
  }
}
