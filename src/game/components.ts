import { defineComponent } from '../core/ecs';

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

/** Simple movement toward a target point. Future AI systems set the target. */
export interface Mover {
  speed: number;
  /** Max turn rate, radians per second. */
  turnRate: number;
  targetX: number | null;
  targetZ: number | null;
}
export const Mover = defineComponent<Mover>('Mover');

/** Placeholder behaviour for step 1: pick random destinations forever. */
export interface Wander {
  nextPickAt: number;
}
export const Wander = defineComponent<Wander>('Wander');
