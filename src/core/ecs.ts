/**
 * Minimal entity/component store.
 *
 * Entities are plain numbers. Components are plain data objects keyed by a
 * ComponentType token. Systems are functions over the World that run each
 * simulation tick. Keep game logic in systems and data in components, so new
 * unit/building behaviours are added by composing components rather than by
 * subclassing.
 */
export type Entity = number;

export interface ComponentType<T> {
  readonly name: string;
  /** Index of this component's store in every World. */
  readonly id: number;
  /** Phantom field that carries T for type inference only. */
  readonly __type?: T;
}

let nextComponentId = 0;

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name, id: nextComponentId++ };
}

export interface System {
  readonly name: string;
  update(world: World, dt: number): void;
}

/**
 * One component type's values. Lookups go to an array indexed by entity id
 * (much faster than hashing every id in a Map, and systems look components
 * up constantly). Ids only ever go up, so the array covers a window of them,
 * from `base`: when it gets much longer than there are values, the window
 * moves up, and the few long-lived entities left below it (buildings,
 * mostly) move to a small Map. The big Map keeps the order
 * entities got the component in, which queries iterate in, so battles play
 * out the same.
 */
class Store<T> {
  readonly map = new Map<Entity, T>();
  private base = 0;
  private window: (T | undefined)[] = [];
  /** Values of entities below the window: the first EARLY ids (the battle's opening buildings, mostly) in an array, later ones in a Map. */
  private early: (T | undefined)[] | null = null;
  private readonly old = new Map<Entity, T>();

  get size(): number {
    return this.map.size;
  }

  get(e: Entity): T | undefined {
    if (e >= this.base) return this.window[e - this.base];
    return e < EARLY ? this.early?.[e] : this.old.get(e);
  }

  has(e: Entity): boolean {
    return this.get(e) !== undefined;
  }

  set(e: Entity, value: T): void {
    this.map.set(e, value);
    if (e < this.base) {
      this.setOld(e, value);
      return;
    }
    const w = this.window;
    const i = e - this.base;
    // Never sparse, so it stays a fast array.
    while (w.length < i) w.push(undefined);
    w[i] = value;
    if (w.length > WINDOW_SLACK * this.map.size + WINDOW_MIN) this.slide();
  }

  delete(e: Entity): void {
    if (!this.map.delete(e)) return;
    if (e < this.base) {
      if (e < EARLY) this.early![e] = undefined;
      else this.old.delete(e);
      return;
    }
    const w = this.window;
    w[e - this.base] = undefined;
    while (w.length > 0 && w[w.length - 1] === undefined) w.pop();
    if (w.length > WINDOW_SLACK * this.map.size + WINDOW_MIN) this.slide();
  }

  keys(): IterableIterator<Entity> {
    return this.map.keys();
  }

  /** Move the window's start up so it's half as long as allowed, the values below it going to `old`. */
  private slide(): void {
    const w = this.window;
    const top = this.base + w.length;
    const base = Math.max(this.base, top - Math.floor((WINDOW_SLACK * this.map.size + WINDOW_MIN) / 2));
    for (let e = this.base; e < base; e++) {
      const v = w[e - this.base];
      if (v !== undefined) this.setOld(e, v);
    }
    this.window = w.slice(base - this.base);
    this.base = base;
  }

  private setOld(e: Entity, value: T): void {
    if (e >= EARLY) {
      this.old.set(e, value);
      return;
    }
    if (!this.early) this.early = new Array<T | undefined>(EARLY).fill(undefined);
    this.early[e] = value;
  }
}

/** A Store's window moves up once it's this many times longer than the values it holds, plus this many. */
const WINDOW_SLACK = 32;
const WINDOW_MIN = 4096;
/** Ids below this keep a fast slot of their own once the window has moved past them. */
const EARLY = 4096;

export class World {
  /** Simulation time in seconds. */
  time = 0;
  tick = 0;

  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /** One store per component type, indexed by its id. */
  private readonly stores: (Store<unknown> | undefined)[] = [];
  private readonly pendingDestroy = new Set<Entity>();
  private readonly systems: System[] = [];
  private readonly destroyListeners: ((e: Entity) => void)[] = [];

  create(): Entity {
    const e = this.nextId++;
    this.alive.add(e);
    return e;
  }

  /**
   * Bring an entity with a given id to life (a mirror of another World
   * copying its entities, see sim/mirror.ts). Later create() calls carry on
   * after the highest id seen.
   */
  adopt(e: Entity): void {
    this.alive.add(e);
    if (e >= this.nextId) this.nextId = e + 1;
  }

