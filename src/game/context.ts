import { Entity } from '../core/ecs';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield } from '../world/battlefield';
import { BuildingDef } from './buildings';
import { FactionOrders } from './orders';
import { ProjectileKind, UnitDef } from './units';

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
};

/** Shared services handed to every system. */
export interface SimContext {
  field: Battlefield;
  events: EventBus<GameEvents>;
  /** Targetable entities indexed by position, rebuilt at the start of every tick. */
  grid: SpatialGrid;
  rng: Rng;
  /** Player-set orders per faction. */
  orders: FactionOrders[];
}
