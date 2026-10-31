import { EventBus } from '../core/events';
import { World } from '../core/ecs';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield, generateBattlefield } from '../world/battlefield';
import { Prop, scatterProps } from '../world/props';
import { layoutBase, layoutTown } from '../world/settlements';
import { BUILDING_DEFS } from './buildings';
import { Faction, Unit } from './components';
import { GameEvents, SimContext } from './context';
import { defaultOrders, Stance } from './orders';
import { spawnBuilding, spawnUnit } from './spawn';
import { aiSystem } from './systems/ai';
import { constructionSystem } from './systems/construction';
import { deathSystem, wreckSystem } from './systems/death';
import { groundFollowSystem, movementSystem, separationSystem } from './systems/movement';
import { DEFAULT_PRODUCTION, productionSystem } from './systems/production';
import { projectileSystem } from './systems/projectiles';
import { reinforcementSystem, spawnWave } from './systems/reinforcements';
import { snapshotSystem } from './systems/snapshot';
import { spatialIndexSystem } from './systems/spatialIndex';
import { targetingSystem } from './systems/targeting';
import { weaponSystem } from './systems/weapons';
import { UNIT_DEFS, UnitId } from './units';

export type { GameEvents } from './context';

export const SIM_HZ = 30;

export interface GameOptions {
  /** Place bases, the town and opening armies. Tests turn this off for controlled scenarios. */
  populate: boolean;
  /** Run production and fallback reinforcements. */
  autoSpawn: boolean;
}

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

  constructor(
    readonly seed: number,
    options: Partial<GameOptions> = {},
  ) {
    const { populate = true, autoSpawn = true } = options;
    const root = new Rng(seed);
    this.field = generateBattlefield(root.fork(1));
    this.props = scatterProps(this.field, root.fork(2));
    this.ctx = { field: this.field, events: this.events, grid: new SpatialGrid(6), rng: root.fork(3), orders: defaultOrders() };

    // Order matters: snapshot first, then index, decide, move, fight, and clean up.
    const ctx = this.ctx;
    const systems = [
      snapshotSystem,
      spatialIndexSystem(ctx),
      ...(autoSpawn ? [productionSystem(ctx), reinforcementSystem(ctx)] : []),
      targetingSystem(ctx),
      aiSystem(ctx),
      movementSystem(this.field),
      separationSystem(ctx),
      groundFollowSystem(this.field),
      weaponSystem(ctx),
      projectileSystem(ctx),
      deathSystem(ctx),
      wreckSystem(),
      constructionSystem(ctx),
    ];
    for (const system of systems) this.world.addSystem(system);

    if (populate) this.populate(root.fork(5));
  }

  step(dt: number): void {
    this.world.step(dt);
  }

  // Player commands. The UI calls these; they're the only way it changes the sim.

  /** Drop a unit at a point. Returns false if the spot is unusable or the side is at its cap. */
  spawnUnitAt(unit: UnitId, faction: number, x: number, z: number): boolean {
    if (!this.field.contains(x, z, 1) || this.field.isWater(x, z)) return false;
    let alive = 0;
    for (const e of this.world.query(Unit, Faction)) if (this.world.req(e, Faction).id === faction) alive++;
    if (alive >= DEFAULT_PRODUCTION.maxUnitsPerFaction) return false;
    spawnUnit(this.world, this.ctx, UNIT_DEFS[unit], faction, x, z);
    return true;
  }

  /** Move a faction's rally point; null restores the default. */
  setRally(faction: number, point: { x: number; z: number } | null): void {
    this.ctx.orders[faction].rally = point && { x: this.field.clampX(point.x, 2), z: this.field.clampZ(point.z, 2) };
  }

  setStance(faction: number, stance: Stance): void {
    this.ctx.orders[faction].stance = stance;
  }

  private populate(rng: Rng): void {
    const placements = [
      ...this.field.baseSites.flatMap((site) => layoutBase(this.field, site, rng)),
      ...this.field.townSites.flatMap((site) => layoutTown(this.field, site, rng)),
    ];
    for (const p of placements) {
      spawnBuilding(this.world, this.ctx, BUILDING_DEFS[p.building], p.faction, p.x, p.z, p.heading);
    }
    // Opening armies muster partway forward so the first clash comes quickly.
    for (const site of this.field.baseSites) {
      spawnWave(this.world, this.ctx, site.faction, 4, 0.4);
    }
  }
}
