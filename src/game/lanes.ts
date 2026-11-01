import { hashSeed, Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { NavGrid, Point } from '../world/navGrid';

/**
 * Lanes are the routes armies attack along: one straight down the middle
 * and one swinging wide along each side of the map. Each attack, a side
 * splits its squads between the centre and the flanks, so fighting spreads
 * across the whole battlefield instead of one front line.
 */
export const LANES = ['centre', 'north', 'south'] as const;
export type LaneId = 0 | 1 | 2;

/** Where lane waypoints sit, as fractions of the way from the west base to the east base. */
const STATIONS = [0.24, 0.5, 0.76];
/** How far each flank swings out from the centre line at each station, as a fraction of map depth. */
const FLANK_SWING = [0.24, 0.33, 0.24];
/** Waypoints are placed where a Titan fits. */
const WAYPOINT_ROOM = 1.6;
/** Share of flanking squads that take this attack's favoured flank. */
const FAVOURED_FLANK = 0.7;

export class Lanes {
  /** Waypoints per lane, ordered west to east. */
  readonly points: Point[][];

  constructor(
    private readonly field: Battlefield,
    private readonly nav: NavGrid,
    private readonly seed: number,
  ) {
    const [west, east] = field.baseSites;
    this.points = LANES.map((_, lane) =>
      STATIONS.map((t, n) => {
        const x = west.x + (east.x - west.x) * t;
        const centreZ = west.z + (east.z - west.z) * t;
        const side = lane === 1 ? 1 : lane === 2 ? -1 : 0;
        return this.place(x, centreZ, side * FLANK_SWING[n] * field.depth);
      }),
    );
  }

  /**
   * Find a usable waypoint near (x, centreZ + offset): dry, roomy, and on the
   * same land as the bases. If the flank is cut off by water, pull it toward
   * the centre line until it isn't.
   */
  private place(x: number, centreZ: number, offset: number): Point {
    const base = this.field.baseSites[0];
    for (let k = 1; k >= 0; k -= 0.125) {
      const z = this.field.clampZ(centreZ + offset * k, 6);
      const cell = this.nav.nearestOpen(x, z, 4, WAYPOINT_ROOM);
      if (!cell) continue;
      const p = this.nav.center(cell[0], cell[1]);
      if (this.nav.connected(p, base)) return p;
    }
    return { x, z: centreZ };
  }

  /** How far a point is along the way from this faction's base to the enemy's, 0 to 1. */
  progress(faction: number, x: number): number {
    const own = this.field.baseSites[faction];
    const enemy = this.field.baseSites[1 - faction];
    return (x - own.x) / (enemy.x - own.x);
  }

  /** The next lane waypoint ahead of a unit, or null once it's past them all (time to hit the base). */
  nextWaypoint(faction: number, lane: LaneId, x: number): Point | null {
    const here = this.progress(faction, x);
    const route = faction === 0 ? this.points[lane] : [...this.points[lane]].reverse();
    // A little slack so a unit that's level with a waypoint moves on rather than circling it.
    return route.find((p) => this.progress(faction, p.x) > here + 0.03) ?? null;
  }

  /** Where a squad on this lane forms up before attacking: in front of its base, leaning toward its lane. */
  rally(faction: number, lane: LaneId): Point {
    const base = this.field.baseSites[faction];
    const first = faction === 0 ? this.points[lane][0] : this.points[lane][this.points[lane].length - 1];
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
