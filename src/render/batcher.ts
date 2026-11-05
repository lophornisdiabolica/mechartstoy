import * as THREE from 'three';

/**
 * Draws many small models with few draw calls. Models are still built as
 * ordinary Three.js object trees (see models.ts), which keeps them easy to
 * write, animate and pick, but those trees are never rendered themselves.
 * Each frame, every visible mesh in them is copied into an InstancedMesh
 * shared by all meshes with the same geometry, material and shadow flags,
 * and every infantry sprite into an instanced billboard per sprite sheet.
 *
 * Two things make the batches few:
 * - every box (models.ts's `box`, by far the commonest part) is drawn as one
 *   unit box, scaled to size in its instance matrix;
 * - the plain flat-shaded and glowing materials (`flatMaterial`,
 *   `glowMaterial`) are drawn as one material each, with the colour per
 *   instance.
 * So a batch is mostly "every box", "every cylinder of this shape" and so on.
 *
 * Adding a unit or building needs nothing here: whatever geometry and
 * materials its model uses get batches of their own.
 */

/** Frames a batch can sit empty before it's freed (models come and go). */
const IDLE_FRAMES = 120;

interface MeshBatch {
  mesh: THREE.InstancedMesh;
  count: number;
  idle: number;
}

interface SpriteBatch {
  mesh: THREE.InstancedMesh;
  offsets: THREE.InstancedBufferAttribute;
  count: number;
  idle: number;
}

/** How high above a trooper's feet its light is measured, in its sprite's heights: about the knee. */
const SPRITE_LIGHT_HEIGHT = 0.3;

/**
 * Multiplies the light on infantry sprites so that in the usual daylight,
 * out of shadow, they look exactly as painted (see Stage, which sets it).
 */
export const SPRITE_GAIN = { value: new THREE.Vector3(1, 1, 1) };

/**
 * Infantry sprites are lit like the ground they stand on: a Lambert
 * material whose vertex shader turns each instance into a camera-facing
 * quad (like THREE.Sprite), lit as if it were a patch of flat ground at the
 * trooper's knee. So a trooper in a building's shadow, or out at dusk,
 * darkens just as the ground under them does, the whole sprite evenly, and
 * fog (when there is some) fades them like everything else. Costs one
 * shadow-map lookup per sprite pixel, as the ground pays per ground pixel.
 */
function spriteShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.spriteGain = SPRITE_GAIN;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 uvOffset;')
    // The frame this trooper is on: an offset into the sheet.
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv += uvOffset;')
    // Lit as flat ground: the normal points straight up.
    .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3( 0.0, 1.0, 0.0 );')
    .replace(
      '#include <project_vertex>',
      /* glsl */ `
      // A camera-facing quad: the instance gives the anchor (the feet) and the size.
      vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
      vec2 spriteSize = vec2( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ) );
      // Anchored at the bottom middle (Sprite.center 0.5, 0).
      mvPosition.xy += ( position.xy + vec2( 0.0, 0.5 ) ) * spriteSize;
      gl_Position = projectionMatrix * mvPosition;`,
    )
    // Shadows are looked up at one point, by the knee, so the whole trooper is lit alike.
    .replace('#include <worldpos_vertex>', `vec4 worldPosition = modelMatrix * instanceMatrix * vec4( 0.0, ${SPRITE_LIGHT_HEIGHT.toFixed(2)}, 0.0, 1.0 );`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 spriteGain;')
    .replace('#include <opaque_fragment>', 'outgoingLight *= spriteGain;\n#include <opaque_fragment>');
}

const _m = new THREE.Matrix4();
const _scale = new THREE.Matrix4();
const _white = new THREE.Color(1, 1, 1);

