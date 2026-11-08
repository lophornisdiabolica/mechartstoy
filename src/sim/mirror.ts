import { ComponentType, Entity } from '../core/ecs';
import { Armed, Building, Collider, Construction, Faction, Guard, Health, Mover, OutpostPart, Producer, Renderable, Rubble, Transform, Unit, Wreck } from '../game/components';
import { GameEvents } from '../game/context';
import { Command, Game, SIM_HZ } from '../game/game';
import { BattleSettings } from '../game/settings';
import { SideStats } from '../game/stats';
import { wrapAngle } from '../game/systems/movement';
import { CellState } from '../world/battlefield';
import { CellArea } from '../world/ground';
import { GodState } from '../game/god';

/**
 * Playing a battle in one place (the sim worker) and showing it in another
 * (the page). Both sides build the same Game from the same seed and
 * settings, so the map, the definitions and the opening armies match
 * without being sent. The page's copy is a view (no systems): after every
 * batch of ticks the worker sends a Frame with what the page reads, and
 * applyFrame copies it in. Rendering and UI code read the view exactly as
 * they'd read the real thing.
 *
 * Only what the page reads is copied: the components below, events (which
 * also rebuild the view's BattleStats), map changes, fallen trees, and the
 * side, outpost and order state the HUD shows. Reading anything else from
 * the view gets its opening state, so a page feature that needs more adds
 * it here.
 */

/**
 * Components copied to the page: each frame sends the ones added, removed
 * (a unit that dies loses Unit and Collider and becomes a Wreck) or
 * changed, and of a changed one just the fields that changed. Fields are
 * compared by value for numbers and strings and by reference for objects,
 * so a component holding an object has to replace it, not edit it, for the
 * change to show (Health.lastHit is replaced on every hit). Transform is
 * packed separately.
 */
const COPIED: ComponentType<unknown>[] = [Faction, Renderable, Unit, Building, Collider, Guard, OutpostPart, Armed, Health, Construction, Wreck, Rubble, Producer];
/** Numbers per entity in a Pose: id, x, y, z, heading, and Armed.aim (NaN if unarmed). */
const P_FIELDS = 6;

/** Where everything with a Transform was after one tick, packed P_FIELDS numbers per entity. */
export interface Pose {
  time: number;
  data: Float64Array;
}

const EVENT_TYPES: Record<keyof GameEvents, true> = {
  spawned: true,
  fired: true,
  impact: true,
  unitDestroyed: true,
  damaged: true,
  buildingDamaged: true,
  buildingDestroyed: true,
  constructionStarted: true,
  outpostCaptured: true,
  squadDropped: true,
  sideEliminated: true,
  battleOver: true,
  power: true,
  godUsed: true,
  earthwork: true,
  hunt: true,
  span: true,
};

/** Page to worker. */
export type ToSim =
  /** `skip`: fast-forward this many seconds before the first frame (the `at` URL option). */
  | { type: 'start'; battle: number; seed: number; settings: BattleSettings; skip?: number }
  /** Play `steps` ticks, then send a Frame (`profile`: time each system). */
  | { type: 'step'; battle: number; steps: number; profile: boolean }
  | { type: 'command'; battle: number; command: Command }
  | { type: 'settings'; battle: number; settings: BattleSettings }
  /** Send units' planned routes with frames (for the debug overlays), or stop. */
  | { type: 'routes'; battle: number; on: boolean };

/** Worker to page. */
export type FromSim =
  | { type: 'frame'; battle: number; frame: Frame }
  /** While fast-forwarding: how far it's got, in sim seconds. */
  | { type: 'progress'; battle: number; time: number }
  | { type: 'error'; message: string };

