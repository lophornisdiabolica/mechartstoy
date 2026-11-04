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

const SPRITE_VERTEX = /* glsl */ `
  attribute vec2 uvOffset;
  uniform vec2 uvRepeat;
  varying vec2 vUv;
  void main() {
    vUv = uv * uvRepeat + uvOffset;
    // A camera-facing quad, like THREE.Sprite: the instance gives the anchor and the size.
    vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
    // Anchored at the bottom middle (Sprite.center 0.5, 0).
    mvPosition.xy += (position.xy + vec2(0.0, 0.5)) * size;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const SPRITE_FRAGMENT = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(map, vUv);
    if (texel.a < 0.5) discard;
    gl_FragColor = texel;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

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
      const material = new THREE.ShaderMaterial({
        uniforms: { map: { value: sheet }, uvRepeat: { value: map.repeat.clone() } },
        vertexShader: SPRITE_VERTEX,
        fragmentShader: SPRITE_FRAGMENT,
      });
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
