import { EventBus } from '../core/events';
import { World } from '../core/ecs';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield, generateBattlefield } from '../world/battlefield';
import { NavGrids } from '../world/navGrid';
import { Prop, scatterProps } from '../world/props';
import { layoutBase, layoutTown } from '../world/settlements';
import { GameEvents, Outcome, SimContext } from './context';
import { Lanes } from './lanes';
import { defenceSystem, Sides } from './sides';
import { defaultOrders, Stance } from './orders';
import { Offensive, offensiveSystem } from './offensive';
import { scrapSystem } from './scrap';
import { buildOutpost, createOutposts, garrisonSystem, outpostSystem } from './outposts';
import { BattleSettings, battlefieldConfig, defaultSettings, tunedBuildings, tunedUnits } from './settings';
import { BattleStats } from './stats';
import { newSquad, spawnBuilding, spawnUnit } from './spawn';
import * as D from '../core/dmath';
import { aiSystem } from './systems/ai';
import { conquestSystem } from './systems/conquest';
import { constructionSystem } from './systems/construction';
import { deathSystem, wreckSystem } from './systems/death';
import { groundFollowSystem, movementSystem, navObstacleSystem, separationSystem } from './systems/movement';
import { productionSystem } from './systems/production';
import { territorySystem } from './territory';
import { carrierSystem } from './systems/carriers';
import { doctrineOf } from './doctrines';
import { projectileSystem } from './systems/projectiles';
import { reinforcementSystem, spawnWave } from './systems/reinforcements';
import { snapshotSystem } from './systems/snapshot';
import { spatialIndexSystem } from './systems/spatialIndex';
import { targetingSystem } from './systems/targeting';
import { weaponSystem } from './systems/weapons';
import { escalationSystem, tideForMap } from './tide';
import { UnitId } from './units';
import { Commander, commanderSystem } from './commander/commander';
import { engineerSystem } from './commander/engineers';
import { Divine, godSystem, Power, powerSpot } from './god';

export type { GameEvents, Outcome } from './context';

export const SIM_HZ = 30;

/** Most units one drop puts down. */
export const MAX_DROP = 50;

/** Something the player does to a battle (see Game.command). */
export type Command =
  /** Drop `count` (default 1) of a unit round a point, whatever the side's caps. */
  | { type: 'spawn'; unit: UnitId; faction: number; x: number; z: number; count?: number }
  | { type: 'power'; power: Power }
  | { type: 'rally'; faction: number; point: { x: number; z: number } | null }
  | { type: 'stance'; faction: number; stance: Stance };

export interface GameOptions {
  /** Place bases, the town and opening armies. Tests turn this off for controlled scenarios. */
  populate: boolean;
  /** Run production and fallback reinforcements. */
  autoSpawn: boolean;
  /** Map, army and unit tuning. The seed field is ignored here; pass the hashed seed separately. */
  settings: BattleSettings;
  /**
   * A copy to show a battle played elsewhere (in the sim worker, see
   * sim/mirror.ts): the same map and opening, but no systems, so stepping
   * it does nothing and its state comes from the real one.
   */
  view: boolean;
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
    const { populate = true, autoSpawn = true, settings = defaultSettings(), view = false } = options;
    this.settings = settings;
    // Subscribe before anything spawns, so the opening armies count.
    this.stats = new BattleStats(this.events, settings.factions.length);
    const root = new Rng(seed);
    this.field = generateBattlefield(root.fork(1), battlefieldConfig(settings));
    this.props = scatterProps(this.field, root.fork(2));
    const navs = new NavGrids(this.field);
    const nav = navs.land;
    const tide = tideForMap(settings.armies, this.field.config.cols);
    // Whoever surges first has an edge, so the order of the teams' tides is rolled per map (on its own stream, so nothing else shifts).
    const sides = new Sides(
      settings.factions.map((f) => f.team),
      this.field,
      seed,
      Math.floor(root.fork(6).next() * new Set(settings.factions.map((f) => f.team)).size),
      settings.armies.evenTeams,
    );
    this.ctx = {
      field: this.field,
      events: this.events,
      grid: new SpatialGrid(6),
      rng: root.fork(3),
      nav,
      navs,
      orders: defaultOrders(settings.factions.length),
      settings,
      units: tunedUnits(settings),
      buildings: tunedBuildings(settings),
      tide,
      lanes: new Lanes(this.field, nav, seed),
      outposts: createOutposts(this.field.outpostSites),
      sides,
      offensive: new Offensive(sides, tide, () => settings.armies.attackTiming, this.field.config.cols),
      squads: 0,
      rosters: new Map(),
      escalation: { tide: 0, siege: 0 },
      outcome: null,
      commander: new Commander({ field: this.field, navs }, settings.factions.length),
      god: new Divine(),
    };

