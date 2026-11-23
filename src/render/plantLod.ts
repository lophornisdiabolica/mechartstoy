import * as THREE from 'three';

/**
 * The layer that only the sun's shadow sees (see Stage): things on it cast
 * shadows but are never drawn on screen.
 */
export const SHADOW_LAYER = 1;

/**
 * How many pixels across a world unit is on screen at which plants switch to
 * their far shapes (and, with some slack so they don't flicker at the line,
 * back). A tree is about 4 units tall, so it's some 55 pixels high there:
 * a whole map in view is about 8 pixels a unit on a 1080p screen, and
 * zoomed right in about 40.
 */
export const FAR_BELOW_PX = 14;
const NEAR_ABOVE_PX = 16;

/** Whether plants should be drawn with their far shapes at `pxPerUnit`, given what they were last frame. */
export function farAt(pxPerUnit: number, wasFar: boolean): boolean {
  return wasFar ? pxPerUnit < NEAR_ABOVE_PX : pxPerUnit < FAR_BELOW_PX;
}

/** A plant's shapes: as designed, simpler for far off, and the simplest for the shadow it casts (see propsMesh's Detail). */
export interface PlantShapes {
  near: THREE.BufferGeometry;
  far: THREE.BufferGeometry;
  shadow: THREE.BufferGeometry;
}

/**
 * Plants drawn as an instanced mesh with near and far shapes, swapped by
 * zoom (`setFar`), that casts its shadow through a twin with the simple
 * shadow shape. The twin shares the mesh's instance matrices, so moving a
 * plant moves its shadow with no more uploading; it sits on SHADOW_LAYER,
 * so it's drawn into the shadow map and nowhere else.
 */
export class PlantMesh {
  readonly mesh: THREE.InstancedMesh;
  readonly shadow: THREE.InstancedMesh;
  private far = false;

  constructor(
    private readonly shapes: PlantShapes,
    material: THREE.Material,
    count: number,
  ) {
    this.mesh = new THREE.InstancedMesh(shapes.near, material, count);
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.shadow = new THREE.InstancedMesh(shapes.shadow, material, 0);
    this.shadow.instanceMatrix = this.mesh.instanceMatrix;
    this.shadow.count = count;
    this.shadow.castShadow = true;
    this.shadow.receiveShadow = false;
    this.shadow.layers.set(SHADOW_LAYER);
  }

  /** Both meshes, to add to the scene. */
  get objects(): THREE.Object3D[] {
    return [this.mesh, this.shadow];
  }

  setFar(far: boolean): void {
    if (far === this.far) return;
    this.far = far;
    this.mesh.geometry = far ? this.shapes.far : this.shapes.near;
  }

  /**
   * Work out both meshes' bounds from where the plants stand now, `slack`
   * further out for plants that will move a little (a tree falling over).
   */
  computeBounds(slack = 0): void {
    for (const m of [this.mesh, this.shadow]) {
      m.computeBoundingSphere();
      m.boundingSphere!.radius += slack;
    }
  }
}