export class Batcher {
  /** Holds the batches; add it to the scene. */
  readonly root = new THREE.Group();
  /** geometry → material → shadow flags → batch. */
  private readonly meshes = new Map<THREE.BufferGeometry, Map<THREE.Material, MeshBatch[]>>();
  /** One per sprite sheet (the texture's image source). */
  private readonly sprites = new Map<object, SpriteBatch>();
  private readonly spriteGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  /** Stand-ins for every flatMaterial and every glowMaterial, white, coloured per instance. */
  private readonly flat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.7, metalness: 0.15 });
  private readonly glow = new THREE.MeshBasicMaterial({ color: 0xffffff });

  constructor() {
    this.root.name = 'batches';
  }

  /** Start a frame: every batch empties. */
  begin(): void {
    for (const byMaterial of this.meshes.values()) for (const list of byMaterial.values()) for (const b of list) b.count = 0;
    for (const b of this.sprites.values()) b.count = 0;
  }

  /** Draw a mesh this frame, where its matrixWorld puts it. */
  addMesh(mesh: THREE.Mesh): void {
    const own = mesh.material as THREE.Material;
    const kind = own.userData.batch as 'flat' | 'glow' | undefined;
    const material = kind === 'flat' ? this.flat : kind === 'glow' ? this.glow : own;
    const size = mesh.geometry.userData.box as [number, number, number] | undefined;
    const geometry = size ? this.unitBox : mesh.geometry;
    let byMaterial = this.meshes.get(geometry);
    if (!byMaterial) this.meshes.set(geometry, (byMaterial = new Map()));
    let list = byMaterial.get(material);
    if (!list) byMaterial.set(material, (list = []));
    let batch = list.find((b) => b.mesh.castShadow === mesh.castShadow && b.mesh.receiveShadow === mesh.receiveShadow);
    if (!batch) {
      batch = { mesh: this.meshBatch(geometry, material, 16), count: 0, idle: 0 };
      batch.mesh.castShadow = mesh.castShadow;
      batch.mesh.receiveShadow = mesh.receiveShadow;
      list.push(batch);
      this.root.add(batch.mesh);
    }
    if (batch.count === batch.mesh.instanceMatrix.count) this.grow(batch);
    if (size) batch.mesh.setMatrixAt(batch.count, _m.multiplyMatrices(mesh.matrixWorld, _scale.makeScale(size[0], size[1], size[2])));
    else batch.mesh.setMatrixAt(batch.count, mesh.matrixWorld);
    // Every instance gets a colour (white when its material has its own), so the attribute is always filled.
    batch.mesh.setColorAt(batch.count, kind ? (own as THREE.MeshStandardMaterial).color : _white);
    batch.count++;
  }

  /**
   * Draw a sprite this frame, at the frame its texture's offset picks, from
   * its sheet: `userData.sheet` if the model set one (the shared texture its
   * own is cloned from), else its own texture.
   */
  addSprite(sprite: THREE.Sprite): void {
    const map = sprite.material.map;
    if (!map) return;
    const sheet = (sprite.userData.sheet as THREE.Texture | undefined) ?? map;
    let batch = this.sprites.get(map.source);
    if (!batch) {
      const offsets = new THREE.InstancedBufferAttribute(new Float32Array(32), 2).setUsage(THREE.DynamicDrawUsage);
      const geometry = this.spriteGeometry.clone();
      geometry.setAttribute('uvOffset', offsets);
      const material = new THREE.MeshLambertMaterial({ map: sheet, alphaTest: 0.5 });
      material.onBeforeCompile = spriteShader;
      const mesh = new THREE.InstancedMesh(geometry, material, 16);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      batch = { mesh, offsets, count: 0, idle: 0 };
      this.sprites.set(map.source, batch);
      this.root.add(mesh);
    }
    if (batch.count === batch.mesh.instanceMatrix.count) this.growSprites(batch);
    // The sprite's centre and rotation are handled by the shader; only its anchor and size matter here.
    batch.mesh.setMatrixAt(batch.count, sprite.matrixWorld);
    batch.offsets.setXY(batch.count, map.offset.x, map.offset.y);
    batch.count++;
  }

  /** Finish a frame: hand the counts to the GPU, and free batches that have been empty a while. */
  end(): void {
    for (const [geometry, byMaterial] of this.meshes) {
      for (const [material, list] of byMaterial) {
        for (let i = list.length - 1; i >= 0; i--) {
          const b = list[i];
          b.mesh.count = b.count;
          b.mesh.instanceMatrix.needsUpdate = b.count > 0;
          if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = b.count > 0;
          b.idle = b.count > 0 ? 0 : b.idle + 1;
          if (b.idle > IDLE_FRAMES) {
            this.root.remove(b.mesh);
            b.mesh.dispose();
            list.splice(i, 1);
          }
        }
        if (list.length === 0) byMaterial.delete(material);
      }
      if (byMaterial.size === 0) this.meshes.delete(geometry);
    }
    for (const [source, b] of this.sprites) {
      b.mesh.count = b.count;
      b.mesh.instanceMatrix.needsUpdate = b.count > 0;
      b.offsets.needsUpdate = b.count > 0;
      b.idle = b.count > 0 ? 0 : b.idle + 1;
      if (b.idle > IDLE_FRAMES) {
        this.root.remove(b.mesh);
        this.disposeSprites(b);
        this.sprites.delete(source);
      }
    }
  }

  /** Draw calls the batches make (before shadows), for the stats readout. */
  get batches(): number {
    let n = 0;
    for (const byMaterial of this.meshes.values()) for (const list of byMaterial.values()) n += list.filter((b) => b.count > 0).length;
    for (const b of this.sprites.values()) if (b.count > 0) n++;
    return n;
  }

  /** Free everything (the shared geometry and materials stay; they belong to the model caches). */
  dispose(): void {
    for (const byMaterial of this.meshes.values()) for (const list of byMaterial.values()) for (const b of list) b.mesh.dispose();
    for (const b of this.sprites.values()) this.disposeSprites(b);
    this.meshes.clear();
    this.sprites.clear();
    this.spriteGeometry.dispose();
    this.unitBox.dispose();
    this.flat.dispose();
    this.glow.dispose();
    this.root.clear();
  }

  private meshBatch(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances spread over the whole map; working out bounds every frame would cost more than drawing them.
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Double a batch's room, keeping what's already in it this frame. */
  private grow(batch: MeshBatch): void {
    const old = batch.mesh;
    const mesh = this.meshBatch(old.geometry, old.material as THREE.Material, old.instanceMatrix.count * 2);
    mesh.castShadow = old.castShadow;
    mesh.receiveShadow = old.receiveShadow;
    const color = new THREE.Color();
    for (let i = 0; i < batch.count; i++) {
      old.getMatrixAt(i, _m);
      mesh.setMatrixAt(i, _m);
      old.getColorAt(i, color);
      mesh.setColorAt(i, color);
    }
    this.root.remove(old);
    old.dispose();
    this.root.add(mesh);
    batch.mesh = mesh;
  }

  private growSprites(batch: SpriteBatch): void {
    const old = batch.mesh;
    const capacity = old.instanceMatrix.count * 2;
    const offsets = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    offsets.array.set(batch.offsets.array);
    const geometry = old.geometry.clone();
    geometry.setAttribute('uvOffset', offsets);
    const mesh = new THREE.InstancedMesh(geometry, old.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    for (let i = 0; i < batch.count; i++) {
      old.getMatrixAt(i, _m);
      mesh.setMatrixAt(i, _m);
    }
    this.root.remove(old);
    old.geometry.dispose();
    old.dispose();
    this.root.add(mesh);
    batch.mesh = mesh;
    batch.offsets = offsets;
  }

  private disposeSprites(b: SpriteBatch): void {
    b.mesh.geometry.dispose();
    (b.mesh.material as THREE.Material).dispose();
    b.mesh.dispose();
  }
}