    // Order matters: snapshot first, then index, decide, move, fight, and clean up.
    const ctx = this.ctx;
    const navObstacles = navObstacleSystem(ctx);
    // A view builds none: some systems (scrap) listen to events, which a view only replays.
    const systems = view
      ? []
      : [
      snapshotSystem,
      escalationSystem(ctx),
      spatialIndexSystem(ctx),
      defenceSystem(ctx),
      offensiveSystem(ctx),
      navObstacles,
      ...(autoSpawn ? [productionSystem(ctx), engineerSystem(ctx), reinforcementSystem(ctx), garrisonSystem(ctx), territorySystem(ctx), carrierSystem(ctx)] : []),
      targetingSystem(ctx),
      aiSystem(ctx),
      movementSystem(ctx),
      separationSystem(ctx),
      groundFollowSystem(this.field),
      weaponSystem(ctx),
      // Before projectiles, so a bomb let go this tick starts falling at once (and does nothing unless a power was used).
      godSystem(ctx),
      projectileSystem(ctx),
      deathSystem(ctx),
      wreckSystem(),
      scrapSystem(ctx),
      outpostSystem(ctx),
      constructionSystem(ctx),
      conquestSystem(ctx),
      // Last: it only reads the battle (see commander/commander.ts).
      commanderSystem(ctx),
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

  /**
   * Where a view sends its commands (to the worker playing the real battle,
   * see sim/mirror.ts) instead of applying them itself. Null applies them here.
   */
  forward: ((command: Command) => void) | null = null;

  /** Drop `count` of a unit round a point (caps don't apply). Returns false if there's nowhere there it can stand. */
  spawnUnitAt(unit: UnitId, faction: number, x: number, z: number, count = 1): boolean {
    return this.command({ type: 'spawn', unit, faction, x, z, count });
  }

  /** Use a god power (see god.ts). Returns false if it can't be used there. */
  usePower(power: Power): boolean {
    return this.command({ type: 'power', power });
  }

  /** Move a faction's rally point; null restores the default. */
  setRally(faction: number, point: { x: number; z: number } | null): void {
    this.command({ type: 'rally', faction, point });
  }

  setStance(faction: number, stance: Stance): void {
    this.command({ type: 'stance', faction, stance });
  }

  /** Apply a player command (or forward it, see `forward`). For a drop, whether it worked. */
  command(c: Command): boolean {
    if (!this.forward) return this.apply(c);
    // A drop that can't work here can't work in the real battle either, so say so now.
    if (c.type === 'spawn' && this.dropSpots(c.unit, c.x, c.z, c.count ?? 1).length === 0) return false;
    if (c.type === 'power' && !Divine.possible(this.ctx, c.power)) return false;
    this.forward(c);
    return true;
  }

  private apply(c: Command): boolean {
    switch (c.type) {
      case 'spawn': {
        const spots = this.dropSpots(c.unit, c.x, c.z, c.count ?? 1);
        if (spots.length === 0 || c.faction < 0 || c.faction >= this.ctx.sides.count) return false;
        // Dropped together, they move together.
        const squad = newSquad(this.ctx);
        for (const p of spots) spawnUnit(this.world, this.ctx, this.ctx.units[c.unit], c.faction, p.x, p.z, squad);
        this.events.emit('godUsed', { power: { kind: 'drop', unit: c.unit, count: spots.length, faction: c.faction }, x: c.x, z: c.z });
        return true;
      }
      case 'power': {
        if (!this.ctx.god.use(this.world, this.ctx, c.power)) return false;
        this.events.emit('godUsed', { power: c.power, ...powerSpot(this.ctx, c.power) });
        return true;
      }
      case 'rally':
        this.ctx.orders[c.faction].rally = c.point && { x: this.field.clampX(c.point.x, 2), z: this.field.clampZ(c.point.z, 2) };
        return true;
      case 'stance':
        this.ctx.orders[c.faction].stance = c.stance;
        return true;
    }
  }

  /**
   * Where `count` of a unit dropped round a point go: the point, then rings
   * round it, each spot somewhere the unit can be (boats only on water, land
   * units only where they can go, hovers on either). Empty if none is.
   * Caps don't apply: dropping a dozen Titans is the player's call.
   */
  dropSpots(unit: UnitId, x: number, z: number, count: number): { x: number; z: number }[] {
    const def = this.ctx.units[unit];
    const nav = this.ctx.navs.for(def.move);
    const ok = (px: number, pz: number) => this.field.contains(px, pz, 1) && nav.terrainAllowsAt(px, pz);
    const out: { x: number; z: number }[] = [];
    const want = Math.max(1, Math.min(MAX_DROP, Math.floor(count)));
    // The point itself has to suit the unit (no tanks dropped by clicking the sea).
    if (!ok(x, z)) return out;
    out.push({ x, z });
    // Infantry stand close; big units need room.
    const gap = Math.max(1.2, def.radius * 2.3);
    for (let ring = 1; out.length < want && ring <= 8; ring++) {
      const r = ring * gap;
      const n = Math.max(6, Math.floor((2 * Math.PI * r) / gap));
      for (let k = 0; k < n && out.length < want; k++) {
        const a = (k / n) * Math.PI * 2 + ring * 0.5;
        const px = x + D.cos(a) * r;
        const pz = z + D.sin(a) * r;
        if (ok(px, pz)) out.push({ x: px, z: pz });
      }
    }
    return out;
  }

  private populate(rng: Rng): void {
    const placements = [
      ...this.field.baseSites.flatMap((site) => layoutBase(this.field, site, rng, doctrineOf(this.ctx, site.faction))),
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
