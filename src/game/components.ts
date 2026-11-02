import { defineComponent, Entity } from '../core/ecs';
import { MoveClass } from '../world/moveClasses';
import { BuildingDef, ProductionEntry } from './buildings';
import { LaneId } from './lanes';
import { ProjectileKind, UnitDef, WeaponDef } from './units';

/**
 * Position and facing on the battlefield. `p*` fields hold the previous tick's
 * values so the renderer can interpolate between sim steps.
 */
export interface Transform {
  x: number;
  y: number;
  z: number;
  /** Facing angle around +y, radians. 0 faces +x. */
  heading: number;
  px: number;
  py: number;
  pz: number;
  pheading: number;
}
export const Transform = defineComponent<Transform>('Transform');

export function makeTransform(x: number, y: number, z: number, heading = 0): Transform {
  return { x, y, z, heading, px: x, py: y, pz: z, pheading: heading };
}

/** Faction id used for the civilian town, which nobody targets on purpose. */
export const NEUTRAL = -1;

/**
 * Faction id for an outpost's own defenders before anyone captures it: they
 * fight every side, and every side fights them.
 */
export const GARRISON = -2;

/** Which side an entity belongs to (index into FACTIONS, NEUTRAL or GARRISON). */
export interface Faction {
  id: number;
}
export const Faction = defineComponent<Faction>('Faction');

/** Tells the renderer which model to draw. `model` is a key in the model registry. */
export interface Renderable {
  model: string;
  scale: number;
}
export const Renderable = defineComponent<Renderable>('Renderable');

/** Keeps an entity standing on the ground (or water surface) as it moves. */
export interface GroundFollow {
  /** Height above the surface, e.g. for hover units. */
  offset: number;
}
export const GroundFollow = defineComponent<GroundFollow>('GroundFollow');

/** Movement toward a target point. AI systems set the target; the movement system finds the way. */
export interface Mover {
  speed: number;
  /** Max turn rate, radians per second. */
  turnRate: number;
  targetX: number | null;
  targetZ: number | null;
  /** Where to face while standing idle (e.g. toward the enemy), if anywhere. */
  faceX: number | null;
  faceZ: number | null;
  /** How it gets around: which nav grid it plans on, and what terrain it can cross (see moveClasses.ts). */
  move: MoveClass;
  /** Route-following and unsticking state, owned by the movement system. */
  nav: NavState;
}
export const Mover = defineComponent<Mover>('Mover');

export interface NavState {
  /** Planned waypoints toward pathGoal, or null when heading straight there. */
  path: { x: number; z: number }[] | null;
  pathIndex: number;
  pathGoalX: number;
  pathGoalZ: number;
  /** NavGrid version the path was planned against. */
  pathVersion: number;
  replanAt: number;
  /** Cached "straight line to the goal is clear" answer, and when to re-check it. */
  direct: boolean;
  directCheckAt: number;
  /** Progress check for stuck detection. */
  checkAt: number;
  checkX: number;
  checkZ: number;
  stuckFor: number;
  /** Temporary sidestep point used to wriggle free when stuck. */
  detourX: number;
  detourZ: number;
  detourUntil: number;
}

export function makeNavState(): NavState {
  return {
    path: null,
    pathIndex: 0,
    pathGoalX: 0,
    pathGoalZ: 0,
    pathVersion: -1,
    replanAt: 0,
    direct: false,
    directCheckAt: 0,
    checkAt: 0,
    checkX: 0,
    checkZ: 0,
    stuckFor: 0,
    detourX: 0,
    detourZ: 0,
    detourUntil: -1,
  };
}

/** Marks a combat unit and links it to its definition. */
export interface Unit {
  def: UnitDef;
}
export const Unit = defineComponent<Unit>('Unit');

/** Marks a structure and links it to its definition. */
export interface Building {
  def: BuildingDef;
}
export const Building = defineComponent<Building>('Building');

/** Who dealt a blow: the attacker's unit or building id and side. */
export interface Hit {
  source: string;
  faction: number;
}

export interface Health {
  hp: number;
  max: number;
  /** Fraction of incoming damage ignored, 0..1. */
  armor: number;
  /** The last thing that hurt this, which gets the credit if it dies. */
  lastHit: Hit | null;
}
export const Health = defineComponent<Health>('Health');

/** Physical footprint for separation and hit tests. */
export interface Collider {
  radius: number;
}
export const Collider = defineComponent<Collider>('Collider');