export interface Frame {
  time: number;
  tick: number;
  /** False when nothing happened since the last frame (no ticks, no commands): the rest is empty. */
  changed: boolean;
  /** Entities new to the page. */
  created: Entity[];
  /** Where everything was after each tick this frame covers, so the page can draw the path between ticks. */
  poses: Pose[];
  /** Entities that lost their Transform. */
  untransformed: Entity[];
  /** Components added or changed: entity, index in COPIED, and the fields that changed (all of them when added). */
  changes: [Entity, number, Record<string, unknown>][];
  /** Components removed: entity and index in COPIED. */
  removed: [Entity, number][];
  /** Events, each with the sim time of the end of the tick it happened in (when the page should show it). */
  events: [number, keyof GameEvents, unknown][];
  /** Entities destroyed, each with the time of the first pose without it. */
  destroyed: [Entity, number][];
  cells: CellState[];
  /** Trees that fell, and which way. */
  fell: [number, number][];
  /** Trees planted (a god power), in order: x, z and size. */
  grown: [number, number, number][];
  ctx: unknown;
  /** Ticks played for this frame, how long they took in all, and the slowest. */
  ticks: number;
  simMs: number;
  worstMs: number;
  /** Milliseconds per system over those ticks, when asked for. */
  profile: [string, number][] | null;
  /**
   * The battle's stats so far, with the first frame (the opening armies
   * spawned before the page was listening) and after a fast-forward (the
   * events that built them weren't sent).
   */
  stats?: { sides: SideStats[]; townRazed: number };
  /** After a fast-forward: a sign for the page to jump its drawing clock. */
  skipped?: true;
  /** When asked for (see SimHost.routes): each moving unit's route, as [entity, goal x, goal z, then x, z of each waypoint left]. */
  routes?: number[][];
}

/** Seconds between the routes sent for the debug overlays. */
const ROUTES_EVERY = 0.25;

/** Every moving unit's route now: entity, where it's headed, then the waypoints it has left (see Frame.routes). */
export function unitRoutes(world: Game['world']): number[][] {
  const out: number[][] = [];
  for (const e of world.query(Mover, Transform)) {
    const m = world.req(e, Mover);
    if (m.targetX === null || m.targetZ === null) continue;
    const route = [e, m.targetX, m.targetZ];
    const path = m.nav.path;
    if (path) for (let k = m.nav.pathIndex; k < path.length; k++) route.push(path[k].x, path[k].z);
    out.push(route);
  }
  return out;
}

/**
 * Shared definitions (unit, building, weapon and outpost kind defs) by
 * index, so components and events that point at them are sent as an index
 * and arrive pointing at the page's own copy. Both sides' Games are built
 * from the same settings, so walking them finds the same objects in the
 * same order.
 */
class Refs {
  private readonly index = new Map<object, number>();
  private readonly list: object[] = [];

  constructor(game: Game) {
    this.walk(game.ctx.units);
    this.walk(game.ctx.buildings);
    for (const o of game.ctx.outposts) this.walk(o.kind);
  }

  private walk(v: unknown): void {
    if (v === null || typeof v !== 'object' || this.index.has(v)) return;
    this.index.set(v, this.list.length);
    this.list.push(v);
    for (const k of Object.keys(v)) this.walk((v as Record<string, unknown>)[k]);
  }

  encode(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    const r = this.index.get(v);
    if (r !== undefined) return { $ref: r };
    if (Array.isArray(v)) return v.map((x) => this.encode(x));
    if (ArrayBuffer.isView(v)) return v;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = this.encode((v as Record<string, unknown>)[k]);
    return out;
  }

  decode(v: unknown): unknown {
    if (v === null || typeof v !== 'object' || ArrayBuffer.isView(v)) return v;
    if (Array.isArray(v)) return v.map((x) => this.decode(x));
    const ref = (v as { $ref?: number }).$ref;
    if (ref !== undefined) return this.list[ref];
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = this.decode((v as Record<string, unknown>)[k]);
    return out;
  }
}

/** Copy `from`'s fields into `to`, recursing into plain objects, so live settings change in place. */
function assignDeep(to: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const k of Object.keys(from)) {
    const a = to[k];
    const b = from[k];
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) assignDeep(a as Record<string, unknown>, b as Record<string, unknown>);
    else to[k] = b;
  }
}

