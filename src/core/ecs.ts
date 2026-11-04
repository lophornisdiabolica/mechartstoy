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

export class World {
  /** Simulation time in seconds. */
  time = 0;
  tick = 0;

  private nextId = 1;
  private readonly alive = new Set<Entity>();
  /** One store per component type, indexed by its id. */
  private readonly stores: (Map<Entity, unknown> | undefined)[] = [];
  private readonly pendingDestroy = new Set<Entity>();
  private readonly systems: System[] = [];
  private readonly destroyListeners: ((e: Entity) => void)[] = [];

  create(): Entity {
    const e = this.nextId++;
    this.alive.add(e);
    return e;
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
    const stores: Map<Entity, unknown>[] = new Array(types.length);
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

  private flushDestroyed(): void {
    if (this.pendingDestroy.size === 0) return;
    for (const e of this.pendingDestroy) {
      for (const listener of this.destroyListeners) listener(e);
      for (const store of this.stores) store?.delete(e);
      this.alive.delete(e);
    }
    this.pendingDestroy.clear();
  }

  private store<T>(type: ComponentType<T>): Map<Entity, T> {
    let s = this.stores[type.id];
    if (!s) {
      s = new Map();
      this.stores[type.id] = s;
    }
    return s as Map<Entity, T>;
  }
}

/** World.query's iterator: a plain object rather than a generator, which is slower to step through. */
class Query implements IterableIterator<Entity> {
  constructor(
    private readonly stores: Map<Entity, unknown>[],
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
