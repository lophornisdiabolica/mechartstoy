import { EventBus } from '../core/events';
import { World } from '../core/ecs';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield, generateBattlefield } from '../world/battlefield';
import { Prop, scatterProps } from '../world/props';
import { GameEvents, SimContext } from './context';
import { aiSystem } from './systems/ai';
import { deathSystem, wreckSystem } from './systems/death';
import { groundFollowSystem, movementSystem, separationSystem } from './systems/movement';
import { projectileSystem } from './systems/projectiles';
import { reinforcementSystem, spawnWave } from './systems/reinforcements';
import { snapshotSystem } from './systems/snapshot';
import { spatialIndexSystem } from './systems/spatialIndex';
import { weaponSystem } from './systems/weapons';

export type { GameEvents } from './context';

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
  readonly ctx: SimContext;

  constructor(readonly seed: number) {
    const root = new Rng(seed);
    this.field = generateBattlefield(root.fork(1));
    this.props = scatterProps(this.field, root.fork(2));
    this.ctx = { field: this.field, events: this.events, grid: new SpatialGrid(6), rng: root.fork(3) };

    // Order matters: snapshot first, then index, decide, move, fight, and clean up.
    const ctx = this.ctx;
    for (const system of [
      snapshotSystem,
      spatialIndexSystem(ctx),
      reinforcementSystem(ctx),
      aiSystem(ctx),
      movementSystem(this.field),
      separationSystem(ctx),
      groundFollowSystem(this.field),
      weaponSystem(ctx),
      projectileSystem(ctx),
      deathSystem(ctx),
      wreckSystem(),
    ]) {
      this.world.addSystem(system);
    }

    // Opening armies muster partway forward so the first clash comes quickly.
    for (const site of this.field.baseSites) {
      spawnWave(this.world, ctx, site.faction, 3, 0);
      spawnWave(this.world, ctx, site.faction, 4, 0.4);
    }
  }

  step(dt: number): void {
    this.world.step(dt);
  }
}
