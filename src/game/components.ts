import { defineComponent, Entity } from '../core/ecs';
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

/** Which side an entity fights for (index into FACTIONS). */
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

/** Simple movement toward a target point. AI systems set the target. */
export interface Mover {
  speed: number;
  /** Max turn rate, radians per second. */
  turnRate: number;
  targetX: number | null;
  targetZ: number | null;
  /** Hover units may cross water; everything else steers around it. */
  canCrossWater: boolean;
}
export const Mover = defineComponent<Mover>('Mover');

/** Marks a combat unit and links it to its definition. */
export interface Unit {
  def: UnitDef;
}
export const Unit = defineComponent<Unit>('Unit');

export interface Health {
  hp: number;
  max: number;
}
export const Health = defineComponent<Health>('Health');

/** Physical footprint for separation and hit tests. */
export interface Collider {
  radius: number;
}
export const Collider = defineComponent<Collider>('Collider');

export interface Armed {
  weapon: WeaponDef;
  target: Entity | null;
  /** World-space heading the weapon/turret currently points. */
  aim: number;
  /** Seconds until the next trigger pull. */
  cooldown: number;
  /** Shots left in the current burst and time until the next one. */
  burstLeft: number;
  burstTimer: number;
}
export const Armed = defineComponent<Armed>('Armed');

/** Battlefield AI: chase targets in sight, otherwise push toward the objective. */
export interface Ai {
  objectiveX: number;
  objectiveZ: number;
  /** Staggered so not every unit re-thinks on the same tick. */
  nextThinkAt: number;
}
export const Ai = defineComponent<Ai>('Ai');

/**
 * A shot in flight. It travels from start to end over `duration`; the path is
 * fixed at launch (with spread already applied) so flight is deterministic.
 */
export interface Projectile {
  kind: ProjectileKind;
  weapon: WeaponDef;
  faction: number;
  /** The unit aimed at, which takes the hit if still near the impact point. */
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

/** A destroyed unit's hulk, left on the field for a while before sinking away. */
export interface Wreck {
  removeAt: number;
}
export const Wreck = defineComponent<Wreck>('Wreck');