/** The worker's side: plays the real battle and packs a Frame of what changed. */
export class SimHost {
  readonly game: Game;
  private readonly refs: Refs;
  /** Entities the page knows about. */
  private readonly known = new Set<Entity>();
  private destroyed: [Entity, number][] = [];
  private events: [number, keyof GameEvents, unknown][] = [];
  private poses: Pose[] = [];
  private areas: CellArea[] = [];
  private fell: [number, number][] = [];
  private grown: [number, number, number][] = [];
  /** What the page has of each COPIED component: per type, a shallow copy of each entity's as last sent. */
  private readonly sent = COPIED.map(() => new Map<Entity, Record<string, unknown>>());
  /** Entities whose Transform the page has. */
  private transformed = new Set<Entity>();
  private dirty = true;
  private ticks = 0;
  private simMs = 0;
  private worstMs = 0;
  /** The Commander picture last sent (its updatedAt): it changes every couple of seconds, so it's only sent when it does. */
  private commanderSent = -Infinity;
  /** The burning ground last sent (its version), sent again only when it changes. */
  private fireSent = 0;
  /** Fast-forwarded since the last frame (see skip). */
  private skipped = false;
  /** The stats need sending (see Frame.stats). */
  private statsDue = true;
  /** Send units' routes with frames, for the debug overlays; and when they were last sent. */
  routes = false;
  private routesAt = -Infinity;

  constructor(seed: number, settings: BattleSettings) {
    this.game = new Game(seed, { settings });
    this.refs = new Refs(this.game);
    const { world, events, field } = this.game;
    // The page's view made these too.
    for (const e of world.entities()) {
      // Not the opening armies, which the view doesn't make: the first frame sends them.
      if (world.has(e, Unit)) continue;
      this.known.add(e);
      // Its copies may not match until the first frame, which sends every
      // field, and takes away any of these the entity has lost by then (all
      // of them, if the page's copy has something this one never had). That
      // matters after a fast-forward, when a lot has changed.
      for (const sent of this.sent) sent.set(e, {});
    }
    world.onDestroy((e) => {
      // Destruction happens at the end of a step, before its time moves on.
      if (this.known.delete(e)) this.destroyed.push([e, world.time + 1 / SIM_HZ]);
    });
    for (const type of Object.keys(EVENT_TYPES) as (keyof GameEvents)[]) {
      events.on(type, (payload) => this.events.push([world.time + 1 / SIM_HZ, type, this.refs.encode(payload)]));
    }
    field.onChange((area) => this.areas.push(area));
    field.woods.onFell((t) => this.fell.push([t, field.woods.trees[t].fell!]));
    field.woods.onGrow((t) => {
      const tree = field.woods.trees[t];
      this.grown.push([tree.x, tree.z, tree.size]);
    });
  }

