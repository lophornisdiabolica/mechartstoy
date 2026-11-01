import { EventBus } from '../core/events';
import { World } from '../core/ecs';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield, generateBattlefield } from '../world/battlefield';
import { NavGrid } from '../world/navGrid';
import { Prop, scatterProps } from '../world/props';
import { layoutBase, layoutTown } from '../world/settlements';
import { GameEvents, Outcome, SimContext } from './context';
import { Lanes } from './lanes';
import { defaultOrders, Stance } from './orders';
import { BattleSettings, battlefieldConfig, defaultSettings, tunedBuildings, tunedUnits } from './settings';
import { spawnBuilding, spawnUnit } from './spawn';
import { aiSystem } from './systems/ai';
import { conquestSystem } from './systems/conquest';
import { constructionSystem } from './systems/construction';
import { deathSystem, wreckSystem } from './systems/death';
import { groundFollowSystem, movementSystem, navObstacleSystem, separationSystem } from './systems/movement';
import { countUnits, productionSystem } from './systems/production';
import { projectileSystem } from './systems/projectiles';
import { reinforcementSystem, spawnWave } from './systems/reinforcements';
import { snapshotSystem } from './systems/snapshot';
import { spatialIndexSystem } from './systems/spatialIndex';
import { targetingSystem } from './systems/targeting';
import { weaponSystem } from './systems/weapons';
import { UnitId } from './units';

export type { GameEvents, Outcome } from './context';

export const SIM_HZ = 30;

export interface GameOptions {
  /** Place bases, the town and opening armies. Tests turn this off for controlled scenarios. */
  populate: boolean;
  /** Run production and fallback reinforcements. */
  autoSpawn: boolean;
  /** Map, army and unit tuning. The seed field is ignored here; pass the hashed seed separately. */
  settings: BattleSettings;
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
  readonly settings: BattleSettings;

  constructor(
    readonly seed: number,
    options: Partial<GameOptions> = {},
  ) {
    const { populate = true, autoSpawn = true, settings = defaultSettings() } = options;
    this.settings = settings;
    const root = new Rng(seed);
    this.field = generateBattlefield(root.fork(1), battlefieldConfig(settings));
    this.props = scatterProps(this.field, root.fork(2));
    const nav = new NavGrid(this.field);
    this.ctx = {
      field: this.field,
      events: this.events,
      grid: new SpatialGrid(6),
      rng: root.fork(3),
      nav,
      orders: defaultOrders(),
      settings,
      units: tunedUnits(settings),
      buildings: tunedBuildings(settings),
      // Whoever surges first has an edge, so it's a coin flip (on its own stream, so nothing else shifts).
      tideOrder: root.fork(6).chance(0.5) ? 1 : 0,
      lanes: new Lanes(this.field, nav, seed),
      squads: 0,
      outcome: null,
    };

    // Order matters: snapshot first, then index, decide, move, fight, and clean up.
    const ctx = this.ctx;
    const navObstacles = navObstacleSystem(ctx);
    const systems = [
      snapshotSystem,
      spatialIndexSystem(ctx),
      navObstacles,
      ...(autoSpawn ? [productionSystem(ctx), reinforcementSystem(ctx)] : []),
      targetingSystem(ctx),
      aiSystem(ctx),
      movementSystem(ctx),
      separationSystem(ctx),
      groundFollowSystem(this.field),
      weaponSystem(ctx),
      projectileSystem(ctx),
      deathSystem(ctx),
      wreckSystem(),
      constructionSystem(ctx),
      conquestSystem(ctx),
    ];
    for (const system of systems) this.world.addSystem(system);

    if (populate) {
      this.populate(root.fork(5));
      // Mark the new buildings on the nav grid now, so the opening armies form up around them.
      navObstacles.update(this.world, 0);
      this.spawnOpeningArmies();
    }
  }

  step(dt: number): void {
    this.world.step(dt);
  }

  /** Conquest result, once decided. Always null in Eternal mode. */
  get outcome(): Outcome | null {
    return this.ctx.outcome;
  }

  // Player commands. The UI calls these; they're the only way it changes the sim.

  /** Drop a unit at a point. Returns false if the spot is unusable or the side is at its cap. */
  spawnUnitAt(unit: UnitId, faction: number, x: number, z: number): boolean {
    if (!this.field.contains(x, z, 1) || this.field.isWater(x, z)) return false;
    if (countUnits(this.world)[faction] >= this.settings.armies.unitCap) return false;
    spawnUnit(this.world, this.ctx, this.ctx.units[unit], faction, x, z);
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
      spawnBuilding(this.world, this.ctx, this.ctx.buildings[p.building], p.faction, p.x, p.z, p.heading);
    }
    // Opening armies muster partway forward so the first clash comes quickly.
  }

  private spawnOpeningArmies(): void {
    const picks = this.settings.armies.startingArmy;
    if (picks > 0) for (const site of this.field.baseSites) spawnWave(this.world, this.ctx, site.faction, picks, 0.4);
  }
}
