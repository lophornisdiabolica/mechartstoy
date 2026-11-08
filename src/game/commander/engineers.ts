import { Entity, System, World } from '../../core/ecs';
import { Building, Construction, Faction, Health, Rubble, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { spawnSpot } from '../systems/production';
import { spawnBuilding, spawnUnit } from '../spawn';
import { BuildingDef } from '../buildings';
import { doctrineOf, DoctrineId } from '../doctrines';
import { settle } from '../god';
import { STEEP_SLOPE } from '../../world/moveClasses';
import { CellArea } from '../../world/ground';
import { deepWaterArea, DOCK_DEPTH, findShore } from '../../world/settlements';
import { Heap, Point } from '../../world/navGrid';
import * as D from '../../core/dmath';

/*
 * Engineers (Commander step 6, and the doctrine jobs after it). Every
 * doctrine's HQ trains a few engineers when its Commander has work for them,
 * up to the engineers setting per side. What they build:
 *
 * - Fortification lines: a short line of wall segments across where the
 *   enemy will come, with a field tower (a guard tower, at most TOWERS_MOST
 *   per side) just behind. The lines go, best first: across a choke point
 *   on the enemy's way in that suits the side's doctrine (a valley between
 *   steep slopes for Talon's climbing walkers, a neck of land between
 *   waters for Tidewater's hovers; see MOBILITY), in front of outposts the
 *   side holds out toward the enemy, behind its army while it's pushing
 *   forward, and in front of each rally point. Engineers with nothing to
 *   build follow the army on a push, so the next line goes up where the
 *   front now is.
 * - Legion digs instead of building walls: a trench for its squads with an
 *   earth berm in front (see the 'trench' ground). Soldiers in the trench
 *   stand up to fire over the berm, while shots aimed at their bodies, down
 *   in the trench, mostly hit the berm unless fired from close by or from
 *   above, and bursts outside it reach them weakened. Massing squads man the
 *   trenches near their rally point.
 * - Bastion puts up comms arrays: masts at the front that spot for its guns
 *   like a small sensor mast, so howitzers fire at their full range there.
 * - Tidewater builds what its base lacks (a hover pad where it has a dock,
 *   a dock on the nearest shore where it hasn't) and digs canals: channels
 *   of boat-deep water, a few metres at a time, out from its water toward
 *   the enemy until its boats can shell the enemy base, or toward its own
 *   base when there's no shore near enough for a dock. A canal never cuts
 *   one base off from another by land.
 *
 * Walls, field towers and comms arrays crumble over BuildingDef.lasts and
 * aren't rebuilt, so they don't pile up; earthworks stay, but a side digs
 * at most EARTHWORKS_MOST lines and CANAL_MOST of canal.
 *
 * Engineers aren't part of the army: they take no cap, never join an attack
 * or a task force, and stay home when there's nothing to build. The rally
 * flag and a stance other than auto pause their work, like every other job.
 */

/** How far apart wall segments' centres are along a line, and how many make a line in front of a rally point. */
const SEGMENT_GAP = 2.6;
const SEGMENTS = 3;
/** Most segments across a choke point. */
const CHOKE_SEGMENTS = 4;
/** How far in front of the rally point, toward the enemy base, the line goes. */
const AHEAD = 7;
/** Most enemies a side fortifies against (the nearest). */
const FRONTS = 2;
/** Most walls a side has standing at once. */
export const WALLS_MOST = 10;
/** Seconds between engineers trained at one HQ. */
const TRAIN_EVERY = 40;
/** No building where an enemy unit is this close. */
const SAFE_RADIUS = 14;
/** How far behind its wall an engineer stands to build it, and how near that it has to be. */
const STAND_BACK = 2;
const REACH = 3;

/** Field towers a side has standing at once (a low cap: they're strong). */
export const TOWERS_MOST = 2;
/** How far behind the wall line a field tower goes. */
const TOWER_BACK = 3.5;
/** Comms arrays Bastion has standing at once, how far behind a line they go, and how far out along the way to the enemy the first one stands. */
export const ARRAYS_MOST = 2;
const ARRAY_BACK = 5;
const ARRAY_OUT = 0.38;

/**
 * Which doctrines get round a choke point better than their enemies, and
 * how: 'steep' (walkers that climb the slopes either side of a valley),
 * 'water' (hovers that cross the water either side of a neck of land) or
 * 'any' (aircraft and fast trucks that go round whatever's blocked). They
 * wall chokes further out than the rest, which only use chokes close to home.
 */
const MOBILITY: Partial<Record<DoctrineId, 'steep' | 'water' | 'any'>> = { talon: 'steep', tidewater: 'water', skyline: 'any', raiders: 'any' };
/** Furthest out, as a share of the way to the enemy base, a choke is walled: for doctrines in MOBILITY, and the rest. */
const CHOKE_REACH_MOBILE = 0.55;
const CHOKE_REACH = 0.32;
/** Widest gap that counts as a choke point, and how far either side of the route to look for its edges. */
const CHOKE_WIDEST = 9;
const CHOKE_SCAN = 7;

/** A held outpost gets a line this far in front of it, if it's at least FORWARD_GAIN further toward the enemy than the rally point. */
const OUTPOST_AHEAD = 8;
const FORWARD_GAIN = 0.12;
/** On a push, a line goes this far behind the army's middle once that's ARMY_GAIN past the rally point, on a grid of ARMY_SNAP so it doesn't chase every step. */
const ARMY_BACK = 6;
const ARMY_GAIN = 0.15;
const ARMY_SNAP = 6;
/** Engineers with nothing to build follow a push this far behind the army's middle. */
const FOLLOW_BACK = 11;

/** Legion's earthworks: a trench line's length, its depth, and the berm in front (how far, how high). */
export const EARTHWORKS_MOST = 6;
const TRENCH_LENGTH = 8;
const TRENCH_DEPTH = 0.55;
const TRENCH_HALF = 0.8;
const BERM_AHEAD = 1.8;
const BERM_HEIGHT = 0.5;
const BERM_HALF = 1.3;
/** How far in front of a site's line point the trench goes (it replaces the wall line). */
const TRENCH_AHEAD = -1;

/** Tidewater's canals: length of one dug stretch, half the channel's width, its depth below the sea, and the most a side digs. */
const CANAL_STEP = 3;
const CANAL_HALF = 1.6;
const CANAL_DEPTH = 0.9;
export const CANAL_MOST = 60;
/** Ground this far above the sea is too high to dig a canal through. */
const CANAL_HIGHEST = 3.2;
/** How far ahead of the stretch it's digging an engineer stands (out of the water it lets in). */
const CANAL_STAND = 3.4;
/** How far beyond its base a Tidewater side looks for a shore for a dock. */
const DOCK_SEARCH = 26;
/** A canal toward the base stops this far beyond the base pad's edge, where a dock can go on its end. */
const HARBOUR_REACH = 7;
/** Least boat-deep water (in 1.5 m cells, see deepWaterArea) worth a dock: a pond will do, since a canal can carry the boats on from it. */
const HARBOUR_WATER = 20;
/**
 * A canal toward the enemy stops once its end is this share of a missile
 * boat's range from the enemy base's middle (its HQ in reach), but no
 * closer than CANAL_KEEP_OFF outside the base's pad: nobody digs under the
 * enemy's guns.
 */
const CANAL_REACH = 0.85;
const CANAL_KEEP_OFF = 12;
/** Seconds between looks for a shore while the water hasn't changed (buildings may have). */
const SHORE_RECHECK = 20;

/** Seconds of an engineer's work per pulse of digging, and how far one pulse moves the ground. */
const DIG_PULSE = 1;
const DIG_STEP = 0.3;

/** Something an engineer is sent to put up: what, where it goes and faces, and where the engineer stands. */
export interface BuildJob {
  kind: 'build';
  def: BuildingDef;
  x: number;
  z: number;
  heading: number;
  standX: number;
  standZ: number;
}

/** A stretch of ground being dug or raised: a canal, a trench, or a berm. */
export interface Earthwork {
  kind: 'canal' | 'trench' | 'berm';
  side: number;
  /** The stretch's centre line. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** The ground level it's dug down from or raised above (for a canal, unused). */
  level: number;
  /** Seconds of work put in toward the next pulse. */
  effort: number;
  done: boolean;
}

/** An engineer sent to dig: the stretch, and where to stand. */
export interface DigJob {
  kind: 'dig';
  work: Earthwork;
  x: number;
  z: number;
  standX: number;
  standZ: number;
}

export type EngineerJob = BuildJob | DigJob;

/** A place to fortify: a point on the enemy's way in, the way toward the enemy, and how wide a line it wants. */
interface Site {
  kind: 'choke' | 'outpost' | 'army' | 'rally';
  x: number;
  z: number;
  /** Unit vector toward the enemy. */
  dx: number;
  dz: number;
  segments: number;
}

export class Engineers {
  private jobs = new Map<Entity, EngineerJob>();
  private sideOf = new Map<Entity, number>();
  /** Per side: engineers alive, walls, towers and arrays standing, and jobs open (as of the last update), and when the HQ may train the next. */
  private engineers: number[] = [];
  private walls: number[] = [];
  private towers: number[] = [];
  private arrays: number[] = [];
  private open: number[] = [];
  private trainAt: number[] = [];
  /** Every crumbling building standing or going up, as of the last update plus those put up since (some may be gone). */
  private crumbling: Entity[] = [];
  /** Every earthwork planned or dug, in order. */
  readonly works: Earthwork[] = [];
  /** Per side: trench lines dug or begun, and metres of canal dug. */
  private lines: number[] = [];
  private canalDug: number[] = [];
  /** Per side and canal goal ('home' or an enemy side): set once that canal can go no further. */
  private canalDone = new Set<string>();
  /** Per side: where idle engineers wait (behind a push), or null for home. */
  private waits: (Point | null)[] = [];
  /** Per side: the last shore found for a dock (or none), when, and for which version of the water. */
  private shores: ({ version: number; at: number; shore: { x: number; z: number; heading: number } | null } | undefined)[] = [];
  /** Per side: where a dock goes at the end of a canal dug toward home, once it's dug. */
  private berths: ({ x: number; z: number; heading: number } | undefined)[] = [];
  /** Canal routes being dug, per side and goal ('side:home' or 'side:enemy'): the points, and the index the next stretch starts at. */
  private routes = new Map<string, { points: Point[]; next: number }>();
  /** Choke points found, per side and enemy, for the land grid's passable version. */
  private chokes = new Map<string, { version: number; site: Site | null }>();

  /** An engineer's job, if it has one. */
  jobFor(e: Entity): EngineerJob | undefined {
    return this.jobs.get(e);
  }

  /** Where a side's engineers with nothing to build wait, or null for at home. */
  waitFor(side: number): Point | null {
    return this.waits[side] ?? null;
  }

  /** How many of a side's engineers have something to build. */
  count(side: number): number {
    let n = 0;
    for (const e of this.jobs.keys()) if (this.sideOf.get(e) === side) n++;
    return n;
  }

  /** Walls a side has standing. */
  wallsOf(side: number): number {
    return this.walls[side] ?? 0;
  }

  /** Field towers a side has standing. */
  towersOf(side: number): number {
    return this.towers[side] ?? 0;
  }

  /** Comms arrays a side has standing. */
  arraysOf(side: number): number {
    return this.arrays[side] ?? 0;
  }

  /** Metres of canal a side has dug. */
  canalOf(side: number): number {
    return this.canalDug[side] ?? 0;
  }

  /** A side's finished trenches within `radius` of a point, nearest first. */
  trenchesNear(side: number, x: number, z: number, radius: number): Earthwork[] {
    const mid = (w: Earthwork) => D.hypot((w.ax + w.bx) / 2 - x, (w.az + w.bz) / 2 - z);
    return this.works.filter((w) => w.side === side && w.kind === 'trench' && w.done && mid(w) <= radius).sort((a, b) => mid(a) - mid(b));
  }

  /** Find each side's work and hand it to its engineers (with the Commander's picture). */
  update(world: World, ctx: SimContext): void {
    this.jobs.clear();
    this.sideOf.clear();
    const n = ctx.sides.count;
    this.engineers = new Array(n).fill(0);
    this.walls = new Array(n).fill(0);
    this.towers = new Array(n).fill(0);
    this.arrays = new Array(n).fill(0);
    this.open = new Array(n).fill(0);
    this.waits = new Array(n).fill(null);
    while (this.lines.length < n) {
      this.lines.push(0);
      this.canalDug.push(0);
    }
    const crew: Entity[][] = Array.from({ length: n }, () => []);
    for (const e of world.query(Unit, Faction, Transform)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= n || !world.req(e, Unit).def.builds) continue;
      crew[f].push(e);
      this.engineers[f]++;
    }
    this.crumbling = [];
    const hq = new Array<boolean>(n).fill(false);
    for (const e of world.query(Building, Faction)) {
      const f = world.req(e, Faction).id;
      const def = world.req(e, Building).def;
      if (f >= 0 && f < n && def.id === 'hq') hq[f] = true;
      if (f < 0 || f >= n || !def.lasts) continue;
      if (def.id === 'fieldTower') this.towers[f]++;
      else if (def.id === 'commsArray') this.arrays[f]++;
      else this.walls[f]++;
      this.crumbling.push(e);
    }
    if (ctx.settings.armies.engineers <= 0) return;
    for (let side = 0; side < n; side++) {
      const orders = ctx.orders[side];
      if (ctx.sides.eliminated[side] || orders.stance !== 'auto' || orders.rally !== null) continue;
      // No engineers and no HQ to train one: nothing to plan for.
      if (crew[side].length === 0 && !hq[side]) continue;
      const jobs = this.jobsFor(world, ctx, side);
      this.open[side] = jobs.length;
      // Each engineer to the nearest open job, in a fixed order.
      for (const e of crew[side]) {
        if (jobs.length === 0) break;
        const t = world.req(e, Transform);
        let best = 0;
        for (let i = 1; i < jobs.length; i++) if (D.hypot(jobs[i].standX - t.x, jobs[i].standZ - t.z) < D.hypot(jobs[best].standX - t.x, jobs[best].standZ - t.z)) best = i;
        this.jobs.set(e, jobs[best]);
        this.sideOf.set(e, side);
        jobs.splice(best, 1);
      }
      this.waits[side] = this.followPoint(ctx, side);
    }
  }

  /** Everything a side's engineers could be doing now, most wanted first, within the caps. */
  private jobsFor(world: World, ctx: SimContext, side: number): EngineerJob[] {
    const doctrine = doctrineOf(ctx, side).id;
    const out: EngineerJob[] = [];
    // Tidewater: the base's missing hover pad or dock first, then the canal.
    if (doctrine === 'tidewater') {
      const harbour = this.harbourJobs(world, ctx, side);
      out.push(...harbour);
      const canal = this.canalJob(world, ctx, side);
      if (canal) out.push(canal);
    }
    const sites = this.sites(world, ctx, side);
    let towers = TOWERS_MOST - this.towers[side];
    let walls = WALLS_MOST - this.walls[side];
    let arrays = ARRAYS_MOST - this.arrays[side];
    const add = (job: BuildJob | null) => {
      if (!job) return;
      const id = job.def.id;
      if (id === 'fieldTower' ? towers-- > 0 : id === 'commsArray' ? arrays-- > 0 : walls-- > 0) out.push(job);
    };
    // Bastion's first comms array goes out along the way to the nearest enemy, past the base mast's reach.
    if (doctrine === 'bastion') add(this.approachArray(world, ctx, side));
    for (const site of sites) {
      const heading = D.atan2(-site.dz, site.dx);
      // A field tower just behind the middle of the line.
      add(this.buildAt(world, ctx, side, ctx.buildings.fieldTower, site.x - site.dx * TOWER_BACK, site.z - site.dz * TOWER_BACK, heading, site.dx, site.dz));
      // Bastion: a comms array behind lines out at the front.
      if (doctrine === 'bastion' && site.kind !== 'rally') {
        add(this.buildAt(world, ctx, side, ctx.buildings.commsArray, site.x - site.dx * ARRAY_BACK + site.dz * 3, site.z - site.dz * ARRAY_BACK - site.dx * 3, heading, site.dx, site.dz));
      }
      if (doctrine === 'legion') {
        out.push(...this.earthworkJobs(world, ctx, side, site));
        continue;
      }
      for (let k = 0; k < site.segments; k++) {
        const off = (k - (site.segments - 1) / 2) * SEGMENT_GAP;
        add(this.buildAt(world, ctx, side, ctx.buildings.wall, site.x - site.dz * off, site.z + site.dx * off, heading, site.dx, site.dz));
      }
    }
    return out;
  }

  /** A job putting up a building at a spot, if it fits there and no enemy is about. Forward is (cos h, -sin h) (see Transform.heading). */
  private buildAt(world: World, ctx: SimContext, side: number, def: BuildingDef, x: number, z: number, heading: number, dx: number, dz: number): BuildJob | null {
    const { field } = ctx;
    const nav = ctx.navs.land;
    if (!field.contains(x, z, 2) || field.isWater(x, z) || !nav.terrainAllowsAt(x, z) || !nav.fitsAt(x, z, def.radius) || field.nearBridge(x, z, def.radius + 1)) return null;
    if (!this.safe(world, ctx, side, x, z)) return null;
    return { kind: 'build', def, x, z, heading, standX: x - dx * STAND_BACK, standZ: z - dz * STAND_BACK };
  }

  /** The places a side fortifies, best first: choke points, held outposts out front, behind a push, then the rally points. */
  private sites(world: World, ctx: SimContext, side: number): Site[] {
    const { field, sides, lanes } = ctx;
    const home = field.baseSites[side];
    const fronts = sides
      .enemiesOf(side)
      .filter((g) => !sides.eliminated[g])
      .sort((a, b) => D.hypot(field.baseSites[a].x - home.x, field.baseSites[a].z - home.z) - D.hypot(field.baseSites[b].x - home.x, field.baseSites[b].z - home.z) || a - b)
      .slice(0, FRONTS);
    const chokes: Site[] = [];
    const forward: Site[] = [];
    const army: Site[] = [];
    const rallies: Site[] = [];
    const picture = ctx.commander.sides[side];
    const pushing = ctx.offensive.attacking(side, world.time);
    for (const enemy of fronts) {
      const base = field.baseSites[enemy];
      const toward = (x: number, z: number) => {
        const d = Math.max(1, D.hypot(base.x - x, base.z - z));
        return { dx: (base.x - x) / d, dz: (base.z - z) / d };
      };
      const choke = this.choke(ctx, side, enemy);
      if (choke) chokes.push(choke);
      const rally = lanes.rally(side, enemy, 0);
      const rallyAt = lanes.progress(side, enemy, rally.x, rally.z);
      // Outposts the side holds out toward this enemy, the furthest out first.
      const held = ctx.outposts
        .filter((o) => o.owner === side && lanes.progress(side, enemy, o.x, o.z) > rallyAt + FORWARD_GAIN)
        .sort((a, b) => lanes.progress(side, enemy, b.x, b.z) - lanes.progress(side, enemy, a.x, a.z) || a.index - b.index);
      for (const o of held.slice(0, 2)) {
        const { dx, dz } = toward(o.x, o.z);
        forward.push({ kind: 'outpost', x: o.x + dx * OUTPOST_AHEAD, z: o.z + dz * OUTPOST_AHEAD, dx, dz, segments: SEGMENTS });
      }
      // Behind the army on a push against this enemy, once it's well out past the rally point.
      if (pushing && picture?.armyX != null && picture.armyZ != null && sides.target(side, ctx.offensive.attack(side, world.time)) === enemy) {
        const ax = Math.round(picture.armyX / ARMY_SNAP) * ARMY_SNAP;
        const az = Math.round(picture.armyZ / ARMY_SNAP) * ARMY_SNAP;
        if (lanes.progress(side, enemy, ax, az) > rallyAt + ARMY_GAIN) {
          const { dx, dz } = toward(ax, az);
          army.push({ kind: 'army', x: ax - dx * ARMY_BACK, z: az - dz * ARMY_BACK, dx, dz, segments: SEGMENTS });
        }
      }
      const { dx, dz } = toward(rally.x, rally.z);
      rallies.push({ kind: 'rally', x: rally.x + dx * AHEAD, z: rally.z + dz * AHEAD, dx, dz, segments: SEGMENTS });
    }
    return [...chokes, ...forward, ...army, ...rallies];
  }

  /** Where a side's idle engineers follow a push: behind the army's middle, or null to wait at home. */
  private followPoint(ctx: SimContext, side: number): Point | null {
    const picture = ctx.commander.sides[side];
    const time = ctx.commander.updatedAt;
    if (!ctx.offensive.attacking(side, time) || picture?.armyX == null || picture.armyZ == null) return null;
    const enemy = ctx.sides.target(side, ctx.offensive.attack(side, time));
    if (enemy === null) return null;
    const { lanes, field } = ctx;
    const rally = lanes.rally(side, enemy, 0);
    if (lanes.progress(side, enemy, picture.armyX, picture.armyZ) <= lanes.progress(side, enemy, rally.x, rally.z) + ARMY_GAIN) return null;
    const home = field.baseSites[side];
    const d = Math.max(1, D.hypot(picture.armyX - home.x, picture.armyZ - home.z));
    const x = picture.armyX - ((picture.armyX - home.x) / d) * FOLLOW_BACK;
    const z = picture.armyZ - ((picture.armyZ - home.z) / d) * FOLLOW_BACK;
    return ctx.navs.for('foot').terrainAllowsAt(x, z) ? { x, z } : null;
  }

  /**
   * The narrowest gap on the enemy's way in toward a side's rally point
   * that suits the side's doctrine (see MOBILITY), as a site to wall across,
   * or null. Remembered until the land grid changes.
   */
  private choke(ctx: SimContext, side: number, enemy: number): Site | null {
    const key = `${side}-${enemy}`;
    const version = ctx.navs.land.passableVersion;
    const known = this.chokes.get(key);
    if (known && known.version === version) return known.site;
    const site = this.findChoke(ctx, side, enemy);
    this.chokes.set(key, { version, site });
    return site;
  }

  private findChoke(ctx: SimContext, side: number, enemy: number): Site | null {
    const { field, lanes } = ctx;
    const nav = ctx.navs.land;
    const mobility = MOBILITY[doctrineOf(ctx, side).id];
    const reach = mobility ? CHOKE_REACH_MOBILE : CHOKE_REACH;
    const home = field.baseSites[side];
    const from = lanes.rally(enemy, side, 0);
    const route = nav.findPath(from, lanes.rally(side, enemy, 0));
    if (!route || route.length === 0) return null;
    // The route's points leave out where it starts.
    const path = [from, ...route];
    // Walk the route in short steps (it comes from the enemy toward us).
    const samples: { x: number; z: number; dx: number; dz: number }[] = [];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const len = D.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-3) continue;
      for (let s = 0; s < len; s += 1.5) samples.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len, dx: (a.x - b.x) / len, dz: (a.z - b.z) / len });
    }
    // What bounds the gap at a point: water, steep ground, a building or the map's edge, or nothing near.
    const edge = (x: number, z: number): 'water' | 'steep' | 'blocked' | null => {
      if (!field.contains(x, z, 1)) return 'blocked';
      if (field.isWater(x, z) && field.deckAt(x, z) === null) return 'water';
      if (field.slopeAt(x, z) > STEEP_SLOPE) return 'steep';
      if (nav.blockedAt(x, z)) return 'blocked';
      return null;
    };
    let best: Site | null = null;
    let bestWidth = CHOKE_WIDEST;
    for (const p of samples) {
      const at = lanes.progress(side, enemy, p.x, p.z);
      if (at > reach || D.hypot(p.x - home.x, p.z - home.z) < home.radius + 4) continue;
      // Across the route, both ways.
      const nx = -p.dz;
      const nz = p.dx;
      const scan = (sign: number): { s: number; kind: 'water' | 'steep' | 'blocked' } | null => {
        for (let s = 0.75; s <= CHOKE_SCAN; s += 0.75) {
          const kind = edge(p.x + nx * s * sign, p.z + nz * s * sign);
          if (kind) return { s, kind };
        }
        return null;
      };
      const left = scan(1);
      const right = left ? scan(-1) : null;
      if (!left || !right) continue;
      const width = left.s + right.s;
      if (width >= bestWidth) continue;
      if (mobility === 'steep' && left.kind !== 'steep' && right.kind !== 'steep') continue;
      if (mobility === 'water' && left.kind !== 'water' && right.kind !== 'water') continue;
      bestWidth = width;
      const mid = (left.s - right.s) / 2;
      const segments = Math.max(2, Math.min(CHOKE_SEGMENTS, Math.ceil((width - 0.5) / SEGMENT_GAP)));
      best = { kind: 'choke', x: p.x + nx * mid, z: p.z + nz * mid, dx: p.dx, dz: p.dz, segments };
    }
    return best;
  }

  /** Bastion's comms array out along the way to its nearest enemy, past where the base's mast spots. */
  private approachArray(world: World, ctx: SimContext, side: number): BuildJob | null {
    const { field, sides } = ctx;
    const home = field.baseSites[side];
    const enemies = sides.enemiesOf(side).filter((g) => !sides.eliminated[g]);
    if (enemies.length === 0) return null;
    const enemy = enemies.reduce((a, b) => (D.hypot(field.baseSites[b].x - home.x, field.baseSites[b].z - home.z) < D.hypot(field.baseSites[a].x - home.x, field.baseSites[a].z - home.z) ? b : a));
    const base = field.baseSites[enemy];
    const d = Math.max(1, D.hypot(base.x - home.x, base.z - home.z));
    const dx = (base.x - home.x) / d;
    const dz = (base.z - home.z) / d;
    const def = ctx.buildings.commsArray;
    const cell = ctx.navs.land.nearestOpen(home.x + dx * d * ARRAY_OUT, home.z + dz * d * ARRAY_OUT, 4, def.radius + 0.5);
    if (!cell) return null;
    const p = ctx.navs.land.center(cell[0], cell[1]);
    // Not if one already stands near (the cap counts every array, so this keeps it to one out here).
    for (const e of world.query(Building, Faction, Transform)) {
      if (world.req(e, Faction).id !== side || world.req(e, Building).def.id !== 'commsArray') continue;
      const t = world.req(e, Transform);
      if (D.hypot(t.x - p.x, t.z - p.z) < 10) return null;
    }
    return this.buildAt(world, ctx, side, def, p.x, p.z, D.atan2(-dz, dx), dx, dz);
  }

  /** Legion's trench and berm across a site: plans a line when there's none near, and returns its unfinished stretches. */
  private earthworkJobs(world: World, ctx: SimContext, side: number, site: Site): DigJob[] {
    const cx = site.x + site.dx * TRENCH_AHEAD;
    const cz = site.z + site.dz * TRENCH_AHEAD;
    const near = this.works.filter((w) => w.side === side && w.kind !== 'canal' && D.hypot((w.ax + w.bx) / 2 - cx, (w.az + w.bz) / 2 - cz) < TRENCH_LENGTH);
    if (near.length === 0) {
      // One line at a time, up to the most a side digs.
      const digging = this.works.some((w) => w.side === side && w.kind !== 'canal' && !w.done);
      if (digging || this.lines[side] >= EARTHWORKS_MOST || !this.safe(world, ctx, side, cx, cz)) return [];
      const line = this.planLine(ctx, side, cx, cz, site.dx, site.dz);
      if (!line) return [];
      this.works.push(...line);
      this.lines[side]++;
      near.push(...line);
    }
    const out: DigJob[] = [];
    for (const w of near) {
      if (w.done) continue;
      // The berm goes up once the trench behind it is dug.
      if (w.kind === 'berm' && near.some((o) => o.kind === 'trench' && !o.done)) continue;
      const mx = (w.ax + w.bx) / 2;
      const mz = (w.az + w.bz) / 2;
      // Dig from behind the line, on the side away from the enemy.
      const back = w.kind === 'berm' ? BERM_AHEAD + 1.6 : 1.8;
      out.push({ kind: 'dig', work: w, x: mx, z: mz, standX: mx - site.dx * back, standZ: mz - site.dz * back });
    }
    return out;
  }

  /** Two trench stretches across a point and the berm in front of them, or null if the ground won't take them. */
  private planLine(ctx: SimContext, side: number, cx: number, cz: number, dx: number, dz: number): Earthwork[] | null {
    const { field } = ctx;
    const nav = ctx.navs.land;
    const half = TRENCH_LENGTH / 2;
    // Along the line is across the enemy's way: (-dz, dx).
    const point = (along: number, ahead: number) => ({ x: cx - dz * along + dx * ahead, z: cz + dx * along + dz * ahead });
    let level = 0;
    let samples = 0;
    for (let a = -half; a <= half; a += 1) {
      for (const ahead of [0, BERM_AHEAD]) {
        const p = point(a, ahead);
        if (!field.contains(p.x, p.z, 3) || field.isWater(p.x, p.z) || field.nearBridge(p.x, p.z, 2) || !nav.fitsAt(p.x, p.z, 1) || field.slopeAt(p.x, p.z) > STEEP_SLOPE * 0.8) return null;
        if (ahead === 0) {
          level += field.heightAt(p.x, p.z);
          samples++;
        }
      }
    }
    level /= samples;
    // Keep the trench floor out of the water.
    if (level - TRENCH_DEPTH < field.seaLevel + 0.15) return null;
    const work = (kind: Earthwork['kind'], a0: number, a1: number, ahead: number): Earthwork => {
      const a = point(a0, ahead);
      const b = point(a1, ahead);
      return { kind, side, ax: a.x, az: a.z, bx: b.x, bz: b.z, level, effort: 0, done: false };
    };
    return [work('trench', -half, 0, 0), work('trench', 0, half, 0), work('berm', -half - 0.5, half + 0.5, BERM_AHEAD)];
  }

  /** Tidewater: a hover pad in a base that has a dock, and a dock on the nearest shore for a base that has none. */
  private harbourJobs(world: World, ctx: SimContext, side: number): BuildJob[] {
    const have = new Set<string>();
    for (const e of world.query(Building, Faction)) if (world.req(e, Faction).id === side) have.add(world.req(e, Building).def.id);
    // A base dock or pad that's rubble will be rebuilt where it was.
    for (const e of world.query(Rubble)) {
      const r = world.req(e, Rubble);
      if (r.faction === side) have.add(r.def.id);
    }
    const out: BuildJob[] = [];
    const { field } = ctx;
    const home = field.baseSites[side];
    const nav = ctx.navs.land;
    if (!have.has('hoverPad')) {
      const def: BuildingDef = { ...ctx.buildings.hoverPad, field: true };
      const enemy = this.nearestEnemy(ctx, side);
      const forward = enemy !== null ? D.atan2(-(field.baseSites[enemy].z - home.z), field.baseSites[enemy].x - home.x) : 0;
      spots: for (const dist of [10, 12, 8, 14]) {
        for (const angle of [Math.PI + 0.9, Math.PI - 0.9, Math.PI + 1.6, Math.PI - 1.6, Math.PI, 1.6, -1.6, 0.9, -0.9]) {
          const x = home.x + D.cos(forward + angle) * dist;
          const z = home.z - D.sin(forward + angle) * dist;
          const doorX = x + D.cos(forward) * (def.radius + 1.5);
          const doorZ = z - D.sin(forward) * (def.radius + 1.5);
          if (field.slopeAt(x, z) > 0.5 || !nav.fitsAt(x, z, def.radius + 1) || !nav.fitsAt(doorX, doorZ, 1)) continue;
          const job = this.buildAt(world, ctx, side, def, x, z, forward, D.cos(forward), -D.sin(forward));
          if (job) {
            out.push(job);
            break spots;
          }
        }
      }
    }
    if (!have.has('dock')) {
      const def: BuildingDef = { ...ctx.buildings.dock, field: true };
      const fits = (x: number, z: number, r: number) =>
        field.contains(x, z, 2) && !field.isWater(x, z) && nav.terrainAllowsAt(x, z) && nav.fitsAt(x, z, r + 0.5) && !field.nearBridge(x, z, r + 2) && field.slopeAt(x, z) < 0.6;
      // Looking for a shore is slow: look again only every so often, or once the water's changed.
      const version = ctx.navs.for('naval').passableVersion;
      let known = this.shores[side];
      if (!known || known.version !== version || world.time >= known.at + SHORE_RECHECK) {
        known = { version, at: world.time, shore: findShore(field, home, def.radius, fits, DOCK_SEARCH, HARBOUR_WATER) };
        this.shores[side] = known;
      }
      const shore = known.shore ?? this.berths[side] ?? null;
      if (shore) {
        const job = this.buildAt(world, ctx, side, def, shore.x, shore.z, shore.heading, D.cos(shore.heading), -D.sin(shore.heading));
        if (job) out.push(job);
      }
    }
    return out;
  }

  private nearestEnemy(ctx: SimContext, side: number): number | null {
    const { field, sides } = ctx;
    const home = field.baseSites[side];
    let best: number | null = null;
    for (const g of sides.enemiesOf(side)) {
      if (sides.eliminated[g]) continue;
      if (best === null || D.hypot(field.baseSites[g].x - home.x, field.baseSites[g].z - home.z) < D.hypot(field.baseSites[best].x - home.x, field.baseSites[best].z - home.z)) best = g;
    }
    return best;
  }

  /**
   * Tidewater's canal: the stretch being dug, or the next one. It goes from
   * the side's water toward its own base while there's no shore near enough
   * for a dock, then toward the nearest enemy base until its boats can reach
   * the HQ there, along the cheapest way to dig (round hills, buildings and
   * other bases, through ponds on the way), a stretch at a time, up to
   * CANAL_MOST.
   */
  private canalJob(world: World, ctx: SimContext, side: number): DigJob | null {
    let work = this.works.find((w) => w.side === side && w.kind === 'canal' && !w.done);
    if (!work) {
      if (this.canalDug[side] >= CANAL_MOST) return null;
      work = this.planCanal(world, ctx, side) ?? undefined;
      if (!work) return null;
      this.works.push(work);
    }
    const stand = this.canalStand(ctx, work);
    if (!stand || !this.safe(world, ctx, side, stand.x, stand.z)) return null;
    return { kind: 'dig', work, x: work.bx, z: work.bz, standX: stand.x, standZ: stand.z };
  }

  /** Where an engineer stands to dig a canal stretch: on dry ground past its end, or to one side. */
  private canalStand(ctx: SimContext, w: Earthwork): Point | null {
    const len = Math.max(1e-3, D.hypot(w.bx - w.ax, w.bz - w.az));
    const ux = (w.bx - w.ax) / len;
    const uz = (w.bz - w.az) / len;
    const foot = ctx.navs.for('foot');
    for (const [f, sd] of [[1, 0], [0.4, 1], [0.4, -1], [-0.3, 1], [-0.3, -1]]) {
      const x = w.bx + ux * CANAL_STAND * f - uz * CANAL_STAND * sd;
      const z = w.bz + uz * CANAL_STAND * f + ux * CANAL_STAND * sd;
      if (ctx.field.contains(x, z, 1) && !ctx.field.isWater(x, z) && foot.terrainAllowsAt(x, z)) return { x, z };
    }
    return null;
  }

  /** Where a side's boats come from: the open water by its dock's door, or null with no dock. */
  private harbour(world: World, ctx: SimContext, side: number): Point | null {
    for (const e of world.query(Building, Faction, Transform)) {
      if (world.req(e, Faction).id !== side || world.req(e, Building).def.id !== 'dock' || world.has(e, Construction)) continue;
      const t = world.req(e, Transform);
      const r = world.req(e, Building).def.radius + 2.5;
      const door = { x: t.x + D.cos(t.heading) * r, z: t.z - D.sin(t.heading) * r };
      // The open water cell nearest the door (a route cell, so connectivity questions get a straight answer).
      const naval = ctx.navs.for('naval');
      const cell = naval.nearestOpen(door.x, door.z, 4);
      if (cell) return naval.center(cell[0], cell[1]);
    }
    return null;
  }

  /** The next canal stretch for a side, planning the canal's route when it has none (or the old one no longer works). */
  private planCanal(world: World, ctx: SimContext, side: number): Earthwork | null {
    const { field } = ctx;
    const harbour = this.harbour(world, ctx, side);
    // With no dock, dig toward home (unless a dock is going up anyway); with one, toward the nearest enemy.
    let goal: number | 'home';
    if (harbour) {
      const enemy = this.nearestEnemy(ctx, side);
      if (enemy === null) return null;
      goal = enemy;
    } else {
      if (this.harbourJobs(world, ctx, side).some((j) => j.def.id === 'dock')) return null;
      goal = 'home';
    }
    const key = `${side}:${goal}`;
    if (this.canalDone.has(key)) return null;
    let route = this.routes.get(key);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!route) {
        const target = goal === 'home' ? field.baseSites[side] : field.baseSites[goal];
        const reach = goal === 'home' ? target.radius + HARBOUR_REACH : Math.max(ctx.units.missileBoat.weapon.range * CANAL_REACH, target.radius + CANAL_KEEP_OFF);
        const points = canalRoute(ctx, harbour, target, reach);
        if (!points) {
          this.canalDone.add(key);
          return null;
        }
        route = { points, next: 0 };
        this.routes.set(key, route);
      }
      // The next stretch: skip what's water already, then take CANAL_STEP of dry ground.
      const pts = route.points;
      let i = route.next;
      while (i < pts.length - 1 && field.isWater(pts[i + 1].x, pts[i + 1].z)) i++;
      if (i >= pts.length - 1) {
        // Dug all the way: a canal toward home leaves a berth for a dock at its end, facing down it.
        if (goal === 'home' && pts.length >= 2) {
          const end = pts[pts.length - 1];
          const prev = pts[Math.max(0, pts.length - 3)];
          const d = Math.max(1e-3, D.hypot(end.x - prev.x, end.z - prev.z));
          const ux = (end.x - prev.x) / d;
          const uz = (end.z - prev.z) / d;
          const r = ctx.buildings.dock.radius + 2.5;
          this.berths[side] = { x: end.x + ux * r, z: end.z + uz * r, heading: D.atan2(uz, -ux) };
        }
        this.canalDone.add(key);
        return null;
      }
      let j = i + 1;
      while (j < pts.length - 1 && D.hypot(pts[j].x - pts[i].x, pts[j].z - pts[i].z) < CANAL_STEP) j++;
      const a = pts[i];
      const b = pts[j];
      if (this.canDig(ctx, a, b)) {
        route.next = j;
        return { kind: 'canal', side, ax: a.x, az: a.z, bx: b.x, bz: b.z, level: field.seaLevel, effort: 0, done: false };
      }
      // Something's in the way now (a building, a cut-off): plan again once, from the water as it is.
      this.routes.delete(key);
      route = undefined;
    }
    this.canalDone.add(key);
    return null;
  }

  /** Whether a canal stretch from a to b can still be dug: clear of buildings and bridges, and not cutting bases apart by land. */
  private canDig(ctx: SimContext, a: Point, b: Point): boolean {
    const { field } = ctx;
    const len = Math.max(1e-3, D.hypot(b.x - a.x, b.z - a.z));
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    for (let s = 0; s <= len; s += 0.75) {
      for (const off of [-CANAL_HALF, 0, CANAL_HALF]) {
        const x = a.x + ux * s - uz * off;
        const z = a.z + uz * s + ux * off;
        if (!field.contains(x, z, 2) || field.nearBridge(x, z, 2) || builtOver(ctx, x, z, 0.8)) return false;
      }
    }
    if (!this.canalStand(ctx, { kind: 'canal', side: -1, ax: a.x, az: a.z, bx: b.x, bz: b.z, level: 0, effort: 0, done: true })) return false;
    return landStaysLinked(ctx, a, b, CANAL_HALF + 0.7);
  }

  private safe(world: World, ctx: SimContext, side: number, x: number, z: number): boolean {
    let safe = true;
    ctx.grid.forEachNear(x, z, SAFE_RADIUS, (other) => {
      if (safe && world.get(other, Targetable)?.kind === 'unit' && ctx.sides.hostile(side, world.req(other, Faction).id)) safe = false;
    });
    return safe;
  }

  /**
   * Each tick: an engineer at its spot puts up its building or digs, a
   * side's HQ trains an engineer when there's work and room, and walls
   * crumble.
   */
  tick(world: World, ctx: SimContext, dt: number): void {
    const most = ctx.settings.armies.engineers;
    for (const [e, job] of this.jobs) {
      const side = this.sideOf.get(e)!;
      if (!world.isAlive(e)) {
        this.jobs.delete(e);
        continue;
      }
      const t = world.req(e, Transform);
      if (D.hypot(job.standX - t.x, job.standZ - t.z) > REACH) continue;
      if (job.kind === 'dig') {
        const w = job.work;
        if (w.done) {
          this.jobs.delete(e);
          continue;
        }
        w.effort += dt;
        if (w.effort < DIG_PULSE) continue;
        w.effort -= DIG_PULSE;
        if (!dig(world, ctx, w)) this.finish(ctx, w);
        continue;
      }
      this.jobs.delete(e);
      const id = job.def.id;
      const full = id === 'fieldTower' ? this.towers[side] >= TOWERS_MOST : id === 'commsArray' ? this.arrays[side] >= ARRAYS_MOST : job.def.lasts ? this.walls[side] >= WALLS_MOST : false;
      if (full || !ctx.navs.land.fitsAt(job.x, job.z, job.def.radius)) continue;
      const b = spawnBuilding(world, ctx, job.def, side, job.x, job.z, job.heading, true);
      if (job.def.lasts) this.crumbling.push(b);
      if (id === 'fieldTower') this.towers[side]++;
      else if (id === 'commsArray') this.arrays[side]++;
      else if (job.def.lasts) this.walls[side]++;
      this.open[side] = Math.max(0, this.open[side] - 1);
    }

    // Only look for HQs when some side wants another engineer and may train one.
    let training = false;
    for (let side = 0; side < this.open.length && !training; side++) training = this.engineers[side] < Math.min(most, this.open[side]) && world.time >= (this.trainAt[side] ?? 0);
    if (training) {
      for (const hq of world.query(Building, Faction, Transform)) {
        const def = world.req(hq, Building).def;
        if (def.id !== 'hq' || world.has(hq, Construction)) continue;
        const side = world.req(hq, Faction).id;
        if (side < 0 || side >= ctx.sides.count) continue;
        const wanted = Math.min(most, this.open[side] ?? 0);
        if ((this.engineers[side] ?? 0) >= wanted || world.time < (this.trainAt[side] ?? 0)) continue;
        this.trainAt[side] = world.time + TRAIN_EVERY;
        const t = world.req(hq, Transform);
        const r = def.radius + 1.2;
        const spot = spawnSpot(ctx, t.x + D.cos(t.heading) * r, t.z - D.sin(t.heading) * r, ctx.units.engineer.radius, 'foot');
        if (!spot) continue;
        spawnUnit(world, ctx, ctx.units.engineer, side, spot.x, spot.z);
        this.engineers[side]++;
      }
    }

    // Walls, field towers and comms arrays crumble over their lifetime (not while they're still going up).
    for (const e of this.crumbling) {
      if (!world.isAlive(e) || world.has(e, Construction)) continue;
      const h = world.get(e, Health);
      if (h) h.hp -= (h.max / world.req(e, Building).def.lasts!) * dt;
    }
  }

  /** A stretch is dug: trenches get their ground, canals count toward the side's total, and the ticker hears of it. */
  private finish(ctx: SimContext, w: Earthwork): void {
    w.done = true;
    layGround(ctx, w);
    if (w.kind === 'canal') this.canalDug[w.side] += CANAL_STEP;
    ctx.events.emit('earthwork', { kind: w.kind, faction: w.side, x: (w.ax + w.bx) / 2, z: (w.az + w.bz) / 2 });
  }
}