  step(steps: number, profile: boolean): void {
    const world = this.game.world;
    if (profile && !world.profile) world.profile = new Map();
    if (!profile) world.profile = null;
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.game.step(1 / SIM_HZ);
      const took = performance.now() - t0;
      this.poses.push(this.pose());
      this.ticks++;
      this.simMs += took;
      this.worstMs = Math.max(this.worstMs, took);
    }
    if (steps > 0) this.dirty = true;
  }

  /**
   * Fast-forward `ticks` ticks without keeping their poses or events: the
   * page jumps to where the battle has got to (the `at` URL option). Map
   * changes, fallen trees and deaths are still sent; the stats the events
   * would have built go with the next frame instead.
   */
  skip(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.game.step(1 / SIM_HZ);
    this.events = [];
    this.poses = [];
    this.skipped = true;
    this.statsDue = true;
    this.dirty = true;
  }

  /** Where everything with a Transform is now. */
  private pose(): Pose {
    const world = this.game.world;
    const data = new Float64Array(world.count(Transform) * P_FIELDS);
    let n = 0;
    for (const e of world.query(Transform)) {
      const t = world.req(e, Transform);
      data[n] = e;
      data[n + 1] = t.x;
      data[n + 2] = t.y;
      data[n + 3] = t.z;
      data[n + 4] = t.heading;
      data[n + 5] = world.get(e, Armed)?.aim ?? NaN;
      n += P_FIELDS;
    }
    return { time: world.time, data: n === data.length ? data : data.subarray(0, n) };
  }

  command(c: Command): void {
    this.game.command(c);
    this.dirty = true;
  }

  settings(settings: BattleSettings): void {
    assignDeep(this.game.settings as unknown as Record<string, unknown>, settings as unknown as Record<string, unknown>);
    this.dirty = true;
  }

  /** What changed since the last frame, and the typed arrays to transfer with it. */
  frame(): { frame: Frame; transfer: ArrayBuffer[] } {
    const { world, field, ctx } = this.game;
    const transfer: ArrayBuffer[] = [];
    const base = { time: world.time, tick: world.tick, ticks: this.ticks, simMs: this.simMs, worstMs: this.worstMs };
    const profile = world.profile ? [...world.profile] : null;
    world.profile?.clear();
    this.ticks = this.simMs = this.worstMs = 0;
    if (!this.dirty) {
      const empty: Frame = { ...base, changed: false, created: [], poses: [], untransformed: [], changes: [], removed: [], events: [], destroyed: [], cells: [], fell: [], grown: [], ctx: null, profile };
      return { frame: empty, transfer };
    }
    this.dirty = false;

    // Always end on where things are now (after a command while paused, say).
    if (this.poses.at(-1)?.time !== world.time) this.poses.push(this.pose());
    const poses = this.poses;
    this.poses = [];
    for (const p of poses) transfer.push(p.data.buffer as ArrayBuffer);

    const created: Entity[] = [];
    const transformed = new Set<Entity>();
    for (const e of world.query(Transform)) {
      if (!this.known.has(e)) {
        this.known.add(e);
        created.push(e);
      }
      transformed.add(e);
    }
    const untransformed: Entity[] = [];
    for (const e of this.transformed) if (!transformed.has(e)) untransformed.push(e);
    this.transformed = transformed;

    const changes: [Entity, number, Record<string, unknown>][] = [];
    const removed: [Entity, number][] = [];
    COPIED.forEach((type, index) => {
      const sent = this.sent[index];
      const present = new Set<Entity>();
      for (const e of world.query(type)) {
        if (!this.known.has(e)) continue;
        present.add(e);
        const value = world.get(e, type) as Record<string, unknown>;
        const last = sent.get(e);
        if (!last) {
          sent.set(e, { ...value });
          changes.push([e, index, this.refs.encode(value) as Record<string, unknown>]);
          continue;
        }
        let diff: Record<string, unknown> | null = null;
        for (const k in value) {
          const v = value[k];
          if (v === last[k] || (v !== v && last[k] !== last[k])) continue;
          last[k] = v;
          (diff ??= {})[k] = this.refs.encode(v);
        }
        if (diff) changes.push([e, index, diff]);
      }
      for (const e of sent.keys()) {
        if (present.has(e)) continue;
        sent.delete(e);
        if (this.known.has(e)) removed.push([e, index]);
      }
    });

    const cells = this.areas.map((a) => field.cellState(a));
    for (const c of cells) transfer.push(c.ground.buffer as ArrayBuffer, c.roadCell.buffer as ArrayBuffer, c.bridgeCell.buffer as ArrayBuffer, c.heights.buffer as ArrayBuffer);

    const frame: Frame = {
      ...base,
      changed: true,
      created,
      poses,
      untransformed,
      changes,
      removed,
      events: this.events,
      destroyed: this.destroyed,
      cells,
      fell: this.fell,
      grown: this.grown,
      ctx: this.refs.encode({
        escalation: ctx.escalation,
        orders: ctx.orders,
        outposts: ctx.outposts.map((o) => [o.owner, o.progress, o.claimant]),
        eliminatedAt: ctx.sides.eliminatedAt,
        plans: ctx.offensive.plansState,
        outcome: ctx.outcome,
        commander: ctx.commander.updatedAt !== this.commanderSent ? ctx.commander.state : null,
        god: ctx.god.blessings,
        fire: ctx.fire.version !== this.fireSent ? ctx.fire.snapshot() : null,
      }),
      profile,
      ...(this.statsDue ? { stats: { sides: structuredClone(this.game.stats.sides), townRazed: this.game.stats.townRazed } } : {}),
      ...(this.skipped ? { skipped: true as const } : {}),
      ...(this.routes && world.time - this.routesAt >= ROUTES_EVERY ? { routes: unitRoutes(world) } : {}),
    };
    if (frame.routes) this.routesAt = world.time;
    this.skipped = false;
    this.statsDue = false;
    this.commanderSent = ctx.commander.updatedAt;
    this.fireSent = ctx.fire.version;
    this.destroyed = [];
    this.events = [];
    this.areas = [];
    this.fell = [];
    this.grown = [];
    return { frame, transfer };
  }
}

