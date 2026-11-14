import { Entity, System, World } from '../core/ecs';
import { MOVE_RULES } from '../world/moveClasses';
import { NavGrid, Point } from '../world/navGrid';
import { Collider, Mover, Transform } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';

/**
 * Narrow passages and the traffic on them: bridges now, narrow city streets
 * later. A narrow is a straight stretch of way with a width (its centreline
 * from a to b). Vehicles (see MoveRules.queues) that would meet head-on on
 * one and can't fit side by side take turns instead of nosing into each
 * other in the middle: one waiting just off to the side of its mouth, so the
 * oncoming ones have the whole way out, until they're past.
 *
 * - Each vehicle looks a little way down its route for the next narrow it
 *   runs along (in at one end, out at the other) and which way.
 * - Per narrow, the vehicles on it hold the way for their direction. One
 *   coming the other way waits at the mouth unless it fits beside them.
 * - Taking turns: when vehicles have waited at one end for YIELD seconds,
 *   no more are let on from the other end until it clears.
 * - A busy narrow costs more to plan a route over (NavObstacles.traffic),
 *   so a group setting off together spreads over the crossings there are,
 *   rather than all queueing at the nearest one.
 *
 * Anything can add narrows (the map's bridges are added for it, engineers'
 * bridges as they go up and come down); see Traffic.add.
 */
export interface Narrow {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Full width of the way, edge to edge. */
  width: number;
  /** What it is, for anything that cares ('bridge', 'street'...). */
  kind: string;
}

/** Room two vehicles want between them to pass side by side on a narrow. */
const PASS_GAP = 0.8;
/** How far from a narrow's mouth (beyond a vehicle's radius) a vehicle heading onto it is held. */
const APPROACH = 5;
/** Seconds vehicles at one end wait before the other end stops letting more on. */
const YIELD = 7;
/** Longest a vehicle waits at a mouth before it goes anyway (something parked on the bridge, say). */
const MAX_HOLD = 14;
/** How far down its route a vehicle looks for the next narrow, and the step it checks the route at. */
const LOOK_AHEAD = 45;
const LOOK_STEP = 1;
/** Seconds between a vehicle looking for its next narrow again. */
const LANE_CHECK = 0.6;
/**
 * Extra route cost per nav cell of a narrow, per vehicle on it or queueing
 * for it: about how far round (in metres per metre of narrow) another way
 * may go to skip the queue.
 */
const BUSY_COST = 0.35;
/** Busy cost stops growing past this many vehicles. */
const BUSY_MOST = 10;
/** Vehicles smaller than this radius slip past like infantry. */
const MIN_RADIUS = 0.55;

interface Lane {
  narrow: Narrow;
  length: number;
  /** Unit vector from a to b. */
  ux: number;
  uz: number;
  /** Nav cells it covers (for the busy cost). */
  cells: number[];
  /** Bounds, for quick misses. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** When vehicles started waiting at each end (index 0: going a to b; 1: b to a), Infinity while none is. */
  waitSince: [number, number];
  /** The busy cost it last put on its cells. */
  busy: number;
  /** The map bridge it is (index into Battlefield.bridges), if one. */
  bridge: number;
}

/** Where a point is against a lane: metres along from a, and metres off the centreline (signed, left positive). */
function local(lane: Lane, x: number, z: number): { s: number; off: number } {
  const ox = x - lane.narrow.ax;
  const oz = z - lane.narrow.az;
  return { s: ox * lane.ux + oz * lane.uz, off: ox * -lane.uz + oz * lane.ux };
}

function inside(lane: Lane, x: number, z: number, margin = 0): boolean {
  const { s, off } = local(lane, x, z);
  return s >= -margin && s <= lane.length + margin && Math.abs(off) <= lane.narrow.width / 2 + margin;
}

export class Traffic {
  private readonly lanes: (Lane | null)[] = [];
  /** Lane ids by map bridge index. */
  private readonly byBridge = new Map<number, number>();

  constructor(private readonly nav: NavGrid) {}