/** A finished trench gets trench ground along its floor (cover), a berm fresh earth. */
export function layGround(ctx: SimContext, w: Earthwork): void {
  if (w.kind === 'canal') return;
  const { field } = ctx;
  // The trench floor gets trench ground (cover), the berm fresh earth.
  const reach = w.kind === 'trench' ? TRENCH_HALF + 0.3 : BERM_HALF;
  const { cols } = field.config;
  const area = field.areaAround((w.ax + w.bx) / 2, (w.az + w.bz) / 2, D.hypot(w.bx - w.ax, w.bz - w.az) / 2 + 2);
  const cells: number[] = [];
  for (let j = area.j0; j <= area.j1; j++) {
    for (let i = area.i0; i <= area.i1; i++) {
      const cx = field.bounds.minX + (i + 0.5) * field.config.cellSize;
      const cz = field.bounds.minZ + (j + 0.5) * field.config.cellSize;
      if (distanceToSegment(cx, cz, { x: w.ax, z: w.az }, { x: w.bx, z: w.bz }) <= reach) cells.push(j * cols + i);
    }
  }
  field.setGround(cells, w.kind === 'trench' ? 'trench' : 'earth');
}

/** How far a point is from the segment a to b. */
function distanceToSegment(x: number, z: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
  return D.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
}