interface CtxState {
  escalation: { tide: number; siege: number };
  orders: Game['ctx']['orders'];
  outposts: [number, number, number][];
  eliminatedAt: (number | null)[];
  plans: Game['ctx']['offensive']['plansState'];
  outcome: Game['ctx']['outcome'];
  commander: Game['ctx']['commander']['state'] | null;
  god: GodState;
  fire: number[] | null;
}

/** The page's side: copies Frames into a view Game (see GameOptions.view). */
/** A pose with a lookup from entity to its place in the data, made when first needed. */
interface BufferedPose extends Pose {
  index: Map<Entity, number> | null;
}

function indexOf(p: BufferedPose): Map<Entity, number> {
  if (!p.index) {
    p.index = new Map();
    for (let k = 0; k < p.data.length; k += P_FIELDS) p.index.set(p.data[k], k);
  }
  return p.index;
}

/**
 * The page's side: copies Frames into a view Game (see GameOptions.view),
 * and poses it for drawing at a sim time a little behind the newest frame
 * (see RemoteSim's DrawClock), along the tick-by-tick path the frames
 * carry. Events and deaths wait until drawing reaches the tick they
 * happened in, so an explosion goes off when its shell lands.
 */
export class SimView {
  private readonly refs: Refs;
  /** Poses not yet drawn past, oldest first. */
  private poses: BufferedPose[] = [];
  private events: [number, keyof GameEvents, unknown][] = [];
  private dying: [Entity, number][] = [];
  /** Entities that exist but that drawing hasn't reached the birth of yet: don't draw them. */
  readonly unborn = new Set<Entity>();
  /** Units' routes, when the worker was asked for them (see Frame.routes). */
  routes: number[][] | null = null;

  constructor(readonly game: Game) {
    this.refs = new Refs(game);
  }

  /** Copy a frame in. Positions, events and deaths wait for pose(). */
  apply(frame: Frame): void {
    const { world, field, ctx } = this.game;
    world.time = frame.time;
    world.tick = frame.tick;
    if (!frame.changed) return;

    // Trees first: the cells they stand in turn to forest with the map changes.
    for (const [x, z, size] of frame.grown) field.woods.grow(x, z, size);
    for (const c of frame.cells) field.applyCells(c);
    for (const [t, angle] of frame.fell) field.woods.showFell(t, angle);

    const last = frame.poses.at(-1);
    for (const e of frame.created) {
      world.adopt(e);
      world.add(e, Transform, { x: 0, y: 0, z: 0, heading: 0, px: 0, py: 0, pz: 0, pheading: 0 });
    }
    for (const p of frame.poses) {
      // A pose for a moment already buffered (a command while paused) replaces it.
      while (this.poses.length > 0 && this.poses[this.poses.length - 1].time >= p.time) this.poses.pop();
      this.poses.push({ ...p, index: null });
    }
    // Anything new starts where it is now, until pose() places it.
    if (last) {
      const index = indexOf(this.poses[this.poses.length - 1]);
      for (const e of frame.created) {
        const k = index.get(e);
        if (k === undefined) continue;
        const t = world.req(e, Transform);
        t.x = t.px = last.data[k + 1];
        t.y = t.py = last.data[k + 2];
        t.z = t.pz = last.data[k + 3];
        t.heading = t.pheading = last.data[k + 4];
      }
    }
    for (const e of frame.untransformed) world.remove(e, Transform);

    for (const [e, index, fields] of frame.changes) {
      const type = COPIED[index];
      const value = this.refs.decode(fields) as Record<string, unknown>;
      const current = world.get(e, type) as Record<string, unknown> | undefined;
      // Keep the object the page may hold on to; just refresh its fields.
      if (current) Object.assign(current, value);
      else world.add(e, type, value);
    }
    for (const [e, index] of frame.removed) world.remove(e, COPIED[index]);

    const s = this.refs.decode(frame.ctx) as CtxState;
    Object.assign(ctx.escalation, s.escalation);
    s.orders.forEach((o, f) => Object.assign(ctx.orders[f], o));
    s.outposts.forEach(([owner, progress, claimant], i) => Object.assign(ctx.outposts[i], { owner, progress, claimant }));
    s.eliminatedAt.forEach((at, f) => {
      if (at !== null && !ctx.sides.eliminated[f]) ctx.sides.eliminate(f, at);
    });
    ctx.offensive.plansState = s.plans;
    ctx.outcome = s.outcome;
    if (s.commander) ctx.commander.state = s.commander;
    ctx.god.blessings = s.god;
    if (s.fire) ctx.fire.apply(s.fire);
    if (frame.routes) this.routes = frame.routes;
    if (frame.stats) {
      const stats = this.game.stats;
      frame.stats.sides.forEach((side, f) => Object.assign(stats.sides[f], side));
      stats.townRazed = frame.stats.townRazed;
    }
    if (frame.skipped) {
      // Nothing from before the jump is left to show.
      this.events = [];
      this.dying = this.dying.filter(([, t]) => t > frame.time);
      for (const [e] of frame.destroyed) world.destroy(e);
      world.flush();
      frame.destroyed = [];
      this.poses = this.poses.slice(-1);
    }

    this.events.push(...frame.events);
    this.dying.push(...frame.destroyed);
  }

