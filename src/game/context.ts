import type { TraitState } from './traits';
import type { BridgeWear } from './bridges';
import type { Tide } from './tides';
import type { Flood } from './flood';
import type { Ice } from './ice';
import { Traffic } from './traffic';
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
import type { Domes } from './shields';
import type { FrostField } from './frost';
import type { WreckageField } from './wreckage';
import type { SmokeField } from './smoke';
import type { Strikes } from './zenith';
import type { Camp } from './nomad';
import type { Groves } from './verdant';
import type { Towns } from './towns';
import { Lanes } from './lanes';
import { Offensive } from './offensive';
import { Outpost } from './outposts';
import { HillState } from './hill';
import { Sides } from './sides';
import { SquadRoster } from './territory';
import { FactionOrders } from './orders';
import { BattleSettings } from './settings';
import { TideSettings } from './tide';
import { MeleeDef, ProjectileKind, UnitDef, UnitId } from './units';

/** Events systems publish for other layers (effects, audio, UI) to react to. */
export type GameEvents = {
  spawned: { entity: Entity; def: UnitDef; faction: number };
  /** `heading` and `climb` are which way the barrel points. */
  fired: { entity: Entity; x: number; y: number; z: number; heading: number; climb: number; kind: ProjectileKind };
  impact: { x: number; y: number; z: number; kind: ProjectileKind; splash: number };
  /**
   * A melee blow landed (see systems/melee.ts): where (the target's edge),
   * the way the striker faced, how it swung, how far it lunged in for it,
   * and how many it hit (more than one for a sweep).
   */
  struck: { entity: Entity; x: number; y: number; z: number; heading: number; style: MeleeDef['style']; kind: ProjectileKind; lunge: number; hits: number };
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
  /** A shipyard outpost put a boat in the water for whoever holds it. */
  outpostLaunch: { outpost: number; faction: number; x: number; z: number };
  /** A signal fire outpost called in a relief column for whoever holds it. */
  outpostRelief: { outpost: number; faction: number; x: number; z: number };
  /** A map bridge came down under fire, for good (see bridges.ts). */
  bridgeFell: { x: number; z: number };
  /** The tide's turning over a Tidal flats bar: going out (ebbing), or about to come in (turning). See tides.ts. */
  tide: { phase: 'ebbing' | 'turning'; x: number; z: number };
  /** The dam broke (faction -1) or a side opened its sluices, and the valley's flooding (see flood.ts). */
  flood: { faction: number; x: number; z: number };
  /** The ice on a frozen lake gave way, and units went through (see ice.ts). */
  iceBroke: { x: number; z: number; drowned: number };
  /** A drawbridge outpost's holder raised (up) or lowered its bridge (see bridges.ts). */
  drawbridge: { outpost: number; faction: number; up: boolean; x: number; z: number };
  /** A rail station put an armoured train on the line for whoever holds it (see rail.ts). */
  trainLaunched: { entity: Entity; outpost: number; faction: number; x: number; z: number };
  /** A carrier dropped off its squad. */
  squadDropped: { carrier: Entity; x: number; y: number; z: number; count: number };
  /** Conquest only: a side has lost its last production building. */
  sideEliminated: { faction: number; time: number };
  /** Conquest only: one team is left standing (or nobody is). */
  battleOver: Outcome;
  /** King of the hill: the holder's team has this many seconds left to hold it (see hill.ts). */
  hillClock: { faction: number; left: number };
  /** King of the hill: the holder's team has held it long enough, and wins. */
  hillHeld: { faction: number; time: number };
  /** King of the hill: a side's team has thrown everything at the hill, with an enemy this many seconds from winning on it. */
  hillAllIn: { faction: number; left: number };
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
  earthwork: { kind: 'canal' | 'trench' | 'berm' | 'fill' | 'grade'; faction: number; x: number; z: number };
  /** An engineer repairing a vehicle: sparks where it's working (see commander/engineers.ts). */
  repair: { faction: number; x: number; y: number; z: number };
  /** A side's Commander sent squads to hunt a long-range gun shelling it, or they killed it (`done`; see commander/hunts.ts). */
  hunt: { faction: number; x: number; z: number; unit: string; done: boolean };
  /** Engineers threw a temporary bridge across water, or it came down (`down`; see commander/engineers.ts). */
  span: { faction: number; x: number; z: number; down: boolean };
  /** A town's people took up arms against a side that razed too much of it (see towns.ts). */
  militia: { town: number; faction: number; x: number; z: number };
  /** A shot burst on an energy dome (see shields.ts): where, and how much of its strength it has left. */
  shieldHit: { entity: Entity; faction: number; x: number; y: number; z: number; share: number };
  /** A shard gun's shot shattered something frozen (see frost.ts). */
  shatter: { x: number; y: number; z: number };
  /** A vehicle was hacked over to another side, or came back to its own (`back`; see hacking.ts). */
  hacked: { entity: Entity; x: number; y: number; z: number; faction: number; home: number; back: boolean };
  /** An energy dome collapsed (see shields.ts). */
  shieldDown: { entity: Entity; faction: number; x: number; y: number; z: number; radius: number; by: Hit | null };
  /** A super unit blew a crater in the ground (see craters.ts). */
  crater: { x: number; z: number; radius: number };
  /**
   * An orbital strike was called (Zenith; see zenith.ts): where it will
   * land and how wide, in how many seconds, and from where the caller's
   * targeting laser paints the spot.
   */
  strikeCalled: { x: number; y: number; z: number; radius: number; delay: number; fromX: number; fromY: number; fromZ: number; faction: number };
  /** A Nomad crawler setting up camp (`up`) or packing up (see nomad.ts). */
  camp: { x: number; y: number; z: number; up: boolean };
  /** A shot glancing off a front shield (see UnitDef.frontShield). */
  blocked: { x: number; y: number; z: number };
  /** A clockwork toy tipped over by a hit (see windup.ts). */
  toppled: { x: number; y: number; z: number };
  /** A Mirage hologram flickering up or fizzling out (see mirage.ts). */
  fizzle: { x: number; y: number; z: number; radius: number };
  /** Verdant's vines wrapping round something (see verdant.ts). */
  /** A Verdant seed pod sprouting into a thicket (see verdant.ts). */
  grove: { x: number; y: number; z: number; radius: number };
  /** A Lodestar crane dragging wrecks into a scrap wall (see lodestar.ts). */
  scrapWall: { x: number; y: number; z: number; fromX: number; fromZ: number };
  /** A Hive fabricator chewing wreckage (see hive.ts). */
  chewed: { x: number; y: number; z: number; faction: number };
  /** A Zenith drop pod hit the ground (`landed`), or crumbled once empty (see zenith.ts). */
  dropPod: { x: number; y: number; z: number; landed: boolean };
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
  /** King of the hill: who has held the hill how long (see hill.ts); null in other modes. */
  hill: HillState | null;
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
  /** Frosted ground (see frost.ts). */
  frost: FrostField;
  /** Verdant's tangle: ground grown over with vines that drag at enemies (see verdant.ts). */
  tangle: FrostField;
  /** Wreckage on the ground (see wreckage.ts). */
  wreckage: WreckageField;
  /** Drifting smoke (see smoke.ts). */
  smoke: SmokeField;
  /** Map traits' oil pools and the like (see traits.ts). */
  traits: TraitState;
  /** Orbital strikes on their way down (see zenith.ts). */
  strikes: Strikes;
  /** Nomad camps set up, for territory (see nomad.ts). */
  camps: Camp[];
  /** Verdant's thickets so far (see verdant.ts). */
  groves: Groves;
  /** Energy domes up this tick (see shields.ts). */
  domes: Domes;
  /** The towns' people (see towns.ts). */
  towns: Towns;
  /** The map's own bridges' wear, and those that have fallen (see bridges.ts). */
  bridges: BridgeWear;
  /** The tide over the Tidal flats trait's sand bars, or null without them (see tides.ts). */
  tidal: Tide | null;
  /** The Dam trait's valley and its flood, or null without one (see flood.ts). */
  flood: Flood | null;
  /** The Frozen lake trait's ice, or null without one (see ice.ts). */
  ice: Ice | null;
  /** Narrow passages (bridges) and the vehicles taking turns on them (see traffic.ts). */
  traffic: Traffic;
}