/** The height a stretch of earthwork wants a vertex at this distance from its centre line, and whether that's down (dug) or up (raised). */
function shapeOf(field: { seaLevel: number }, w: Earthwork, d: number): { h: number; down: boolean } | null {
  if (w.kind === 'canal') {
    // A flat channel bed with banks sloping up to the ground.
    const half = CANAL_HALF;
    if (d > half + 3) return null;
    return { h: field.seaLevel - CANAL_DEPTH + Math.max(0, d - half) * 1.6, down: true };
  }
  if (w.kind === 'trench') {
    if (d > TRENCH_HALF + 0.8) return null;
    return { h: w.level - TRENCH_DEPTH + Math.max(0, d - TRENCH_HALF) * (TRENCH_DEPTH / 0.8), down: true };
  }
  if (d > BERM_HALF) return null;
  return { h: w.level + BERM_HEIGHT * (1 - (d / BERM_HALF) * (d / BERM_HALF)), down: false };
}

/** One pulse of digging (or heaping up) a stretch: moves its ground a step toward its shape. Returns whether anything moved. */
export function dig(world: World, ctx: SimContext, w: Earthwork): boolean {
  const field = ctx.field;
  const { cols, rows, cellSize } = field.config;
  const pad = 3.2;
  const x0 = Math.min(w.ax, w.bx) - pad;
  const x1 = Math.max(w.ax, w.bx) + pad;
  const z0 = Math.min(w.az, w.bz) - pad;
  const z1 = Math.max(w.az, w.bz) + pad;
  const i0 = Math.max(0, Math.floor((x0 - field.bounds.minX) / cellSize));
  const i1 = Math.min(cols, Math.ceil((x1 - field.bounds.minX) / cellSize));
  const j0 = Math.max(0, Math.floor((z0 - field.bounds.minZ) / cellSize));
  const j1 = Math.min(rows, Math.ceil((z1 - field.bounds.minZ) / cellSize));
  const a = { x: w.ax, z: w.az };
  const b = { x: w.bx, z: w.bz };
  let moved = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const shape = shapeOf(field, w, distanceToSegment(field.vertexX(i), field.vertexZ(j), a, b));
      if (!shape) continue;
      const k = j * (cols + 1) + i;
      const h = field.heights[k];
      // Heights are stored as 32-bit floats: aim for what the store will hold, or it never quite gets there.
      const goal = Math.fround(shape.h);
      const next = Math.fround(shape.down ? (h > goal ? Math.max(goal, h - DIG_STEP) : h) : h < goal ? Math.min(goal, h + DIG_STEP) : h);
      if (next === h) continue;
      field.heights[k] = next;
      moved = true;
    }
  }
  if (!moved) return false;
  const area: CellArea = { i0: Math.max(0, i0 - 2), j0: Math.max(0, j0 - 2), i1: Math.min(cols - 1, i1 + 1), j1: Math.min(rows - 1, j1 + 1) };
  field.changed(area);
  const mx = (w.ax + w.bx) / 2;
  const mz = (w.az + w.bz) / 2;
  settle(world, ctx, mx, mz, D.hypot(w.bx - w.ax, w.bz - w.az) / 2 + pad);
  return true;
}