  /** Every live entity, including ones waiting to be destroyed at the end of the step. */
  entities(): IterableIterator<Entity> {
    return this.alive.values();
  }

  isAlive(e: Entity): boolean {
    return this.alive.has(e);
  }

  /** Destruction is deferred to the end of the tick so systems can iterate safely. */
  destroy(e: Entity): void {
    if (this.alive.has(e)) this.pendingDestroy.add(e);
  }

  onDestroy(listener: (e: Entity) => void): void {
    this.destroyListeners.push(listener);
  }

  add<T>(e: Entity, type: ComponentType<T>, value: T): T {
    this.store(type).set(e, value);
    return value;
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.store(type).get(e);
  }

  /** Like get, but throws if missing. Use when a query already guarantees presence. */
  req<T>(e: Entity, type: ComponentType<T>): T {
    const v = this.store(type).get(e);
    if (v === undefined) throw new Error(`Entity ${e} has no ${type.name}`);
    return v;
  }

  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.store(type).has(e);
  }

  remove(e: Entity, type: ComponentType<unknown>): void {
    this.store(type).delete(e);
  }

  /**
   * Entities that have every listed component. Iterates the smallest store,
   * lazily, so entities added to it mid-loop are visited too and each is
   * checked just before it's handed out.
   */
  query(...types: ComponentType<unknown>[]): IterableIterator<Entity> {
    if (types.length === 0) return new Query([], [][Symbol.iterator](), this.pendingDestroy);
    const stores: Store<unknown>[] = new Array(types.length);
    let smallest = (stores[0] = this.store(types[0]));
    for (let i = 1; i < types.length; i++) {
      const s = (stores[i] = this.store(types[i]));
      if (s.size < smallest.size) smallest = s;
    }
    return new Query(stores, smallest.keys(), this.pendingDestroy);
  }

  count(type: ComponentType<unknown>): number {
    return this.store(type).size;
  }

  get entityCount(): number {
    return this.alive.size;
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }

  /**
   * Milliseconds spent in each system (and in end-of-tick cleanup), summed over
   * the ticks since it was set to an empty Map; null (the default) times nothing.
   * For `npm run sims -- --profile`, `npm run bench` and the render stats readout.
   */
  profile: Map<string, number> | null = null;

  /** Advance the simulation by one fixed step. */
  step(dt: number): void {
    const profile = this.profile;
    if (profile) {
      for (const system of this.systems) {
        const t0 = performance.now();
        system.update(this, dt);
        profile.set(system.name, (profile.get(system.name) ?? 0) + performance.now() - t0);
      }
      const t0 = performance.now();
      this.flushDestroyed();
      profile.set('cleanup', (profile.get('cleanup') ?? 0) + performance.now() - t0);
    } else {
      for (const system of this.systems) system.update(this, dt);
      this.flushDestroyed();
    }
    this.time += dt;
    this.tick++;
  }

  /** The systems' names, in the order they run. */
  get systemNames(): string[] {
    return this.systems.map((s) => s.name);
  }

  /** Remove the entities destroyed so far now, rather than at the end of the next step. */
  flush(): void {
    this.flushDestroyed();
  }

  private flushDestroyed(): void {
    if (this.pendingDestroy.size === 0) return;
    for (const e of this.pendingDestroy) {
      for (const listener of this.destroyListeners) listener(e);
      for (const store of this.stores) store?.delete(e);
      this.alive.delete(e);
    }
    this.pendingDestroy.clear();
  }

  private store<T>(type: ComponentType<T>): Store<T> {
    let s = this.stores[type.id];
    if (!s) {
      s = new Store();
      this.stores[type.id] = s;
    }
    return s as Store<T>;
  }
}

/** World.query's iterator: a plain object rather than a generator, which is slower to step through. */
class Query implements IterableIterator<Entity> {
  constructor(
    private readonly stores: Store<unknown>[],
    private readonly keys: Iterator<Entity>,
    private readonly pending: Set<Entity>,
  ) {}

  next(): IteratorResult<Entity> {
    const stores = this.stores;
    outer: for (;;) {
      const r = this.keys.next();
      if (r.done) return r;
      const e = r.value;
      if (this.pending.has(e)) continue;
      for (let i = 0; i < stores.length; i++) if (!stores[i].has(e)) continue outer;
      return r;
    }
  }

  [Symbol.iterator](): IterableIterator<Entity> {
    return this;
  }
}
