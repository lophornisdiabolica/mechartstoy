import { Entity } from '../core/ecs';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield } from '../world/battlefield';
import { NavGrid } from '../world/navGrid';
import { BuildingDef, BuildingId } from './buildings';
import { FactionOrders } from './orders';
import { BattleSettings } from './settings';
import { ProjectileKind, UnitDef, UnitId } from './units';

/** Events systems publish for other layers (effects, audio, UI) to react to. */
export type GameEvents = {
  spawned: { entity: Entity; def: UnitDef; faction: number };
  fired: { entity: Entity; x: number; y: number; z: number; heading: number; kind: ProjectileKind };
  impact: { x: number; y: number; z: number; kind: ProjectileKind; splash: number };
  unitDestroyed: { entity: Entity; x: number; y: number; z: number; def: UnitDef; faction: number };
  /** A building dropped below half health (fires once per building). */
  buildingDamaged: { entity: Entity; x: number; y: number; z: number; def: BuildingDef };
  buildingDestroyed: { entity: Entity; x: number; y: number; z: number; def: BuildingDef; faction: number };
  constructionStarted: { entity: Entity; x: number; y: number; z: number; def: BuildingDef };
  /** Conquest only: a side has lost its last production building. */
  battleOver: Outcome;
};

/** How a conquest battle ended. `winner` is null for a draw. */
export interface Outcome {
  winner: number | null;
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
  /** Which side's tide surges first: 0 west, 1 east. Pass `faction ^ tideOrder` to the tide functions. */
  tideOrder: number;
  /** Set once a conquest battle is decided. */
  outcome: Outcome | null;
}
