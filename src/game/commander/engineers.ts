import { Entity, System, World } from '../../core/ecs';
import { Building, Construction, Faction, Health, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { spawnSpot } from '../systems/production';
import { spawnBuilding, spawnUnit } from '../spawn';

/*
 * Engineers (Commander step 6). Every doctrine's HQ trains a few engineers
 * when its Commander has work for them, up to the engineers setting per
 * side. Their work for now is fortifying where the army masses: a short line
 * of wall segments a little in front of each rally point, facing the enemy
 * base it leads to (for the two nearest enemies). A wall stops shots like
 * any building, so it's cover, and attackers have to go round it or knock it
 * down. Walls crumble over BuildingDef.lasts and aren't rebuilt, so they
 * don't pile up, and a side has at most WALLS_MOST at once.
 *
 * Engineers aren't part of the army: they take no cap, never join an attack
 * or a task force, and stay home when there's nothing to build. The rally
 * flag and a stance other than auto pause their work, like every other job.
 * Docks, hover pads, bridge repairs and canals are later work.
 */

/** Wall segments in a line, and how far apart their centres are. */
const SEGMENTS = 3;
const SEGMENT_GAP = 2.6;
/** How far in front of the rally point, toward the enemy base, the line goes. */
const AHEAD = 7;
/** Most enemies a side fortifies against (the nearest). */
const FRONTS = 2;
/** Most walls a side has standing at once. */
export const WALLS_MOST = 6;
/** Seconds between engineers trained at one HQ. */
const TRAIN_EVERY = 40;
/** No building where an enemy unit is this close. */
const SAFE_RADIUS = 14;
/** How far behind its wall an engineer stands to build it, and how near that it has to be. */
const STAND_BACK = 2;
const REACH = 3;

/** A wall an engineer is sent to build: where it goes and faces, and where the engineer stands. */
export interface BuildJob {
  x: number;
  z: number;
  heading: number;
  standX: number;
  standZ: number;
}

export class Engineers {
  private jobs = new Map<Entity, BuildJob>();
  /** Per side: engineers alive, walls standing and wall spots open (as of the last update), and when the HQ may train the next. */
  private engineers: number[] = [];
  private walls: number[] = [];
  private open: number[] = [];
  private trainAt: number[] = [];
  /** Every wall standing or going up, as of the last update plus those put up since (some may be gone). */
  private wallList: Entity[] = [];

  /** An engineer's job, if it has one. */
  jobFor(e: Entity): BuildJob | undefined {
    return this.jobs.get(e);
  }

  /** How many of a side's engineers have a wall to build. */
  count(side: number): number {
    let n = 0;
    for (const e of this.jobs.keys()) if (this.sideOf.get(e) === side) n++;
    return n;
  }

  /** Walls a side has standing. */
  wallsOf(side: number): number {
    return this.walls[side] ?? 0;
  }

  private sideOf = new Map<Entity, number>();

  /** Find each side's open wall spots and hand them to its engineers (with the Commander's picture). */
  update(world: World, ctx: SimContext): void {
    this.jobs.clear();
    this.sideOf.clear();
    const n = ctx.sides.count;
    this.engineers = new Array(n).fill(0);
    this.walls = new Array(n).fill(0);
    this.open = new Array(n).fill(0);
    const crew: Entity[][] = Array.from({ length: n }, () => []);
    for (const e of world.query(Unit, Faction, Transform)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= n || !world.req(e, Unit).def.builds) continue;
      crew[f].push(e);
      this.engineers[f]++;
    }
    this.wallList = [];
    for (const e of world.query(Building, Faction)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= n || !world.req(e, Building).def.lasts) continue;
      this.walls[f]++;
      this.wallList.push(e);
    }
    if (ctx.settings.armies.engineers <= 0) return;
    for (let side = 0; side < n; side++) {
      const orders = ctx.orders[side];
      if (ctx.sides.eliminated[side] || orders.stance !== 'auto' || orders.rally !== null) continue;
      const spots = this.spots(world, ctx, side).slice(0, Math.max(0, WALLS_MOST - this.walls[side]));
      this.open[side] = spots.length;
      // Each engineer to the nearest open spot, in a fixed order.
      for (const e of crew[side]) {
        if (spots.length === 0) break;
        const t = world.req(e, Transform);
        let best = 0;
        for (let i = 1; i < spots.length; i++) if (Math.hypot(spots[i].standX - t.x, spots[i].standZ - t.z) < Math.hypot(spots[best].standX - t.x, spots[best].standZ - t.z)) best = i;
        this.jobs.set(e, spots[best]);
        this.sideOf.set(e, side);
        spots.splice(best, 1);
      }
    }
  }

  /** Spots in front of a side's rally points where a wall segment fits and no enemy is about. */
  private spots(world: World, ctx: SimContext, side: number): BuildJob[] {
    const { field, sides } = ctx;
    const home = field.baseSites[side];
    const fronts = sides
      .enemiesOf(side)
      .filter((g) => !sides.eliminated[g])
      .sort((a, b) => Math.hypot(field.baseSites[a].x - home.x, field.baseSites[a].z - home.z) - Math.hypot(field.baseSites[b].x - home.x, field.baseSites[b].z - home.z) || a - b)
      .slice(0, FRONTS);
    const nav = ctx.navs.land;
    const r = ctx.buildings.wall.radius;
    const out: BuildJob[] = [];
    for (const enemy of fronts) {
      const rally = ctx.lanes.rally(side, enemy, 0);
      const base = field.baseSites[enemy];
      const d = Math.max(1, Math.hypot(base.x - rally.x, base.z - rally.z));
      const dx = (base.x - rally.x) / d;
      const dz = (base.z - rally.z) / d;
      // Forward is (cos h, -sin h) (see Transform.heading).
      const heading = Math.atan2(-dz, dx);
      for (let k = 0; k < SEGMENTS; k++) {
        const off = (k - (SEGMENTS - 1) / 2) * SEGMENT_GAP;
        const x = rally.x + dx * AHEAD - dz * off;
        const z = rally.z + dz * AHEAD + dx * off;
        if (!field.contains(x, z, 2) || field.isWater(x, z) || !nav.terrainAllowsAt(x, z) || !nav.fitsAt(x, z, r) || !this.safe(world, ctx, side, x, z)) continue;
        out.push({ x, z, heading, standX: x - dx * STAND_BACK, standZ: z - dz * STAND_BACK });
      }
    }
    return out;
  }

  private safe(world: World, ctx: SimContext, side: number, x: number, z: number): boolean {
    let safe = true;
    ctx.grid.forEachNear(x, z, SAFE_RADIUS, (other) => {
      if (safe && world.get(other, Targetable)?.kind === 'unit' && ctx.sides.hostile(side, world.req(other, Faction).id)) safe = false;
    });
    return safe;
  }

  /**
   * Each tick: an engineer at its spot puts up the wall, a side's HQ trains
   * an engineer when there's work and room, and walls crumble.
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
      if (Math.hypot(job.standX - t.x, job.standZ - t.z) > REACH) continue;
      this.jobs.delete(e);
      if (this.walls[side] >= WALLS_MOST || !ctx.navs.land.fitsAt(job.x, job.z, ctx.buildings.wall.radius)) continue;
      this.wallList.push(spawnBuilding(world, ctx, ctx.buildings.wall, side, job.x, job.z, job.heading, true));
      this.walls[side]++;
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
        const spot = spawnSpot(ctx, t.x + Math.cos(t.heading) * r, t.z - Math.sin(t.heading) * r, ctx.units.engineer.radius, 'foot');
        if (!spot) continue;
        spawnUnit(world, ctx, ctx.units.engineer, side, spot.x, spot.z);
        this.engineers[side]++;
      }
    }

    // Walls crumble over their lifetime (not while they're still going up).
    for (const e of this.wallList) {
      if (!world.isAlive(e) || world.has(e, Construction)) continue;
      const h = world.get(e, Health);
      if (h) h.hp -= (h.max / world.req(e, Building).def.lasts!) * dt;
    }
  }
}

/** Runs the engineers' building, training and the walls' decay each tick (see Engineers.tick). */
export function engineerSystem(ctx: SimContext): System {
  return {
    name: 'engineers',
    update(world, dt) {
      ctx.commander.engineers.tick(world, ctx, dt);
    },
  };
}
