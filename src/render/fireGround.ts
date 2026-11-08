import * as THREE from 'three';
import { FIRE_CELL, LIT, WHITE_HOT } from '../game/fire';
import { Game } from '../game/game';

/** Most patches drawn at once. */
const MOST = 4000;
/** How far above the ground the patches float. */
const LIFT = 0.08;

/** The colour scorched ground is darkened toward, and how far at most (fresh scorch). */
const SCORCHED = new THREE.Color(0x1a1410);
const SCORCH_DEPTH = 0.78;
/** Seconds of scorch left (see FireField.scorch) from which a patch is at its darkest; it fades out below that. */
const FRESH = 6;
const EMBER = new THREE.Color(0x9a2a08);
const FLAME = new THREE.Color(0xff6a10);
const WHITE = new THREE.Color(0xfff2b0);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
/** A soft round spot, white in the middle fading to black at the edge, for the additive flames. */
function softSpot(size = 32): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const d = Math.hypot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5) * 2;
      const v = Math.round(255 * Math.max(0, 1 - d) ** 1.6);
      data.set([v, v, v, 255], (j * size + i) * 4);
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
/** A fixed scrap of noise per cell, 0 to 1. */
function hash(k: number): number {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/**
 * Burning and scorched ground (see game/fire.ts). Scorch is painted into
 * the ground itself: a texture with one texel per fire cell, smoothly
 * filtered, darkens the terrain's own colour, so neighbouring patches run
 * into one another with no seams or unburnt slivers, and the edge of a
 * burn feathers off. Flames are soft additive spots on top, flickering
 * orange where it burns and a glaring yellow-white where it's white-hot;
 * unlit, so fire glows at dusk.
 */
export class FireGround {
  readonly root = new THREE.Group();
  private readonly glow: THREE.InstancedMesh;
  private readonly spot = softSpot();
  private readonly scorchData: Uint8Array;
  private readonly scorchMap: THREE.DataTexture;
  private seen = -1;
  private time = 0;

  constructor(
    private readonly game: Game,
    ground: THREE.Mesh | null,
  ) {
    this.root.name = 'fire-ground';
    const fire = game.ctx.fire;
    this.scorchData = new Uint8Array(fire.cols * fire.rows);
    this.scorchMap = new THREE.DataTexture(this.scorchData, fire.cols, fire.rows, THREE.RedFormat, THREE.UnsignedByteType);
    this.scorchMap.magFilter = THREE.LinearFilter;
    this.scorchMap.minFilter = THREE.LinearFilter;
    this.scorchMap.needsUpdate = true;
    if (ground) this.paintInto(ground);

    // Flames: soft spots, each turned and nudged its own way, wide enough to run together.
    const plane = new THREE.PlaneGeometry(FIRE_CELL * 2.2, FIRE_CELL * 2.2);
    this.glow = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({ map: this.spot, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      MOST,
    );
    this.glow.count = 0;
    this.glow.frustumCulled = false;
    this.glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.glow.renderOrder = 2;
    this.root.add(this.glow);
  }

  /** Teach the terrain's material to darken where the scorch texture says. */
  private paintInto(ground: THREE.Mesh): void {
    const material = ground.material as THREE.MeshStandardMaterial;
    const { minX, minZ } = this.game.field.bounds;
    const fire = this.game.ctx.fire;
    const uniforms = {
      scorchMap: { value: this.scorchMap },
      scorchRect: { value: new THREE.Vector4(minX, minZ, fire.cols * FIRE_CELL, fire.rows * FIRE_CELL) },
      scorchColor: { value: SCORCHED },
      scorchDepth: { value: SCORCH_DEPTH },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vScorchXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvScorchXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec2 vScorchXZ;\nuniform sampler2D scorchMap;\nuniform vec4 scorchRect;\nuniform vec3 scorchColor;\nuniform float scorchDepth;',
        )
        .replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            'float scorch = texture2D(scorchMap, (vScorchXZ - scorchRect.xy) / scorchRect.zw).r;',
            // A little grain so the feathered edge reads as burnt earth, not a blur.
            'float grain = fract(sin(dot(floor(vScorchXZ * 3.0), vec2(12.9898, 78.233))) * 43758.5453);',
            'scorch = smoothstep(0.08, 0.7, scorch + (grain - 0.5) * 0.14 * scorch);',
            'diffuseColor.rgb = mix(diffuseColor.rgb, scorchColor, scorch * scorchDepth);',
          ].join('\n'),
        );
    };
    material.customProgramCacheKey = () => 'scorched-ground';
    material.needsUpdate = true;
  }

  update(simSeconds: number): void {
    const fire = this.game.ctx.fire;
    this.time += simSeconds;
    // Redraw when the fire changes, and keep flickering while anything burns.
    if (fire.version === this.seen && simSeconds === 0) return;
    const changed = fire.version !== this.seen;
    this.seen = fire.version;
    const field = this.game.field;
    if (changed) this.scorchData.fill(0);
    let glows = 0;
    fire.forEach((k, heat, left) => {
      // Fresh scorch is darkest; it fades out as it goes cold.
      if (changed) this.scorchData[k] = Math.round(255 * (heat > 0 ? 1 : Math.min(1, left / FRESH)));
      if (heat < LIT * 0.6 || glows >= MOST) return;
      const c = fire.center(k);
      const x = c.x + (hash(k) - 0.5) * FIRE_CELL * 0.5;
      const z = c.z + (hash(k + 7919) - 0.5) * FIRE_CELL * 0.5;
      _q.setFromAxisAngle(UP, hash(k + 31) * Math.PI * 2).multiply(FLAT);
      const y = Math.max(field.surfaceAt(x, z), field.seaLevel) + LIFT;
      const flicker = 0.85 + 0.15 * Math.sin(this.time * 17 + k * 1.7) * Math.sin(this.time * 7.3 + k);
      const white = heat >= WHITE_HOT;
      _p.set(x, y, z);
      _s.setScalar((white ? 1.1 : 0.7 + Math.min(0.35, heat * 0.3)) * flicker);
      _m.compose(_p, _q, _s);
      this.glow.setMatrixAt(glows, _m);
      if (white) _c.copy(FLAME).lerp(WHITE, Math.min(1, (heat - WHITE_HOT) / 1 + 0.5));
      else _c.copy(EMBER).lerp(FLAME, Math.min(1, heat / WHITE_HOT));
      _c.multiplyScalar(flicker);
      this.glow.setColorAt(glows, _c);
      glows++;
    });
    if (changed) this.scorchMap.needsUpdate = true;
    this.glow.count = glows;
    this.glow.instanceMatrix.needsUpdate = true;
    if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.glow.dispose();
    this.glow.geometry.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.spot.dispose();
    this.scorchMap.dispose();
  }
}
