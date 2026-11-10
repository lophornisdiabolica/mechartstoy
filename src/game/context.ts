import { Entity } from '../core/ecs';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { Battlefield } from '../world/battlefield';
import { NavGrid, NavGrids } from '../world/navGrid';
import { BuildingDef, BuildingId } from './buildings';
import { Building, Collider, Faction, Hit, Mover, Transform } from './components';
import type { Commander } from './commander/commander';
import type { Divine, Power } from './god';
import type { FireField } from './fire';
import type { Towns } from './towns';
import { Lanes } from './lanes';
import { Offensive } from './offensive';
import { Outpost } from './outposts';
import { Sides } from './sides';
import { SquadRoster } from './territory';
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
  /**
   * Something took damage: `amount` is what actually came off its health
   * (after armour, and no more than it had left). `victim` is its unit or
   * building type and `category` its unit category, or 'building'. For balance
   * stats; nothing in the sim listens.
   */
  damaged: { victim: string; category: string; faction: number; amount: number; by: Hit | null };
  /** A building dropped below half health (fires once per building). */
  buildingDamaged: { entity: Entity; x: number; y: number; z: number; def: BuildingDef };
  buildingDestroyed: { entity: Entity; x: number; y: number; z: number; def: BuildingDef; faction: number; killer: Hit | null };
  constructionStarted: { entity: Entity; x: number; y: number; z: number; def: BuildingDef };
  /** A side took an outpost (from its garrison or another side); `faction` is GARRISON when a knocked-out side's outpost reverts. */
  outpostCaptured: { outpost: number; faction: number; previous: number; x: number; z: number };
  /** A carrier dropped off its squad. */
  squadDropped: { carrier: Entity; x: number; y: number; z: number; count: number };
  /** Conquest only: a side has lost its last production building. */
  sideEliminated: { faction: number; time: number };
  /** Conquest only: one team is left standing (or nobody is). */
  battleOver: Outcome;
  /**
   * A god power did something worth showing beyond what its shells and map
   * changes show: a quake's heave (`strength` is how hard), the big bomb, a
   * blessing or curse on a side, a bridge, a forest springing up.
   */
  /**
   * The player used a god power (see god.ts) or dropped units, for the
   * battle ticker: the power, where (its middle) and, for drops, blessings
   * and curses, the side and what.
   */
  godUsed: { power: Power | { kind: 'drop'; unit: UnitId; count: number; faction: number }; x: number; z: number };
  power: { kind: 'quake' | 'bigBomb' | 'bless' | 'curse' | 'bridge' | 'grow'; x: number; z: number; radius: number; faction: number; strength?: number };
  /** Engineers finished digging (or heaping up) a stretch of canal, trench or berm (see commander/engineers.ts). */
  earthwork: { kind: 'canal' | 'trench' | 'berm' | 'fill'; faction: number; x: number; z: number };
  /** An engineer repairing a vehicle: sparks where it's working (see commander/engineers.ts). */
  repair: { faction: number; x: number; y: number; z: number };
  /** A side's Commander sent squads to hunt a long-range gun shelling it, or they killed it (`done`; see commander/hunts.ts). */
  hunt: { faction: number; x: number; z: number; unit: string; done: boolean };
  /** Engineers threw a temporary bridge across water, or it came down (`down`; see commander/engineers.ts). */
  span: { faction: number; x: number; z: number; down: boolean };
  /** A town's people took up arms against a side that razed too much of it (see towns.ts). */
  militia: { town: number; faction: number; x: number; z: number };
  /** A super unit blew a crater in the ground (see craters.ts). */
  crater: { x: number; z: number; radius: number };
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

/**
 * A targetable entity's components that neighbour queries keep reading,
 * looked up once when it's first indexed (none of them is added or removed
 * after spawning). Handed to SpatialGrid.forEachNear's `visit`.
 */
export interface Body {
  t: Transform;
  collider: Collider | undefined;
  faction: Faction | undefined;
  mover: Mover | undefined;
  building: Building | undefined;
}

/** Shared services handed to every system. */
export interface SimContext {
  field: Battlefield;
  events: EventBus<GameEvents>;
  /** Targetable entities indexed by position, rebuilt at the start of every tick. */
  grid: SpatialGrid<Body>;
  rng: Rng;
  /** The land route planning grid (tracked vehicles); buildings are kept marked on it as obstacles. Same as navs.land. */
  nav: NavGrid;
  /** Route planning grids per movement class, sharing the same obstacles. A unit plans on navs.for(mover.move). */
  navs: NavGrids;
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
  /** When each team attacks (see offensive.ts). */
  offensive: Offensive;
  /** Each side's picture of the battle and its goals (see commander/commander.ts). */
  commander: Commander;
  /** Attack routes across the map. */
  lanes: Lanes;
  /** Capturable outposts, one per Battlefield.outpostSites entry. */
  outposts: Outpost[];
  /** Counter for squad ids (see spawn.newSquad). */
  squads: number;
  /** Infantry squads' line-ups by squad id, for refilling them (see territory.ts). */
  rosters: Map<number, SquadRoster>;
  /** How far the battle has escalated, per effect (see tide.escalate); 0 at the start. */
  escalation: { tide: number; siege: number };
  /** Set once a conquest battle is decided. */
  outcome: Outcome | null;
  /** God powers in play: bomb runs, quakes and blessings (see god.ts). */
  god: Divine;
  /** Burning and scorched ground (see fire.ts). */
  fire: FireField;
  /** The towns' people (see towns.ts). */
  towns: Towns;
}
