import { EventBus } from '../core/events';
import { Entity, World } from '../core/ecs';
import { Rng } from '../core/rng';
import { Battlefield, generateBattlefield } from '../world/battlefield';
import { Prop, scatterProps } from '../world/props';
import { Faction, GroundFollow, makeTransform, Mover, Renderable, Transform, Wander } from './components';
import { groundFollowSystem, movementSystem } from './systems/movement';
import { snapshotSystem } from './systems/snapshot';
import { wanderSystem } from './systems/wander';

/** Events systems can publish for other layers (effects, audio, UI) to react to. */
export type GameEvents = {
  spawned: { entity: Entity };
};

export const SIM_HZ = 30;

/**
 * Owns the simulation: world state, battlefield, and the ordered list of
 * systems. Has no knowledge of Three.js, so it can run headless in tests.
 */
export class Game {
  readonly world = new World();
  readonly events = new EventBus<GameEvents>();
  readonly field: Battlefield;
  readonly props: Prop[];
  private readonly rng: Rng;

  constructor(readonly seed: number) {
    const root = new Rng(seed);
    this.field = generateBattlefield(root.fork(1));
    this.props = scatterProps(this.field, root.fork(2));
    this.rng = root.fork(3);

    // Order matters: snapshot first, then behaviour, then movement, then constraints.
    this.world.addSystem(snapshotSystem);
    this.world.addSystem(wanderSystem(this.field, root.fork(4)));
    this.world.addSystem(movementSystem());
    this.world.addSystem(groundFollowSystem(this.field));

    this.spawnPlaceholderUnits();
  }

  step(dt: number): void {
    this.world.step(dt);
  }

  /** Spawn a ground unit. Step 2 replaces the hard-coded stats with data-driven unit defs. */
  spawnProbe(faction: number, x: number, z: number): Entity {
    const w = this.world;
    const e = w.create();
    w.add(e, Transform, makeTransform(x, this.field.surfaceAt(x, z), z, faction === 0 ? 0 : Math.PI));
    w.add(e, Faction, { id: faction });
    w.add(e, Renderable, { model: 'probe', scale: 1 });
    w.add(e, GroundFollow, { offset: 0 });
    w.add(e, Mover, { speed: 3, turnRate: 2.5, targetX: null, targetZ: null });
    w.add(e, Wander, { nextPickAt: 0 });
    this.events.emit('spawned', { entity: e });
    return e;
  }

  private spawnPlaceholderUnits(): void {
    for (const site of this.field.baseSites) {
      for (let i = 0; i < 10; i++) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(2, site.radius * 0.8);
        this.spawnProbe(site.faction, site.x + Math.cos(a) * r, site.z + Math.sin(a) * r);
      }
    }
  }
}
