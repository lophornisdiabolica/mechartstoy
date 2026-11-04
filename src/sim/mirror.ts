import { ComponentType, Entity } from '../core/ecs';
import { Armed, Building, Collider, Construction, Faction, Guard, Health, OutpostPart, Producer, Renderable, Rubble, Transform, Unit, Wreck } from '../game/components';
import { GameEvents } from '../game/context';
import { Command, Game, SIM_HZ } from '../game/game';
import { BattleSettings } from '../game/settings';
import { wrapAngle } from '../game/systems/movement';
import { CellState } from '../world/battlefield';
import { CellArea } from '../world/ground';

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
/** Transform's fields, in the order they're packed. */
const T_FIELDS = 9;

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
};

/** Page to worker. */
export type ToSim =
  | { type: 'start'; battle: number; seed: number; settings: BattleSettings }
  /** Play `steps` ticks, then send a Frame (`profile`: time each system). */
  | { type: 'step'; battle: number; steps: number; profile: boolean }
  | { type: 'command'; battle: number; command: Command }
  | { type: 'settings'; battle: number; settings: BattleSettings };

/** Worker to page. */
export type FromSim = { type: 'frame'; battle: number; frame: Frame } | { type: 'error'; message: string };

export interface Frame {
  time: number;
  tick: number;
  /** False when nothing happened since the last frame (no ticks, no commands): the rest is empty. */
  changed: boolean;
  /** Entities new to the page. */
  created: Entity[];
  /** Every Transform, packed: entity id then T_FIELDS numbers. */
  transforms: Float64Array;
  /** Entities that lost their Transform. */
  untransformed: Entity[];
  /** Components added or changed: entity, index in COPIED, and the fields that changed (all of them when added). */
  changes: [Entity, number, Record<string, unknown>][];
  /** Components removed: entity and index in COPIED. */
  removed: [Entity, number][];
  events: [keyof GameEvents, unknown][];
  destroyed: Entity[];
  cells: CellState[];
  /** Trees that fell, and which way. */
  fell: [number, number][];
  ctx: unknown;
  /** Ticks played for this frame, how long they took in all, and the slowest. */
  ticks: number;
  simMs: number;
  worstMs: number;
  /** Milliseconds per system over those ticks, when asked for. */
  profile: [string, number][] | null;
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
  private destroyed: Entity[] = [];
  private events: [keyof GameEvents, unknown][] = [];
  private areas: CellArea[] = [];
  private fell: [number, number][] = [];
  /** What the page has of each COPIED component: per type, a shallow copy of each entity's as last sent. */
  private readonly sent = COPIED.map(() => new Map<Entity, Record<string, unknown>>());
  /** Entities whose Transform the page has. */
  private transformed = new Set<Entity>();
  private dirty = true;
  private ticks = 0;
  private simMs = 0;
  private worstMs = 0;

  constructor(seed: number, settings: BattleSettings) {
    this.game = new Game(seed, { settings });
    this.refs = new Refs(this.game);
    const { world, events, field } = this.game;
    // The page's view made these too.
    for (const e of world.entities()) this.known.add(e);
    world.onDestroy((e) => {
      if (this.known.delete(e)) this.destroyed.push(e);
    });
    for (const type of Object.keys(EVENT_TYPES) as (keyof GameEvents)[]) {
      events.on(type, (payload) => this.events.push([type, this.refs.encode(payload)]));
    }
    field.onChange((area) => this.areas.push(area));
    field.woods.onFell((t) => this.fell.push([t, field.woods.trees[t].fell!]));
  }

  step(steps: number, profile: boolean): void {
    const world = this.game.world;
    if (profile && !world.profile) world.profile = new Map();
    if (!profile) world.profile = null;
    for (let i = 0; i < steps; i++) {
      const t0 = performance.now();
      this.game.step(1 / SIM_HZ);
      const took = performance.now() - t0;
      this.ticks++;
      this.simMs += took;
      this.worstMs = Math.max(this.worstMs, took);
    }
    if (steps > 0) this.dirty = true;
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
      const empty: Frame = { ...base, changed: false, created: [], transforms: new Float64Array(0), untransformed: [], changes: [], removed: [], events: [], destroyed: [], cells: [], fell: [], ctx: null, profile };
      return { frame: empty, transfer };
    }
    this.dirty = false;

    const created: Entity[] = [];
    const count = world.count(Transform);
    const transforms = new Float64Array(count * (T_FIELDS + 1));
    const transformed = new Set<Entity>();
    let n = 0;
    for (const e of world.query(Transform)) {
      if (!this.known.has(e)) {
        this.known.add(e);
        created.push(e);
      }
      transformed.add(e);
      const t = world.req(e, Transform);
      transforms[n] = e;
      transforms[n + 1] = t.x;
      transforms[n + 2] = t.y;
      transforms[n + 3] = t.z;
      transforms[n + 4] = t.heading;
      transforms[n + 5] = t.px;
      transforms[n + 6] = t.py;
      transforms[n + 7] = t.pz;
      transforms[n + 8] = t.pheading;
      n += T_FIELDS + 1;
    }
    transfer.push(transforms.buffer);
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
      transforms,
      untransformed,
      changes,
      removed,
      events: this.events,
      destroyed: this.destroyed,
      cells,
      fell: this.fell,
      ctx: this.refs.encode({
        escalation: ctx.escalation,
        orders: ctx.orders,
        outposts: ctx.outposts.map((o) => [o.owner, o.progress, o.claimant]),
        eliminatedAt: ctx.sides.eliminatedAt,
        plans: ctx.offensive.plansState,
        outcome: ctx.outcome,
      }),
      profile,
    };
    this.destroyed = [];
    this.events = [];
    this.areas = [];
    this.fell = [];
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
}

/** The page's side: copies Frames into a view Game (see GameOptions.view). */
export class SimView {
  private readonly refs: Refs;
  constructor(readonly game: Game) {
    this.refs = new Refs(game);
  }

  /**
   * Copy a frame in. Each Transform's previous position (px, py, pz,
   * pheading) becomes where it was drawn at `alpha` before this frame, so
   * drawing goes on smoothly from there to the new position however many
   * ticks the frame covers (see RemoteSim). New entities move from their
   * last tick's position.
   */
  apply(frame: Frame, alpha = 1): void {
    const { world, field, ctx, events } = this.game;
    world.time = frame.time;
    world.tick = frame.tick;
    if (!frame.changed) return;

    for (const c of frame.cells) field.applyCells(c);
    for (const [t, angle] of frame.fell) field.woods.showFell(t, angle);

    for (const e of frame.created) world.adopt(e);

    const tf = frame.transforms;
    for (let k = 0; k < tf.length; k += T_FIELDS + 1) {
      const e = tf[k];
      let t = world.get(e, Transform);
      if (t) {
        t.px += (t.x - t.px) * alpha;
        t.py += (t.y - t.py) * alpha;
        t.pz += (t.z - t.pz) * alpha;
        t.pheading += wrapAngle(t.heading - t.pheading) * alpha;
      } else {
        t = world.add(e, Transform, { x: 0, y: 0, z: 0, heading: 0, px: tf[k + 5], py: tf[k + 6], pz: tf[k + 7], pheading: tf[k + 8] });
      }
      t.x = tf[k + 1];
      t.y = tf[k + 2];
      t.z = tf[k + 3];
      t.heading = tf[k + 4];
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

    for (const [type, payload] of frame.events) events.emit(type, this.refs.decode(payload) as never);

    for (const e of frame.destroyed) world.destroy(e);
    world.flush();
  }
}