  /**
   * Pose everything for drawing at sim time `time`: each Transform gets the
   * two ticks either side (px.. and x..), turrets their aim between them,
   * and events and deaths up to `time` happen. Returns the alpha between
   * the two ticks.
   */
  pose(time: number): number {
    const { world, events } = this.game;
    let n = 0;
    while (n < this.events.length && this.events[n][0] <= time) n++;
    if (n > 0) {
      const due = this.events.splice(0, n);
      for (const [, type, payload] of due) events.emit(type, this.refs.decode(payload) as never);
    }
    n = 0;
    while (n < this.dying.length && this.dying[n][1] <= time) n++;
    if (n > 0) {
      for (const [e] of this.dying.splice(0, n)) world.destroy(e);
      world.flush();
    }

    const poses = this.poses;
    if (poses.length === 0) return 1;
    // Drop poses drawing is past, keeping the one at or just before `time`.
    let k = 0;
    while (k + 1 < poses.length && poses[k + 1].time <= time) k++;
    if (k > 0) this.poses = poses.slice(k);
    const a = this.poses[0];
    const b = this.poses[1] ?? a;
    const alpha = b.time > a.time ? Math.min(1, Math.max(0, (time - a.time) / (b.time - a.time))) : 1;
    const ia = indexOf(a);
    const ib = b === a ? ia : indexOf(b);
    const da = a.data;
    const db = b.data;
    this.unborn.clear();
    for (const e of world.query(Transform)) {
      const ka = ia.get(e);
      const kb = ib.get(e);
      // Born after the earlier tick: not on the field yet. Gone by the later one: stays where it was.
      if (ka === undefined) {
        this.unborn.add(e);
        continue;
      }
      const t = world.req(e, Transform);
      const [d, k2] = kb === undefined ? [da, ka] : [db, kb];
      t.px = da[ka + 1];
      t.py = da[ka + 2];
      t.pz = da[ka + 3];
      t.pheading = da[ka + 4];
      t.x = d[k2 + 1];
      t.y = d[k2 + 2];
      t.z = d[k2 + 3];
      t.heading = d[k2 + 4];
      const aim = d[k2 + 5];
      if (aim === aim) {
        const armed = world.get(e, Armed);
        const from = da[ka + 5];
        if (armed) armed.aim = from === from ? from + wrapAngle(aim - from) * alpha : aim;
      }
    }
    return alpha;
  }
}
