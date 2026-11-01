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
import { defenceSystem, Sides } from './sides';
import { defaultOrders, Stance } from './orders';
import { buildOutpost, createOutposts, garrisonSystem, outpostSystem } from './outposts';
import { BattleSettings, battlefieldConfig, defaultSettings, tunedBuildings, tunedUnits } from './settings';
import { BattleStats } from './stats';
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
import { escalationSystem, tideForMap } from './tide';
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
  /** Running score for the end-of-battle summary. */
  readonly stats: BattleStats;

  constructor(
    readonly seed: number,
    options: Partial<GameOptions> = {},
  ) {
    const { populate = true, autoSpawn = true, settings = defaultSettings() } = options;
    this.settings = settings;
    // Subscribe before anything spawns, so the opening armies count.
    this.stats = new BattleStats(this.events, settings.factions.length);
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
      orders: defaultOrders(settings.factions.length),
      settings,
      units: tunedUnits(settings),
      buildings: tunedBuildings(settings),
      tide: tideForMap(settings.armies, this.field.config.cols),
      lanes: new Lanes(this.field, nav, seed),
      outposts: createOutposts(this.field.outpostSites, seed),
      // Whoever surges first has an edge, so the order of the teams' tides is rolled per map (on its own stream, so nothing else shifts).
      sides: new Sides(
        settings.factions.map((f) => f.team),
        this.field,
        seed,
        Math.floor(root.fork(6).next() * new Set(settings.factions.map((f) => f.team)).size),
        settings.armies.evenTeams,
      ),
      squads: 0,
      escalation: { tide: 0, siege: 0 },
      outcome: null,
    };

    // Order matters: snapshot first, then index, decide, move, fight, and clean up.
    const ctx = this.ctx;
    const navObstacles = navObstacleSystem(ctx);
    const systems = [
      snapshotSystem,
      escalationSystem(ctx),
      spatialIndexSystem(ctx),
      defenceSystem(ctx),
      navObstacles,
      ...(autoSpawn ? [productionSystem(ctx), reinforcementSystem(ctx), garrisonSystem(ctx)] : []),
      targetingSystem(ctx),
      aiSystem(ctx),
      movementSystem(ctx),
      separationSystem(ctx),
      groundFollowSystem(this.field),
      weaponSystem(ctx),
      projectileSystem(ctx),
      deathSystem(ctx),
      wreckSystem(),
      outpostSystem(ctx),
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
    if (countUnits(this.world, this.ctx.sides.count)[faction] >= this.ctx.sides.unitCap(faction, this.settings.armies.unitCap)) return false;
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
    // Outposts on their own stream, so adding them doesn't reshuffle the bases and town.
    const outpostRng = new Rng(this.seed ^ 0x6f7574);
    for (const outpost of this.ctx.outposts) buildOutpost(this.world, this.ctx, outpost, outpostRng);
  }

  /** Opening armies form up where they'll mass for the first attack, so the first clash comes quickly. */
  private spawnOpeningArmies(): void {
    const picks = this.settings.armies.startingArmy;
    if (picks <= 0) return;
    for (const site of this.field.baseSites) spawnWave(this.world, this.ctx, site.faction, Math.round(picks * this.ctx.sides.strength[site.faction]), 1);
  }
}
