import * as THREE from 'three';
import { FIRE_CELL, LIT, WHITE_HOT } from '../game/fire';
import { Game } from '../game/game';

/** Most flames drawn at once. */
const MOST = 4000;

/** The colour scorched ground is darkened toward, and how far at most (fresh scorch). */
const SCORCHED = new THREE.Color(0x2e231a);
const SCORCH_DEPTH = 0.78;
/** Seconds of scorch left (see FireField.scorch) from which a patch is at its darkest; it fades out below that. */
const FRESH = 6;
/** Passes of a 3x3 blur over the scorch grid: each spreads the fade about one fire cell further out. */
const SPREAD = 2;
const EMBER = new THREE.Color(0x9a3a10);
const FLAME = new THREE.Color(0xe0701e);
const WHITE = new THREE.Color(0xf6c060);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
/** A number written as a GLSL float. */
function glsl(v: number): string {
  return v.toFixed(5);
}
/** A fixed scrap of noise per cell, 0 to 1. */
function hash(k: number): number {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Burning and scorched ground (see game/fire.ts). Scorch is painted into
 * the ground itself, in the terrain's own low-poly style: a grid with one
 * value per fire cell, blurred a couple of cells wide, is read at each
 * triangle's corner and the whole triangle darkens by it, so a burn is a
 * patch of darker facets that thins out into scattered ones at its edge,
 * with no seams between neighbouring fires. Flames are small faceted cones,
 * orange where it burns and pale yellow where it's white-hot; unlit, so
 * fire glows at dusk.
 */
export class FireGround {
  readonly root = new THREE.Group();
  private readonly flames: THREE.InstancedMesh;
  private readonly raw: Float32Array;
  private readonly tmp: Float32Array;
  private readonly second: Float32Array;
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
    const n = fire.cols * fire.rows;
    this.raw = new Float32Array(n);
    this.tmp = new Float32Array(n);
    this.second = new Float32Array(n);
    this.scorchData = new Uint8Array(n);
    this.scorchMap = new THREE.DataTexture(this.scorchData, fire.cols, fire.rows, THREE.RedFormat, THREE.UnsignedByteType);
    this.scorchMap.magFilter = THREE.LinearFilter;
    this.scorchMap.minFilter = THREE.LinearFilter;
    this.scorchMap.needsUpdate = true;
    if (ground) this.paintInto(ground);

    // A flame: a five-sided cone standing on its base.
    const cone = new THREE.ConeGeometry(0.32, 1, 5);
    cone.translate(0, 0.5, 0);
    this.flames = new THREE.InstancedMesh(cone, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }), MOST);
    this.flames.count = 0;
    this.flames.frustumCulled = false;
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.renderOrder = 2;
    this.root.add(this.flames);
  }

  /** Teach the terrain's material to darken its triangles where the scorch grid says. */
  private paintInto(ground: THREE.Mesh): void {
    const material = ground.material as THREE.MeshStandardMaterial;
    const { minX, minZ } = this.game.field.bounds;
    const fire = this.game.ctx.fire;
    const uniforms = {
      scorchMap: { value: this.scorchMap },
      scorchRect: { value: new THREE.Vector4(minX, minZ, fire.cols * FIRE_CELL, fire.rows * FIRE_CELL) },
    };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      // Read at the vertex, passed on flat: the whole triangle takes its first corner's value, like the terrain's colours.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D scorchMap;\nuniform vec4 scorchRect;\nflat varying float vScorch;')
        .replace(
          '#include <begin_vertex>',
          [
            '#include <begin_vertex>',
            'vec2 scorchXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
            'vScorch = texture2D(scorchMap, (scorchXZ - scorchRect.xy) / scorchRect.zw).r;',
            // Each facet a little more or less burnt than its neighbours, so the edge breaks up into scattered facets.
            'vScorch += (fract(sin(dot(floor(scorchXZ * 1.7), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.3 * min(1.0, vScorch * 3.0);',
          ].join('\n'),
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nflat varying float vScorch;\nconst vec3 scorchColor = vec3(${glsl(SCORCHED.r)}, ${glsl(SCORCHED.g)}, ${glsl(SCORCHED.b)});\nconst float scorchDepth = ${glsl(SCORCH_DEPTH)};`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, scorchColor, smoothstep(0.05, 0.85, vScorch) * scorchDepth);');
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
    const cols = fire.cols;
    // The burnt area's bounds, so the blur only runs where there's something to blur.
    let i0 = Infinity;
    let i1 = -Infinity;
    let j0 = Infinity;
    let j1 = -Infinity;
    if (changed) this.raw.fill(0);
    let n = 0;
    fire.forEach((k, heat, left) => {
      if (changed) {
        // Fresh scorch is darkest; it fades out as it goes cold.
        this.raw[k] = heat > 0 ? 1 : Math.min(1, left / FRESH);
        const i = k % cols;
        const j = (k - i) / cols;
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
      if (heat < LIT * 0.6 || n >= MOST) return;
      const c = fire.center(k);
      const x = c.x + (hash(k) - 0.5) * FIRE_CELL * 0.6;
      const z = c.z + (hash(k + 7919) - 0.5) * FIRE_CELL * 0.6;
      const y = Math.max(field.surfaceAt(x, z), field.seaLevel) - 0.05;
      const flicker = 0.8 + 0.2 * Math.sin(this.time * 13 + k * 1.7) * Math.sin(this.time * 5.3 + k);
      const white = heat >= WHITE_HOT;
      const size = 0.6 + Math.min(0.3, heat * 0.12) + hash(k + 3) * 0.25;
      _p.set(x, y, z);
      _e.set((hash(k + 11) - 0.5) * 0.3, hash(k + 31) * Math.PI * 2, (hash(k + 17) - 0.5) * 0.3);
      _q.setFromEuler(_e);
      _s.set(size, size * flicker * (0.7 + Math.min(0.5, heat * 0.2)), size);
      _m.compose(_p, _q, _s);
      this.flames.setMatrixAt(n, _m);
      if (white) _c.copy(FLAME).lerp(WHITE, Math.min(1, (heat - WHITE_HOT) / 1 + 0.5));
      else _c.copy(EMBER).lerp(FLAME, Math.min(1, heat / WHITE_HOT));
      this.flames.setColorAt(n, _c);
      n++;
    });
    if (changed) {
      this.blur(i0, i1, j0, j1);
      this.scorchMap.needsUpdate = true;
    }
    this.flames.count = n;
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
  }

  /** Spread the scorch grid SPREAD cells round the burnt area (keeping the darkest where it's burnt), into the texture. */
  private blur(i0: number, i1: number, j0: number, j1: number): void {
    const { cols, rows } = this.game.ctx.fire;
    this.scorchData.fill(0);
    if (i1 < i0) return;
    this.tmp.fill(0);
    this.second.fill(0);
    i0 = Math.max(0, i0 - SPREAD);
    j0 = Math.max(0, j0 - SPREAD);
    i1 = Math.min(cols - 1, i1 + SPREAD);
    j1 = Math.min(rows - 1, j1 + SPREAD);
    const raw = this.raw;
    // Ping-pong between two buffers, starting from the raw grid.
    const bufs = [this.tmp, this.second];
    let src = raw;
    for (let pass = 0; pass < SPREAD; pass++) {
      const dst = bufs[pass % 2];
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          let sum = 0;
          for (let dj = -1; dj <= 1; dj++) {
            const jj = Math.min(rows - 1, Math.max(0, j + dj));
            for (let di = -1; di <= 1; di++) sum += src[jj * cols + Math.min(cols - 1, Math.max(0, i + di))];
          }
          dst[j * cols + i] = sum / 9;
        }
      }
      src = dst;
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        this.scorchData[k] = Math.round(255 * Math.min(1, Math.max(raw[k] * 0.9, src[k] * 1.3)));
      }
    }
  }

  dispose(): void {
    this.flames.dispose();
    this.flames.geometry.dispose();
    (this.flames.material as THREE.Material).dispose();
    this.scorchMap.dispose();
  }
}
