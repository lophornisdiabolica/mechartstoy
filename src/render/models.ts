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
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return obj;
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

export function factionColors(faction: number): { primary: number; secondary: number } {
  const def = FACTIONS[faction] ?? FACTIONS[0];
  return { primary: def.primary, secondary: def.secondary };
}

// Placeholder unit used in step 1 to prove the sim-to-render pipeline. Replaced by real mechs in step 2.
const probeBody = new THREE.BoxGeometry(1.4, 0.5, 1);
const probeTurret = new THREE.BoxGeometry(0.6, 0.35, 0.6);
const probeBarrel = new THREE.BoxGeometry(0.7, 0.12, 0.12);
const probeTrack = new THREE.BoxGeometry(1.5, 0.3, 0.25);

registerModel('probe', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  const body = new THREE.Mesh(probeBody, flatMaterial(primary));
  body.position.y = 0.45;
  const turret = new THREE.Mesh(probeTurret, flatMaterial(secondary));
  turret.position.set(-0.1, 0.87, 0);
  const barrel = new THREE.Mesh(probeBarrel, flatMaterial(0x333333));
  barrel.position.set(0.5, 0.87, 0);
  const trackMat = flatMaterial(0x2a2a2a);
  const left = new THREE.Mesh(probeTrack, trackMat);
  left.position.set(0, 0.15, 0.55);
  const right = new THREE.Mesh(probeTrack, trackMat);
  right.position.set(0, 0.15, -0.55);
  g.add(body, turret, barrel, left, right);
  return g;
});
