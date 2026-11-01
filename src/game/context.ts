import { Entity } from '../core/ecs';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield } from '../world/battlefield';
import { NavGrid } from '../world/navGrid';
import { BuildingDef, BuildingId } from './buildings';
import { Hit } from './components';
import { Lanes } from './lanes';
import { Sides } from './sides';
import { FactionOrders } from './orders';
import { BattleSettings } from './settings';
import { TideSettings } from './tide';
import { ProjectileKind, UnitDef, UnitId } from './units';

/** Events systems publish for other layers (effects, audio, UI) to react to. */
export type GameEvents = {
  spawned: { entity: Entity; def: UnitDef; faction: number };
  fired: { entity: Entity; x: number; y: number; z: number; heading: number; kind: ProjectileKind };
  impact: { x: number; y: number; z: number; kind: ProjectileKind; splash: number };
  /** `killer` is whoever landed the last blow, if anyone did. */
  unitDestroyed: { entity: Entity; x: number; y: number; z: number; def: UnitDef; faction: number; killer: Hit | null };
  /** A building dropped below half health (fires once per building). */
  buildingDamaged: { entity: Entity; x: number; y: number; z: number; def: BuildingDef };
  buildingDestroyed: { entity: Entity; x: number; y: number; z: number; def: BuildingDef; faction: number; killer: Hit | null };
  constructionStarted: { entity: Entity; x: number; y: number; z: number; def: BuildingDef };
  /** Conquest only: a side has lost its last production building. */
  sideEliminated: { faction: number; time: number };
  /** Conquest only: one team is left standing (or nobody is). */
  battleOver: Outcome;
};

/** How a conquest battle ended. */
export interface Outcome {
  /** The winning team, or null if the last sides fell together. */
  team: number | null;
  /** The sides on the winning team (including any knocked out along the way). Empty for a draw. */
  winners: number[];
  /** Sim time when it was decided. */
  time: number;
}

/** Shared services handed to every system. */
export interface SimContext {
  field: Battlefield;
  events: EventBus<GameEvents>;
  /** Targetable entities indexed by position, rebuilt at the start of every tick. */
  grid: SpatialGrid;
  rng: Rng;
  /** Route planning grid; buildings are kept marked on it as obstacles. */
  nav: NavGrid;
  /** Player-set orders per faction. */
  orders: FactionOrders[];
  /** The battle's settings. Systems read tuning from here every tick, so live changes take effect. */
  settings: BattleSettings;
  /** Unit and building definitions with the settings' multipliers applied. */
  units: Record<UnitId, UnitDef>;
  buildings: Record<BuildingId, BuildingDef>;
  /** The settings' tide stretched for this map's size (see tide.tideForMap). Read the tide from here, not from settings. */
  tide: TideSettings;
  /** Who fights whom, which enemy each team attacks, and each side's tide phase. */
  sides: Sides;
  /** Attack routes across the map. */
  lanes: Lanes;
  /** Counter for squad ids (see spawn.newSquad). */
  squads: number;
  /** How far the battle has escalated, per effect (see tide.escalate); 0 at the start. */
  escalation: { tide: number; siege: number };
  /** Set once a conquest battle is decided. */
  outcome: Outcome | null;
}
