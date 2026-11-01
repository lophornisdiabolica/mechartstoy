import { hashSeed, Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { NavGrid, Point } from '../world/navGrid';

/**
 * Lanes are the routes armies attack along: one straight from base to base,
 * and one through each outpost or town that lies roughly between the two
 * bases. Each attack, a side splits its squads between the centre and the
 * other lanes, so fighting spreads across the map and the outposts and
 * towns become the places armies meet. Where nothing lies to one side of the
 * line between two bases, a lane swings wide on that side instead.
 */

/** Lane 0 is always the centre; the rest go through sites or swing wide. */
export type LaneId = number;

/** A place a lane goes through. */
export interface Via {
  kind: 'outpost' | 'town';
  /** Index in the battlefield's outpostSites or townSites. */
  index: number;
}

export interface Route {
  /** Waypoints in travel order. */
  points: Point[];
  /** The outpost or town the lane is built around, if any. */
  via: Via | null;
}

/** Where centre and swing-lane waypoints sit, as fractions of the way from one base to the other. */
const STATIONS = [0.24, 0.5, 0.76];
/**
 * How far each swing lane swings out from the centre line at each station, as a
 * fraction of the swing room: the map depth, or a little more than the
 * distance between the bases if that's shorter (neighbouring bases).
 */
const FLANK_SWING = [0.24, 0.33, 0.24];
/** Waypoints are placed where a Titan fits. */
const WAYPOINT_ROOM = 1.6;
/** Share of flanking squads that take this attack's favoured lane. */
const FAVOURED_FLANK = 0.7;
/** A site counts as "between" two bases if going through it is at most this much longer than going straight. */
const MAX_DETOUR = 1.5;
/** Sites closer than this to the straight line are on the centre lane already. */
const ON_CENTRE = 9;
/** At most this many lanes through sites per pair of bases, the most direct first. */
const MAX_SITE_LANES = 4;

/**
 * The lanes between every pair of bases. Routes are worked out the first
 * time a pair is used (most pairs never fight in a two-sided battle) and
 * shared both ways: the north flank from A to B is the same ground as from B
 * to A.
 */
export class Lanes {
  /** Lanes per base pair, keyed "a-b" with a < b, waypoints ordered from a to b. */
  private readonly pairs = new Map<string, Route[]>();

  constructor(
    private readonly field: Battlefield,
    private readonly nav: NavGrid,
    private readonly seed: number,
  ) {}

  /** Waypoints of every lane from `from`'s base to `to`'s, in travel order. Index by LaneId. */
  lanes(from: number, to: number): Point[][] {
    return this.routes(from, to).map((r) => r.points);
  }

  /** Every lane from `from`'s base to `to`'s, with what it goes through. Lane 0 is the centre. */
  routes(from: number, to: number): Route[] {
    const a = Math.min(from, to);
    const b = Math.max(from, to);
    const key = `${a}-${b}`;
    let routes = this.pairs.get(key);
    if (!routes) {
      routes = this.build(a, b);
      this.pairs.set(key, routes);
    }
    return from === a ? routes : routes.map((r) => ({ points: [...r.points].reverse(), via: r.via }));
  }

  private build(from: number, to: number): Route[] {
    const a = this.field.baseSites[from];
    const b = this.field.baseSites[to];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    // Unit normal to the line between the bases; swing lane 1 goes to its left (north, for west to east).
    const nx = -(b.z - a.z) / length;
    const nz = (b.x - a.x) / length;
    const straight = (t: number, offset: number) => this.place(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, nx, nz, offset, a);

    // Outposts and towns roughly between the bases, the most direct first.
    const sites: (Via & { x: number; z: number; detour: number; side: number })[] = [];
    const consider = (kind: Via['kind'], index: number, x: number, z: number) => {
      const t = ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (length * length);
      const detour = (Math.hypot(x - a.x, z - a.z) + Math.hypot(b.x - x, b.z - z)) / length;
      if (t > 0.12 && t < 0.88 && detour <= MAX_DETOUR) sites.push({ kind, index, x, z, detour, side: (x - a.x) * nx + (z - a.z) * nz });
    };
    this.field.outpostSites.forEach((o) => consider('outpost', o.index, o.x, o.z));
    this.field.townSites.forEach((t, i) => consider('town', i, t.x, t.z));
    sites.sort((p, q) => p.detour - q.detour);

    // The centre lane; if a site sits on the straight line, the centre lane is its lane.
    const centreSite = sites.find((p) => Math.abs(p.side) < ON_CENTRE) ?? null;
    const centre: Route = { points: STATIONS.map((t) => straight(t, 0)), via: centreSite && { kind: centreSite.kind, index: centreSite.index } };
    const off = sites.filter((p) => p !== centreSite).slice(0, MAX_SITE_LANES);
    const room = Math.min(this.field.depth, length * 1.2);
    const swing = (side: number): Route => ({ points: STATIONS.map((t, n) => straight(t, side * FLANK_SWING[n] * room)), via: null });
    // Nothing out to one side: swing wide that way anyway, so attacks still split across the whole map.
    const left = off.some((p) => p.side > 0) ? [] : [swing(1)];
    const right = off.some((p) => p.side < 0) ? [] : [swing(-1)];
    if (off.length === 0) return [centre, ...left, ...right];
    // Left-hand lanes first, then right, each outward from the centre, so lane order reads across the map.
    off.sort((p, q) => (Math.sign(q.side) - Math.sign(p.side)) || Math.abs(p.side) - Math.abs(q.side));
    const through: Route[] = [];
    for (const p of off) {
      // Halfway there, the site itself, and halfway on to the enemy (any that are under water are skipped).
      const site = this.near(p.x, p.z, a);
      if (!site) continue;
      const points = [this.near((a.x + p.x) / 2, (a.z + p.z) / 2, a), site, this.near((p.x + b.x) / 2, (p.z + b.z) / 2, a)].filter((q): q is Point => q !== null);
      through.push({ points, via: { kind: p.kind, index: p.index } });
    }
    return [centre, ...left, ...through, ...right];
  }

  /** The nearest usable waypoint to (x, z) that the bases can reach, looking a little further out if need be. */
  private near(x: number, z: number, base: Point): Point | null {
    for (const radius of [4, 8, 14]) {
      const cell = this.nav.nearestOpen(this.field.clampX(x, 6), this.field.clampZ(z, 6), radius, WAYPOINT_ROOM);
      if (!cell) continue;
      const p = this.nav.center(cell[0], cell[1]);
      if (this.nav.connected(p, base)) return p;
    }
    return null;
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
   * The lane a squad takes in a given attack on `target`. `flanking` is the
   * share of squads sent off the centre; each attack favours one of the
   * other lanes, so a side's push changes shape from one attack to the next.
   * Deterministic per (faction, attack, squad), so a squad stays together.
   */
  laneFor(faction: number, target: number, attack: number, squad: number, flanking: number): LaneId {
    const count = this.routes(faction, target).length;
    if (count < 2) return 0;
    const plan = new Rng(hashSeed(`${this.seed}:${faction}:${attack}`));
    const favoured = plan.int(1, count - 1);
    const roll = new Rng(hashSeed(`${this.seed}:${faction}:${attack}:${squad}`));
    if (!roll.chance(flanking)) return 0;
    if (count === 2 || roll.chance(FAVOURED_FLANK)) return favoured;
    // One of the others, never the favoured one twice over.
    const other = roll.int(1, count - 2);
    return other >= favoured ? other + 1 : other;
  }
}