/**
 * The cheapest way to dig a canal from a side's water to within `reach` of
 * a point, as a line of points from the water out: a search over the map's
 * cells where dry ground costs more the higher it stands (more to dig), water
 * on the way is nearly free (a pond joined up), and buildings, bridges,
 * bases, outposts, the map's edge and high ground are out. It starts from
 * the water joined to `harbour`, or with none, from any pond or lake big
 * enough for a dock (see HARBOUR_WATER). Null if there's no way, or if the
 * water reaches already.
 */
function canalRoute(ctx: SimContext, harbour: Point | null, target: Point, reach: number): Point[] | null {
  const { field } = ctx;
  const naval = ctx.navs.for('naval');
  const { cols, rows, cellSize } = field.config;
  const n = cols * rows;
  const cx = (k: number) => field.bounds.minX + ((k % cols) + 0.5) * cellSize;
  const cz = (k: number) => field.bounds.minZ + (Math.floor(k / cols) + 0.5) * cellSize;
  const sizes = new Map<string, number>();
  const cost = new Float32Array(n);
  const from = new Int32Array(n).fill(-1);
  const heap = new Heap(cost);
  cost.fill(Infinity);
  // Where digging can't go.
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const x = cx(k);
    const z = cz(k);
    const wet = naval.terrainAllowsAt(x, z);
    if (!field.contains(x, z, 3) || field.nearBridge(x, z, 2) || (!wet && (field.heightAt(x, z) > field.seaLevel + CANAL_HIGHEST || builtOver(ctx, x, z, CANAL_HALF + 0.5)))) out[k] = 1;
  }
  for (const site of field.baseSites) markRound(field, out, site.x, site.z, site.radius + 2);
  for (const o of field.outpostSites) markRound(field, out, o.x, o.z, 8);
  // The water it starts from.
  for (let k = 0; k < n; k++) {
    if (out[k]) continue;
    const x = cx(k);
    const z = cz(k);
    if (field.heightAt(x, z) > field.seaLevel - DOCK_DEPTH || !naval.terrainAllowsAt(x, z)) continue;
    if (harbour ? !naval.connected({ x, z }, harbour) : deepWaterArea(field, x, z, HARBOUR_WATER, sizes) < HARBOUR_WATER) continue;
    if (D.hypot(target.x - x, target.z - z) <= reach) return null;
    cost[k] = 0;
    heap.push(k);
  }
  let end = -1;
  while (heap.size > 0) {
    const k = heap.pop();
    const x = cx(k);
    const z = cz(k);
    if (D.hypot(target.x - x, target.z - z) <= reach) {
      end = k;
      break;
    }
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj, step] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (out[nk]) continue;
      const nx = cx(nk);
      const nz = cz(nk);
      const wet = field.isWater(nx, nz);
      const dig = wet ? 0.15 : 1 + Math.max(0, field.heightAt(nx, nz) - field.seaLevel) * 0.8;
      const c = cost[k] + dig * step;
      if (c >= cost[nk]) continue;
      cost[nk] = c;
      from[nk] = k;
      heap.push(nk);
    }
  }
  if (end < 0) return null;
  const cells: number[] = [];
  for (let k = end; k >= 0; k = from[k]) cells.push(k);
  cells.reverse();
  return cells.map((k) => ({ x: cx(k), z: cz(k) }));
}