/**
 * Can be shot at. Indexed in the spatial grid each tick; removed when the
 * entity dies, which is how other systems know a target is gone.
 */
export interface Targetable {
  kind: 'unit' | 'building';
}
export const Targetable = defineComponent<Targetable>('Targetable');

export interface Armed {
  weapon: WeaponDef;
  /** How far this weapon's owner looks for targets. */
  sight: number;
  /** Aims independently of the hull (turret) rather than turning the body. */
  turret: boolean;
  turnRate: number;
  /** Distance from the entity centre to the muzzle, horizontally. */
  muzzleOffset: number;
  /** Prefer buildings over units when choosing targets (artillery). */
  siege: boolean;
  target: Entity | null;
  nextTargetAt: number;
  /** World-space heading the weapon/turret currently points. */
  aim: number;
  /** Seconds until the next trigger pull. */
  cooldown: number;
  /** Shots left in the current burst and time until the next one. */
  burstLeft: number;
  burstTimer: number;
}
export const Armed = defineComponent<Armed>('Armed');

/** Battlefield AI: chase targets in sight, otherwise attack or hold depending on the tide. */
export interface Ai {
  /** Where to push when attacking (inside the enemy base). */
  objectiveX: number;
  objectiveZ: number;
  /** This unit's spot relative to its rally point, so groups spread out. */
  rallyOffsetX: number;
  rallyOffsetZ: number;
  /** Units spawned together form a squad and take the same lane. */
  squad: number;
  /** Lane for the current attack (see lanes.ts), and which attack it was picked for. */
  lane: LaneId;
  laneAttack: number;
  /** The enemy side this unit's current attack goes after, or -1 for none. */
  target: number;
  /**
   * Artillery and support units look around for nearby threats and frontline
   * allies (see Role) twice a second, not every tick; the answers are kept here.
   */
  roleCheckAt: number;
  /** Enemy unit inside an artillery unit's minimum range. */
  threat: Entity | null;
  /** The frontline ally a support unit follows. */
  escort: Entity | null;
  /** How far the frontline ahead of an artillery unit has got (Lanes.progress), or null if there's none nearby. */
  lead: number | null;
}
export const Ai = defineComponent<Ai>('Ai');

/** Turns out units on a timer. */
export interface Producer {
  table: ProductionEntry[];
  interval: number;
  /** Seconds until the next batch. */
  timer: number;
}
export const Producer = defineComponent<Producer>('Producer');

/** A building going up. It's targetable but doesn't produce or shoot until done. */
export interface Construction {
  elapsed: number;
  duration: number;
}
export const Construction = defineComponent<Construction>('Construction');

/** What's left of a destroyed building; rebuilt after a delay. */
export interface Rubble {
  def: BuildingDef;
  faction: number;
  heading: number;
  rebuildAt: number;
}
export const Rubble = defineComponent<Rubble>('Rubble');

/**
 * A shot in flight. It travels from start to end over `duration`; the path is
 * fixed at launch (with spread already applied) so flight is deterministic.
 */
export interface Projectile {
  kind: ProjectileKind;
  weapon: WeaponDef;
  faction: number;
  /** The firing unit's or building's definition id, for kill credit. */
  source: string;
  /** The entity aimed at, which takes the hit if still near the impact point. */
  target: Entity | null;
  sx: number;
  sy: number;
  sz: number;
  ex: number;
  ey: number;
  ez: number;
  /** Peak height of a lobbed arc above the straight line. */
  arcHeight: number;
  elapsed: number;
  duration: number;
}
export const Projectile = defineComponent<Projectile>('Projectile');

/** Part of an outpost (its post, towers or bunker), or the rubble of one. */
export interface OutpostPart {
  /** Index in SimContext.outposts. */
  outpost: number;
}
export const OutpostPart = defineComponent<OutpostPart>('OutpostPart');

/** An outpost bunker that keeps a few guards at the post for whoever holds it. */
export interface Garrison {
  /** Seconds until the next guard. */
  timer: number;
}
export const Garrison = defineComponent<Garrison>('Garrison');

/** A unit that stays at an outpost and defends it instead of joining the army. */
export interface Guard {
  outpost: number;
}
export const Guard = defineComponent<Guard>('Guard');

/** A destroyed unit's hulk, left on the field for a while before sinking away. */
export interface Wreck {
  removeAt: number;
}
export const Wreck = defineComponent<Wreck>('Wreck');
