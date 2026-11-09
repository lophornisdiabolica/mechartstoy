import { Entity, System, World } from '../core/ecs';
import { Rng } from '../core/rng';
import * as D from '../core/dmath';
import {
  Armed,
  Building,
  Collider,
  Construction,
  Faction,
  GroundFollow,
  Health,
  makeNavState,
  makeTransform,
  militiaOf,
  Mover,
  NEUTRAL,
  Renderable,
  Targetable,
  Townsfolk,
  Transform,
  Unit,
} from './components';
import { SimContext } from './context';
import { armed, spawnBuilding } from './spawn';
import { BuildingId } from './buildings';
import { UnitDef } from './units';
import { TownSite } from '../world/battlefield';
import { MOVE_RULES } from '../world/moveClasses';

/*
 * Town life (the map's townsfolk setting): each civilian town has a few
 * people walking its streets and an engineer of its own, who puts up a new
 * building for the town every few minutes, so a town grows over a long
 * battle. Townsfolk keep away from the fighting, scattering from soldiers
 * and vehicles that come near.
 *
 * Nobody aims at the town, but stray fire wrecks it. Once one side has
 * razed MILITIA_AT of a town's buildings, its people take up rifles against
 * that side: the militia stand guard round the edge of their town and shoot
 * at that side's units that come close, and that side shoots back. They
 * never go out to attack, and other sides they leave alone. It's mostly
 * for the look of it: a handful of rifles against an army.
 *
 * Townsfolk belong to no side (NEUTRAL; the militia to their town's own
 * faction, see militiaOf), so they count toward nothing: no caps, kills or
 * strength. Everything here runs on its own random stream, so with the
 * setting off a battle plays exactly as it would without it.
 */

/** Townsfolk per town: this many, plus one per this much radius. */
const FOLK_BASE = 2;
const FOLK_PER_RADIUS = 5;
/** Seconds between someone new coming out of a building, while a town is short of people. */
const SPAWN_EVERY = 60;
/** Seconds between the town engineer's new buildings (and before its first). */
export const BUILD_EVERY = 240;
/** How far round a town new buildings can go, as a share of its radius. */
const GROW_REACH = 1.6;
/** Buildings one side razes in a town before its people take up arms against it. */
export const MILITIA_AT = 3;
/** Townsfolk scatter from armed units this close. */
const SCARE = 10;
/** Where the militia stand: this share of the town's radius out from its middle. */
const POST_OUT = 0.85;
/** Seconds between the town's updates. */
const TICK = 0.5;
/** The street grid's spacing (as in layoutTown). */
const SPACING = 4.4;
/** Buildings the town engineer puts up, by chance. */
const GROWTH: BuildingId[] = ['house', 'house', 'house', 'block', 'silo', 'warehouse'];

const townWeapon = {
  name: 'Hunting rifle',
  range: 9,
  minRange: 0,
  damage: 3,
  cooldown: 1.8,
  burst: 2,
  burstGap: 0.2,
  projectile: 'bullet' as const,
  speed: 55,
  splash: 0,
  spread: 0.1,
  arc: false,
  muzzleHeight: 0.4,
  targets: 'ground' as const,
};

const folk = (id: string, name: string, model: string, hp: number, speed: number): UnitDef => ({
  id,
  name,
  class: 'infantry',
  category: 'infantry',
  move: 'foot',
  role: 'support',
  model,
  hp,
  armor: 0,
  speed,
  turnRate: 6,
  radius: 0.3,
  sight: 10,
  turret: false,
  turretTurnRate: 6,
  weapon: townWeapon,
  wreckTime: 0,
  siege: false,
});

/** What townsfolk are. Not in UNIT_DEFS: no side builds them. */
export const TOWNSFOLK = {
  civilian: [folk('civilian', 'Civilian', 'civilian:0', 15, 1.1), folk('civilian', 'Civilian', 'civilian:1', 15, 1.1), folk('civilian', 'Civilian', 'civilian:2', 15, 1.1)],
  engineer: folk('townEngineer', 'Town engineer', 'engineer', 20, 1.2),
  militia: folk('militia', 'Militia', 'militia', 24, 1.3),
};