  /** Add a narrow passage. Returns its id (for remove). */
  add(narrow: Narrow, bridge = -1): number {
    const dx = narrow.bx - narrow.ax;
    const dz = narrow.bz - narrow.az;
    const length = Math.max(0.01, D.hypot(dx, dz));
    const half = narrow.width / 2;
    const lane: Lane = {
      narrow,
      length,
      ux: dx / length,
      uz: dz / length,
      cells: [],
      minX: Math.min(narrow.ax, narrow.bx) - half,
      maxX: Math.max(narrow.ax, narrow.bx) + half,
      minZ: Math.min(narrow.az, narrow.bz) - half,
      maxZ: Math.max(narrow.az, narrow.bz) + half,
      waitSince: [Infinity, Infinity],
      busy: 0,
      bridge,
    };
    const nav = this.nav;
    const [i0, j0] = nav.cellOf(lane.minX, lane.minZ);
    const [i1, j1] = nav.cellOf(lane.maxX, lane.maxZ);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = nav.center(i, j);
        if (inside(lane, c.x, c.z)) lane.cells.push(j * nav.cols + i);
      }
    }
    this.lanes.push(lane);
    if (bridge >= 0) this.byBridge.set(bridge, this.lanes.length - 1);
    return this.lanes.length - 1;
  }

  /** Take a narrow away (a bridge that came down). Its id isn't reused. */
  remove(id: number): void {
    const lane = this.lanes[id];
    if (!lane) return;
    this.setBusy(lane, 0);
    this.lanes[id] = null;
    if (lane.bridge >= 0) this.byBridge.delete(lane.bridge);
  }

  get(id: number): Narrow | null {
    return this.lanes[id]?.narrow ?? null;
  }

  /** The narrows there are now, by id. */
  *all(): Generator<[number, Narrow]> {
    for (let id = 0; id < this.lanes.length; id++) {
      const lane = this.lanes[id];
      if (lane) yield [id, lane.narrow];
    }
  }

  /** The narrow a point is on (within `margin` of), or -1. */
  at(x: number, z: number, margin = 0): number {
    for (let id = 0; id < this.lanes.length; id++) {
      const lane = this.lanes[id];
      if (!lane || x < lane.minX - margin || x > lane.maxX + margin || z < lane.minZ - margin || z > lane.maxZ + margin) continue;
      if (inside(lane, x, z, margin)) return id;
    }
    return -1;
  }

  /**
   * The first narrow a route runs along (onto it at one end and off at the
   * other, or onto it and stopping there), from `from` through `points`,
   * looking LOOK_AHEAD metres down it: its id, and which way (1 from a to b),
   * or null. A route that only clips a corner, or crosses a street from
   * side to side, doesn't count.
   */
  along(from: Point, points: readonly Point[]): { id: number; dir: number } | null {
    if (this.lanes.length === 0) return null;
    let travelled = 0;
    let prev = from;
    // Per lane: the first and latest distance along it while the route was on it.
    const first = new Map<number, number>();
    const latest = new Map<number, number>();
    const done = (id: number): { id: number; dir: number } | null => {
      const lane = this.lanes[id]!;
      const s0 = first.get(id)!;
      const s1 = latest.get(id)!;
      first.delete(id);
      latest.delete(id);
      return Math.abs(s1 - s0) >= Math.min(lane.length * 0.5, Math.max(1, lane.length - 3)) ? { id, dir: s1 > s0 ? 1 : -1 } : null;
    };
    for (const p of points) {
      const seg = D.hypot(p.x - prev.x, p.z - prev.z);
      const steps = Math.max(1, Math.ceil(seg / LOOK_STEP));
      const sx = Math.min(prev.x, p.x);
      const ex = Math.max(prev.x, p.x);
      const sz = Math.min(prev.z, p.z);
      const ez = Math.max(prev.z, p.z);
      for (let id = 0; id < this.lanes.length; id++) {
        const lane = this.lanes[id];
        if (!lane) continue;
        const touches = ex >= lane.minX && sx <= lane.maxX && ez >= lane.minZ && sz <= lane.maxZ;
        if (!touches) {
          if (first.has(id)) {
            const hit = done(id);
            if (hit) return hit;
          }
          continue;
        }
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const x = prev.x + (p.x - prev.x) * t;
          const z = prev.z + (p.z - prev.z) * t;
          if (inside(lane, x, z)) {
            const s = local(lane, x, z).s;
            if (!first.has(id)) first.set(id, s);
            latest.set(id, s);
          } else if (first.has(id)) {
            const hit = done(id);
            if (hit) return hit;
          }
        }
      }
      travelled += seg;
      prev = p;
      if (travelled > LOOK_AHEAD) break;
    }
    // The route ends on a narrow (or looks no further): count it if it gets far enough along.
    for (const id of [...first.keys()]) {
      const hit = done(id);
      if (hit) return hit;
    }
    return null;
  }

  /** Keep the map's bridges registered: new ones (engineers', a god's) added, fallen ones taken away. */
  syncBridges(bridges: readonly { ax: number; az: number; bx: number; bz: number; width: number; gone?: boolean }[]): void {
    for (let b = 0; b < bridges.length; b++) {
      const bridge = bridges[b];
      const id = this.byBridge.get(b);
      if (bridge.gone) {
        if (id !== undefined) this.remove(id);
      } else if (id === undefined) {
        this.add({ ax: bridge.ax, az: bridge.az, bx: bridge.bx, bz: bridge.bz, width: bridge.width, kind: 'bridge' }, b);
      }
    }
  }

  private setBusy(lane: Lane, busy: number): void {
    if (Math.abs(busy - lane.busy) < 1e-6) return;
    const traffic = this.nav.obstacles.traffic;
    for (const k of lane.cells) traffic[k] = Math.max(0, traffic[k] - lane.busy + busy);
    lane.busy = busy;
  }

  /**
   * One tick of traffic: who's on each narrow and who's coming, who waits,
   * and how busy each one is for route planning. `queuers` are the vehicles
   * that take turns, with their radius.
   */
  update(world: World, queuers: { e: Entity; t: Transform; m: Mover; r: number }[]): void {
    const time = world.time;
    const n = this.lanes.length;
    if (n === 0) return;
    // Per lane: widest vehicle on it each way (0: a to b, 1: b to a; parked ones count both ways), and how many.
    const wideOn = Array.from({ length: n }, () => [0, 0]);
    const countOn = Array.from({ length: n }, () => [0, 0]);
    const coming: { e: Entity; t: Transform; m: Mover; r: number; lane: number; way: number; dist: number }[] = [];
    const busy = new Float64Array(n);
    for (const q of queuers) {
      const { t, m, r } = q;
      const nav = m.nav;
      const on = this.at(t.x, t.z, r * 0.5);
      if (on >= 0) {
        // On a narrow: it keeps the one it's on (the rest of the route may not reach the far end in view).
        if (nav.lane !== on) {
          nav.lane = on;
          nav.laneDir = this.wayFromHeading(on, t.heading);
        }
        const going = m.targetX !== null;
        const ways = going && nav.laneDir !== 0 ? [nav.laneDir > 0 ? 0 : 1] : [0, 1];
        for (const w of ways) {
          wideOn[on][w] = Math.max(wideOn[on][w], r * 2);
          countOn[on][w]++;
        }
        busy[on]++;
        nav.heldSince = Infinity;
        nav.laneGo = false;
        // Once off the far end it looks down its route afresh.
        nav.laneCheckAt = 0;
        continue;
      }
      if (m.targetX === null) {
        nav.lane = -1;
        nav.heldSince = Infinity;
        nav.laneGo = false;
        continue;
      }
      if (time >= nav.laneCheckAt) {
        nav.laneCheckAt = time + LANE_CHECK;
        const route = nav.path && !nav.direct ? nav.path.slice(nav.pathIndex) : [{ x: nav.goalX, z: nav.goalZ }];
        const hit = this.along({ x: t.x, z: t.z }, route);
        if (hit?.id !== nav.lane || hit?.dir !== nav.laneDir) nav.laneGo = false;
        nav.lane = hit?.id ?? -1;
        nav.laneDir = hit?.dir ?? 0;
      }
      const lane = nav.lane >= 0 ? this.lanes[nav.lane] : null;
      if (!lane) {
        nav.lane = -1;
        nav.heldSince = Infinity;
        nav.laneGo = false;
        continue;
      }
      busy[nav.lane]++;
      const mouth = nav.laneDir > 0 ? { x: lane.narrow.ax, z: lane.narrow.az } : { x: lane.narrow.bx, z: lane.narrow.bz };
      const dist = D.hypot(mouth.x - t.x, mouth.z - t.z);
      if (dist > r + APPROACH + lane.narrow.width / 2) {
        nav.heldSince = Infinity;
        nav.laneGo = false;
        continue;
      }
      const way = nav.laneDir > 0 ? 0 : 1;
      // Already let on: it has the way, as if it were on.
      if (nav.laneGo) {
        wideOn[nav.lane][way] = Math.max(wideOn[nav.lane][way], r * 2);
        countOn[nav.lane][way]++;
        continue;
      }
      coming.push({ ...q, lane: nav.lane, way, dist });
    }

    // Who goes and who waits, nearest first at each end.
    coming.sort((a, b) => a.dist - b.dist || a.e - b.e);
    const waiting: [boolean, boolean][] = Array.from({ length: n }, () => [false, false]);
    // How long the line waiting at each end is so far, in metres (each waits behind the ones before it).
    const queued = Array.from({ length: n }, () => [0, 0]);
    for (const c of coming) {
      const lane = this.lanes[c.lane]!;
      const other = 1 - c.way;
      const width = lane.narrow.width;
      // Oncoming traffic on the narrow, unless there's room beside it.
      let wait = countOn[c.lane][other] > 0 && wideOn[c.lane][other] + c.r * 2 + PASS_GAP > width;
      // Taking turns: the other end has waited long enough.
      if (!wait && lane.waitSince[other] < time - YIELD && countOn[c.lane][c.way] > 0) wait = true;
      // Both ends arriving at once onto an empty narrow: the end that's waited longer (or, level, the nearer vehicle) goes.
      if (!wait && countOn[c.lane][c.way] === 0 && countOn[c.lane][other] === 0 && lane.waitSince[other] < lane.waitSince[c.way]) wait = true;
      // Nothing waits for good: past MAX_HOLD it goes anyway (and doesn't wait again before it's on).
      const nav = c.m.nav;
      if (wait && (nav.heldSince === -Infinity || time - nav.heldSince > MAX_HOLD)) {
        wait = false;
        nav.heldSince = -Infinity;
      }
      if (wait) {
        waiting[c.lane][c.way] = true;
        this.hold(c.m, c.t, lane, c.way, c.r, time, queued[c.lane][c.way]);
        queued[c.lane][c.way] += c.r * 2 + 1;
      } else {
        // Just let go from waiting off to the side: plan afresh from there, up the ramp.
        if (nav.holdUntil > time - 0.5) {
          nav.holdUntil = -1;
          nav.path = null;
          nav.direct = false;
        }
        if (nav.heldSince !== -Infinity) nav.heldSince = Infinity;
        nav.laneGo = true;
        // Let on: it holds the way for its direction from now, as if it were on already.
        wideOn[c.lane][c.way] = Math.max(wideOn[c.lane][c.way], c.r * 2);
        countOn[c.lane][c.way]++;
      }
    }
    for (let id = 0; id < n; id++) {
      const lane = this.lanes[id];
      if (!lane) continue;
      for (const w of [0, 1]) {
        if (!waiting[id][w]) lane.waitSince[w] = Infinity;
        else if (lane.waitSince[w] === Infinity) lane.waitSince[w] = time;
      }
      this.setBusy(lane, BUSY_COST * Math.min(BUSY_MOST, busy[id]));
    }
  }

  /** Which way along a narrow a heading points (1 toward b). */
  private wayFromHeading(id: number, heading: number): number {
    const lane = this.lanes[id]!;
    return D.cos(heading) * lane.ux - D.sin(heading) * lane.uz >= 0 ? 1 : -1;
  }

  /**
   * Hold a vehicle at a narrow's mouth: just back from it and off to its
   * right, so oncoming vehicles coming off have the way clear. Where that
   * isn't open ground it waits where it is.
   */
  private hold(m: Mover, t: Transform, lane: Lane, way: number, r: number, time: number, behind: number): void {
    const nav = m.nav;
    if (nav.heldSince === Infinity) nav.heldSince = time;
    {
      const dir = way === 0 ? 1 : -1;
      const ux = lane.ux * dir;
      const uz = lane.uz * dir;
      const mouth = way === 0 ? { x: lane.narrow.ax, z: lane.narrow.az } : { x: lane.narrow.bx, z: lane.narrow.bz };
      // Its right, facing along the narrow the way it's going.
      const rx = uz;
      const rz = -ux;
      // In line behind the ones already waiting.
      const back = r + 2 + behind;
      const aside = lane.narrow.width / 2 + r * 0.6;
      let x = mouth.x - ux * back + rx * aside;
      let z = mouth.z - uz * back + rz * aside;
      const grid = this.gridFor(m);
      if (!grid || !grid.fitsAt(x, z, r) || grid.terrainBlocksCell(x, z)) {
        // No room there: wait where it stopped when first told to.
        if (nav.heldSince !== time) return void (nav.holdUntil = time + 0.25);
        x = t.x;
        z = t.z;
      }
      nav.holdX = x;
      nav.holdZ = z;
    }
    nav.holdUntil = time + 0.25;
  }

  /** The route grid a mover plans on (set by trafficSystem). */
  gridFor: (m: Mover) => NavGrid | null = () => this.nav;
}

/** Runs the traffic on narrow passages each tick (see Traffic), before units move. */
export function trafficSystem(ctx: SimContext): System {
  const traffic = ctx.traffic;
  traffic.gridFor = (m) => ctx.navs.for(m.move);
  return {
    name: 'traffic',
    update(world) {
      traffic.syncBridges(ctx.field.bridges);
      const queuers: { e: Entity; t: Transform; m: Mover; r: number }[] = [];
      for (const e of world.query(Mover, Transform, Collider)) {
        const m = world.req(e, Mover);
        if (!MOVE_RULES[m.move].queues || m.cruise) continue;
        const r = world.req(e, Collider).radius;
        if (r < MIN_RADIUS) continue;
        queuers.push({ e, t: world.req(e, Transform), m, r });
      }
      traffic.update(world, queuers);
    },
  };
}
