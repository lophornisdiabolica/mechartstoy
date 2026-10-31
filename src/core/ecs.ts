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
  /** Phantom field that carries T for type inference only. */
  readonly __type?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name };
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
  private readonly stores = new Map<ComponentType<unknown>, Map<Entity, unknown>>();
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

  /** Entities that have every listed component. Iterates the smallest store. */
  *query(...types: ComponentType<unknown>[]): IterableIterator<Entity> {
    if (types.length === 0) return;
    const stores = types.map((t) => this.store(t));
    let smallest = stores[0];
    for (const s of stores) if (s.size < smallest.size) smallest = s;
    outer: for (const e of smallest.keys()) {
      if (this.pendingDestroy.has(e)) continue;
      for (const s of stores) if (!s.has(e)) continue outer;
      yield e;
    }
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

  /** Advance the simulation by one fixed step. */
  step(dt: number): void {
    for (const system of this.systems) system.update(this, dt);
    this.flushDestroyed();
    this.time += dt;
    this.tick++;
  }

  private flushDestroyed(): void {
    if (this.pendingDestroy.size === 0) return;
    for (const e of this.pendingDestroy) {
      for (const listener of this.destroyListeners) listener(e);
      for (const store of this.stores.values()) store.delete(e);
      this.alive.delete(e);
    }
    this.pendingDestroy.clear();
  }

  private store<T>(type: ComponentType<T>): Map<Entity, T> {
    let s = this.stores.get(type);
    if (!s) {
      s = new Map();
      this.stores.set(type, s);
    }
    return s as Map<Entity, T>;
  }
}