/** Whether a building stands within about `radius` of a point (by the route grid's obstacle cells). */
function builtOver(ctx: SimContext, x: number, z: number, radius: number): boolean {
  const nav = ctx.navs.land;
  const { occupied, cols } = nav.obstacles;
  const [i0, j0] = nav.cellOf(x - radius, z - radius);
  const [i1, j1] = nav.cellOf(x + radius, z + radius);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (occupied[j * cols + i] > 0) return true;
  return false;
}

/** Mark the cells within `radius` of a point. */
function markRound(field: SimContext['field'], out: Uint8Array, x: number, z: number, radius: number): void {
  const { cols, cellSize } = field.config;
  const area = field.areaAround(x, z, radius);
  for (let j = area.j0; j <= area.j1; j++) {
    for (let i = area.i0; i <= area.i1; i++) {
      if (D.hypot(field.bounds.minX + (i + 0.5) * cellSize - x, field.bounds.minZ + (j + 0.5) * cellSize - z) <= radius) out[j * cols + i] = 1;
    }
  }
}

/**
 * Whether every base that's joined to a side's base by land now still would
 * be with a channel this wide dug from a to b (bridges count as land).
 */
export function landStaysLinked(ctx: SimContext, a: Point, b: Point, half: number): boolean {
  const { field } = ctx;
  const { cols, rows, cellSize } = field.config;
  const centre = (k: number) => ({ x: field.bounds.minX + ((k % cols) + 0.5) * cellSize, z: field.bounds.minZ + (Math.floor(k / cols) + 0.5) * cellSize });
  const dry = new Uint8Array(cols * rows);
  for (let k = 0; k < dry.length; k++) {
    const c = centre(k);
    dry[k] = !field.isWater(c.x, c.z) || field.deckAt(c.x, c.z) !== null ? 1 : 0;
  }
  const regions = (cut: boolean): Int32Array => {
    const label = new Int32Array(cols * rows).fill(-1);
    const open = (k: number) => dry[k] === 1 && !(cut && distanceToSegment(centre(k).x, centre(k).z, a, b) <= half);
    let next = 0;
    const stack: number[] = [];
    for (const site of field.baseSites) {
      const [si, sj] = field.cellAt(site.x, site.z);
      const s = sj * cols + si;
      if (label[s] >= 0 || !open(s)) continue;
      label[s] = next;
      stack.push(s);
      while (stack.length > 0) {
        const k = stack.pop()!;
        const i = k % cols;
        const j = (k - i) / cols;
        for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
          if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
          const nk = nj * cols + ni;
          if (label[nk] >= 0 || !open(nk)) continue;
          label[nk] = next;
          stack.push(nk);
        }
      }
      next++;
    }
    return label;
  };
  const before = regions(false);
  const after = regions(true);
  const at = (site: Point) => {
    const [i, j] = field.cellAt(site.x, site.z);
    return j * cols + i;
  };
  const sites = field.baseSites;
  for (let p = 0; p < sites.length; p++) {
    for (let q = p + 1; q < sites.length; q++) {
      const kp = at(sites[p]);
      const kq = at(sites[q]);
      if (before[kp] >= 0 && before[kp] === before[kq] && (after[kp] < 0 || after[kp] !== after[kq])) return false;
    }
  }
  return true;
}

/** Runs the engineers' building, digging, training and the walls' decay each tick (see Engineers.tick). */
export function engineerSystem(ctx: SimContext): System {
  return {
    name: 'engineers',
    update(world, dt) {
      ctx.commander.engineers.tick(world, ctx, dt);
    },
  };
}