interface Town {
  site: TownSite;
  /** How many people it keeps. */
  wanted: number;
  /** When someone new may come out, and when the engineer starts its next building. */
  spawnAt: number;
  buildAt: number;
  /** Where the engineer's next building goes, once it's picked a spot. */
  plan: { x: number; z: number; heading: number; building: BuildingId } | null;
  /** Town buildings razed, per side. */
  razed: Map<number, number>;
  /** The sides its militia fight, in the order they made it angry. */
  grudges: number[];
}

/** Every town's people (see the notes at the top). */
export class Towns {
  readonly towns: Town[];
  private readonly rng: Rng;
  private started = false;
  private acc = 0;
  /** Town buildings razed since the last update: where, and by which side. */
  readonly pending: { x: number; z: number; by: number }[] = [];

  constructor(sites: TownSite[], seed: number) {
    this.rng = new Rng(seed ^ 0x666f6c6b);
    this.towns = sites.map((site) => ({
      site,
      wanted: FOLK_BASE + Math.round(site.radius / FOLK_PER_RADIUS),
      spawnAt: 0,
      buildAt: BUILD_EVERY,
      plan: null,
      razed: new Map(),
      grudges: [],
    }));
  }

  /** The town a point belongs to: the nearest whose (grown) ground it's on, or -1. */
  townAt(x: number, z: number): number {
    let best = -1;
    let bestD = Infinity;
    this.towns.forEach((t, k) => {
      const d = D.hypot(t.site.x - x, t.site.z - z);
      if (d <= t.site.radius * GROW_REACH + 2 && d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  }

  /** A town building came down: if a side did it once too often, the town takes up arms against it. */
  razed(world: World, ctx: SimContext, x: number, z: number, by: number): void {
    const k = this.townAt(x, z);
    if (k < 0 || by < 0 || by >= ctx.sides.count) return;
    const town = this.towns[k];
    const n = (town.razed.get(by) ?? 0) + 1;
    town.razed.set(by, n);
    if (n < MILITIA_AT || town.grudges.includes(by)) return;
    town.grudges.push(by);
    const militia = militiaOf(k);
    let grudge = ctx.sides.grudges.get(militia);
    if (!grudge) ctx.sides.grudges.set(militia, (grudge = new Set()));
    grudge.add(by);
    // Everyone who isn't the engineer picks up a rifle.
    for (const e of world.query(Townsfolk)) {
      const f = world.req(e, Townsfolk);
      if (f.town === k && f.role === 'civilian') this.arm(world, ctx, e, f);
    }
    ctx.events.emit('militia', { town: k, faction: by, x: town.site.x, z: town.site.z });
  }

  update(world: World, ctx: SimContext, dt: number): void {
    if (!this.started) {
      this.started = true;
      this.towns.forEach((town, k) => {
        this.spawn(world, ctx, k, 'engineer');
        for (let n = 0; n < town.wanted; n++) this.spawn(world, ctx, k, 'civilian');
        town.spawnAt = world.time + SPAWN_EVERY;
      });
    }
    for (const r of this.pending.splice(0)) this.razed(world, ctx, r.x, r.z, r.by);
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    const people = new Map<number, { count: number; engineer: boolean }>();
    for (const e of world.query(Townsfolk, Transform, Mover)) {
      const f = world.req(e, Townsfolk);
      const p = people.get(f.town) ?? { count: 0, engineer: false };
      if (f.role === 'engineer') p.engineer = true;
      else p.count++;
      people.set(f.town, p);
      if (f.role === 'engineer') this.engineer(world, ctx, e, f);
      else if (f.role === 'militia') this.guard(world, ctx, e, f);
      else this.wander(world, ctx, e, f);
    }
    // Someone new comes out of a building when a town's short of people (the engineer first).
    this.towns.forEach((town, k) => {
      if (world.time < town.spawnAt) return;
      const p = people.get(k) ?? { count: 0, engineer: false };
      if (p.engineer && p.count >= town.wanted) return;
      town.spawnAt = world.time + SPAWN_EVERY;
      this.spawn(world, ctx, k, p.engineer ? 'civilian' : 'engineer');
    });
  }

  /** Someone comes out of one of a town's buildings (or stands in its square, if they're all down). Returns the new entity, or null. */
  private spawn(world: World, ctx: SimContext, k: number, role: 'civilian' | 'engineer'): Entity | null {
    const town = this.towns[k];
    const homes: { x: number; z: number; r: number }[] = [];
    for (const e of world.query(Building, Faction, Transform)) {
      if (world.req(e, Faction).id !== NEUTRAL || world.has(e, Construction)) continue;
      const t = world.req(e, Transform);
      if (this.townAt(t.x, t.z) === k) homes.push({ x: t.x, z: t.z, r: world.req(e, Building).def.radius });
    }
    if (homes.length === 0) return null;
    const home = homes[this.rng.int(0, homes.length - 1)];
    const foot = ctx.navs.for('foot');
    let at: { x: number; z: number } | null = null;
    for (let n = 0; n < 8 && !at; n++) {
      const a = this.rng.range(0, Math.PI * 2);
      const x = home.x + D.cos(a) * (home.r + 0.8);
      const z = home.z + D.sin(a) * (home.r + 0.8);
      if (foot.terrainAllowsAt(x, z) && !foot.builtAt(x, z)) at = { x, z };
    }
    if (!at) return null;
    // A town that's taken up arms sends its new people straight to the guard.
    const militia = role === 'civilian' && town.grudges.length > 0;
    const def = role === 'engineer' ? TOWNSFOLK.engineer : militia ? TOWNSFOLK.militia : TOWNSFOLK.civilian[this.rng.int(0, TOWNSFOLK.civilian.length - 1)];
    const e = world.create();
    const heading = this.rng.range(-Math.PI, Math.PI);
    world.add(e, Transform, makeTransform(at.x, ctx.field.surfaceAt(at.x, at.z), at.z, heading));
    world.add(e, Faction, { id: NEUTRAL });
    world.add(e, Unit, { def });
    world.add(e, Targetable, { kind: 'unit' });
    world.add(e, Renderable, { model: def.model, scale: 1 });
    world.add(e, GroundFollow, { offset: MOVE_RULES.foot.altitude });
    world.add(e, Mover, { speed: def.speed, turnRate: def.turnRate, targetX: null, targetZ: null, faceX: null, faceZ: null, move: 'foot', nav: makeNavState() });
    world.add(e, Health, { hp: def.hp, max: def.hp, armor: 0, lastHit: null, hurtAt: -Infinity });
    world.add(e, Collider, { radius: def.radius });
    const f: Townsfolk = { town: k, role, nextAt: world.time + this.rng.range(0, 3), post: this.rng.int(0, 1000) };
    world.add(e, Townsfolk, f);
    if (militia) this.arm(world, ctx, e, f);
    return e;
  }

  /** A civilian takes up a rifle and joins the town's guard. */
  private arm(world: World, ctx: SimContext, e: Entity, f: Townsfolk): void {
    f.role = 'militia';
    f.nextAt = world.time;
    const def = TOWNSFOLK.militia;
    world.req(e, Unit).def = def;
    world.req(e, Faction).id = militiaOf(f.town);
    world.req(e, Renderable).model = def.model;
    const h = world.req(e, Health);
    h.hp = Math.max(h.hp, def.hp * (h.hp / h.max));
    h.max = def.hp;
    world.add(e, Armed, armed(ctx, def.weapon, def.sight, false, def.turnRate, 0.25, world.req(e, Transform).heading));
  }

  /** A civilian strolls about town, and scatters from armed units that come near. */
  private wander(world: World, ctx: SimContext, e: Entity, f: Townsfolk): void {
    const t = world.req(e, Transform);
    const m = world.req(e, Mover);
    const site = this.towns[f.town].site;
    const scare = this.nearestArmed(world, ctx, t.x, t.z);
    if (world.time < f.nextAt && !scare) return;
    f.nextAt = world.time + this.rng.range(5, 12);
    let to: { x: number; z: number } | null = null;
    if (scare) {
      // Away from it, toward the far side of town.
      const d = Math.max(0.5, D.hypot(t.x - scare.x, t.z - scare.z));
      to = this.inTown(ctx, site, t.x + ((t.x - scare.x) / d) * 8, t.z + ((t.z - scare.z) / d) * 8);
      f.nextAt = world.time + 3;
    }
    to ??= this.somewhere(ctx, site, 0.85);
    if (!to) return;
    m.targetX = to.x;
    m.targetZ = to.z;
    m.faceX = null;
    m.faceZ = null;
  }

  /** The militia take their posts round the edge of town, facing out toward the sides they fight. */
  private guard(world: World, ctx: SimContext, e: Entity, f: Townsfolk): void {
    if (world.time < f.nextAt) return;
    f.nextAt = world.time + 3;
    const town = this.towns[f.town];
    const site = town.site;
    const m = world.req(e, Mover);
    const t = world.req(e, Transform);
    // Toward the base of one of the sides they fight (taking turns by post), spread along the edge.
    const live = town.grudges.filter((g) => !ctx.sides.eliminated[g]);
    const enemy = live.length > 0 ? live[f.post % live.length] : town.grudges[0];
    const base = ctx.field.baseSites[enemy];
    const toward = base ? D.atan2(base.z - site.z, base.x - site.x) : 0;
    const a = toward + (((f.post * 0.618034) % 1) - 0.5) * 1.6;
    const r = site.radius * POST_OUT;
    const post = this.inTown(ctx, site, site.x + D.cos(a) * r, site.z + D.sin(a) * r) ?? { x: site.x, z: site.z };
    const close = D.hypot(post.x - t.x, post.z - t.z) < 1.5;
    m.targetX = close ? null : post.x;
    m.targetZ = close ? null : post.z;
    m.faceX = site.x + D.cos(a) * r * 2;
    m.faceZ = site.z + D.sin(a) * r * 2;
  }

  /** The town engineer: every BUILD_EVERY seconds it walks to an open spot at the edge of town and puts up a new building. */
  private engineer(world: World, ctx: SimContext, e: Entity, f: Townsfolk): void {
    const town = this.towns[f.town];
    const t = world.req(e, Transform);
    const m = world.req(e, Mover);
    if (!town.plan && world.time >= town.buildAt) {
      town.plan = this.buildSpot(ctx, town);
      // Nowhere to build: try again later.
      if (!town.plan) town.buildAt = world.time + BUILD_EVERY / 4;
    }
    const plan = town.plan;
    if (!plan) {
      this.wander(world, ctx, e, f);
      return;
    }
    const def = ctx.buildings[plan.building];
    const d = D.hypot(plan.x - t.x, plan.z - t.z);
    if (d > def.radius + 2.5) {
      // Stand at its edge.
      m.targetX = plan.x + ((t.x - plan.x) / Math.max(0.1, d)) * (def.radius + 1.2);
      m.targetZ = plan.z + ((t.z - plan.z) / Math.max(0.1, d)) * (def.radius + 1.2);
      m.faceX = plan.x;
      m.faceZ = plan.z;
      return;
    }
    town.plan = null;
    town.buildAt = world.time + BUILD_EVERY;
    if (!this.fits(ctx, plan.x, plan.z, def.radius) || this.nearestArmed(world, ctx, plan.x, plan.z)) return;
    spawnBuilding(world, ctx, def, NEUTRAL, plan.x, plan.z, plan.heading, true);
  }

  /** The next spot for a town building: the open spot on the town's street grid nearest its middle, out to GROW_REACH of its radius. */
  private buildSpot(ctx: SimContext, town: Town): Town['plan'] {
    const site = town.site;
    const cells = Math.ceil((site.radius * GROW_REACH) / SPACING);
    const building = GROWTH[this.rng.int(0, GROWTH.length - 1)];
    const r = ctx.buildings[building].radius;
    let best: { x: number; z: number; d: number } | null = null;
    for (let i = -cells; i <= cells; i++) {
      for (let j = -cells; j <= cells; j++) {
        // The main street stays clear, as in layoutTown.
        if (j === 0) continue;
        const lx = i * SPACING;
        const lz = j * SPACING;
        const d = D.hypot(lx, lz) + this.rng.range(0, 1.5);
        if (d > site.radius * GROW_REACH || (best && d >= best.d)) continue;
        const x = site.x + lx * D.cos(site.angle) - lz * D.sin(site.angle);
        const z = site.z + lx * D.sin(site.angle) + lz * D.cos(site.angle);
        if (this.fits(ctx, x, z, r)) best = { x, z, d };
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, heading: -site.angle + this.rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]), building };
  }

  /** Whether a town building fits at a spot: dry, gentle, clear of buildings, bridges, bases and outposts. */
  private fits(ctx: SimContext, x: number, z: number, r: number): boolean {
    const { field } = ctx;
    const nav = ctx.navs.land;
    if (!field.contains(x, z, r + 2) || field.nearBridge(x, z, r + 1.5) || field.slopeAt(x, z) > 0.45) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) if (field.isWater(x + dx, z + dz)) return false;
    if (!nav.fitsAt(x, z, r + 0.7) || nav.builtAt(x, z)) return false;
    if (field.roadCell[field.cellAt(x, z)[1] * field.config.cols + field.cellAt(x, z)[0]]) return false;
    for (const b of field.baseSites) if (D.hypot(b.x - x, b.z - z) < b.radius + r + 4) return false;
    for (const o of field.outpostSites) if (D.hypot(o.x - x, o.z - z) < o.radius + r + 3) return false;
    return true;
  }

  /** A random open spot in a town, within `share` of its radius. */
  private somewhere(ctx: SimContext, site: TownSite, share: number): { x: number; z: number } | null {
    for (let n = 0; n < 6; n++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * site.radius * share;
      const p = this.inTown(ctx, site, site.x + D.cos(a) * r, site.z + D.sin(a) * r);
      if (p) return p;
    }
    return null;
  }

  /** A point pulled inside a town's ground, if people can stand there. */
  private inTown(ctx: SimContext, site: TownSite, x: number, z: number): { x: number; z: number } | null {
    const d = D.hypot(x - site.x, z - site.z);
    const most = site.radius * 1.1;
    if (d > most) {
      x = site.x + ((x - site.x) / d) * most;
      z = site.z + ((z - site.z) / d) * most;
    }
    const foot = ctx.navs.for('foot');
    return foot.terrainAllowsAt(x, z) && !foot.builtAt(x, z) ? { x, z } : null;
  }

  /** The nearest armed unit of any side within SCARE of a point, or null. */
  private nearestArmed(world: World, ctx: SimContext, x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestD = SCARE * SCARE;
    ctx.grid.forEachNear(x, z, SCARE, (other, d2) => {
      if (d2 >= bestD || world.get(other, Targetable)?.kind !== 'unit' || !world.has(other, Armed)) return;
      const f = world.req(other, Faction).id;
      if (f < 0) return;
      bestD = d2;
      const t = world.req(other, Transform);
      best = { x: t.x, z: t.z };
    });
    return best;
  }
}

/** Runs the towns' people (see Towns); does nothing with the townsfolk setting off. */
export function townSystem(ctx: SimContext): System {
  if (ctx.settings.map.townLife) {
    ctx.events.on('buildingDestroyed', (ev) => {
      if (ev.faction === NEUTRAL && ev.killer) ctx.towns.pending.push({ x: ev.x, z: ev.z, by: ev.killer.faction });
    });
  }
  return {
    name: 'towns',
    update(world, dt) {
      if (ctx.settings.map.townLife) ctx.towns.update(world, ctx, dt);
    },
  };
}
