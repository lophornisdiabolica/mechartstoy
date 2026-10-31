import * as THREE from 'three';
import { FACTIONS } from '../game/factions';

/**
 * Model registry: maps a Renderable.model key to a factory that builds a
 * Three.js object for a given faction. New unit and building types register a
 * factory here, so the entity view never needs to know about specific models.
 *
 * Models face +x at rotation 0, matching Transform.heading.
 */
export type ModelFactory = (faction: number) => THREE.Object3D;

/** Per-frame state handed to a model's animate hook. */
export interface AnimState {
  /** Frame time in seconds, already scaled by sim speed (0 when paused). */
  dt: number;
  /** Ground speed this frame, world units per second. */
  speed: number;
}

/**
 * Optional moving parts a model exposes, stored on `object.userData.rig`.
 * The entity view drives them; models never read game state.
 */
export interface ModelRig {
  /** Rotated around y to point the weapon (relative to the hull). */
  turret?: THREE.Object3D;
  /** Orient the whole model along its velocity (projectiles). Build these facing +z. */
  faceVelocity?: boolean;
  animate?(state: AnimState): void;
}

export function setRig(obj: THREE.Object3D, rig: ModelRig): THREE.Object3D {
  obj.userData.rig = rig;
  return obj;
}

export function getRig(obj: THREE.Object3D): ModelRig | undefined {
  return obj.userData.rig as ModelRig | undefined;
}

const factories = new Map<string, ModelFactory>();
const materialCache = new Map<string, THREE.Material>();

export function registerModel(key: string, factory: ModelFactory): void {
  factories.set(key, factory);
}

export function createModel(key: string, faction: number): THREE.Object3D {
  const factory = factories.get(key);
  if (!factory) throw new Error(`No model registered for "${key}"`);
  const obj = factory(faction);
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o.userData.noShadow ?? false)) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return obj;
}

/** Unlit material for glowing things (tracers, muzzle flashes). */
export function glowMaterial(color: number): THREE.Material {
  const key = `glow-${color.toString(16)}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color });
    materialCache.set(key, m);
  }
  return m;
}

/** Shared flat-shaded material per colour, so many units share GPU state. */
export function flatMaterial(color: number): THREE.Material {
  const key = color.toString(16);
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.7, metalness: 0.15 });
    materialCache.set(key, m);
  }
  return m;
}

/** Civilian palette for the neutral town. */
const NEUTRAL_COLORS = { primary: 0xb5654a, secondary: 0x6d7b86 };

export function factionColors(faction: number): { primary: number; secondary: number } {
  const def = FACTIONS[faction];
  return def ? { primary: def.primary, secondary: def.secondary } : NEUTRAL_COLORS;
}

/** Box mesh helper: size, position, colour. Most low-poly parts are just boxes. */
export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(boxGeometry(w, h, d), flatMaterial(color));
  m.position.set(x, y, z);
  return m;
}

/** Triangular-prism gable roof spanning `length` along x, `width` along z. */
export function gableRoof(length: number, width: number, height: number, color: number, y: number): THREE.Mesh {
  const key = `roof|${length}|${width}|${height}`;
  let g = geometryCache.get(key);
  if (!g) {
    // A 3-sided cylinder lying along x is a prism; scale it to the footprint.
    g = new THREE.CylinderGeometry(1, 1, length, 3, 1);
    g.rotateZ(Math.PI / 2);
    g.rotateX(-Math.PI / 2);
    g.scale(1, height / 1.5, width / Math.sqrt(3));
    g.translate(0, height / 3, 0);
    geometryCache.set(key, g);
  }
  const m = new THREE.Mesh(g, flatMaterial(color));
  m.position.y = y;
  return m;
}

export function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const key = `cyl|${radiusTop}|${radiusBottom}|${height}|${segments}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments);
    geometryCache.set(key, g);
  }
  const m = new THREE.Mesh(g, flatMaterial(color));
  m.position.set(x, y, z);
  return m;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();

function boxGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}`;
  let g = geometryCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geometryCache.set(key, g);
  }
  return g;
}
