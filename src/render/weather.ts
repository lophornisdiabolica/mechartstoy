import * as THREE from 'three';
import { WeatherState } from '../game/weather';
import { Battlefield } from '../world/battlefield';

/**
 * Draws the weather (see game/weather.ts): rain streaks, snowflakes, drifting
 * mist and lightning. The fog itself, the overcast light and the lightning's
 * flash are the Stage's (it owns the lights); this hands it `flash`.
 *
 * Rain and snow are one draw call each: every drop's place is worked out on
 * the GPU from a fixed random seed, the time and the wind, inside a box that
 * follows the view, so nothing is updated per drop on the CPU. Drops stay put
 * in the world as the camera pans (the box wraps them round its edges), and
 * the ground hides them where they fall through it.
 *
 * Purely visual, so it uses Math.random freely.
 */

const MAX_DROPS = 14000;
const MAX_FLAKES = 12000;
const MIST_PATCHES = 22;
/** How high above the view's centre drops start falling, in world units. */
const FALL_HEIGHT = 46;
const RAIN_SPEED = 38;
const SNOW_SPEED = 3.2;
/** Seconds between lightning strikes at full strength, on average. */
const STRIKE_EVERY = 5.5;

const PRECIP_VERTEX = /* glsl */ `
  attribute vec4 seed;
  uniform vec3 center;
  uniform vec2 box;
  uniform float fall;
  uniform vec2 drift;
  uniform float streak;
  uniform float sway;
  uniform float pxPerUnit;
  uniform float flakeSize;
  uniform float time;
  varying float vFade;
  void main() {
    // Height: falls from the top of the box to the bottom, then starts again.
    float y = fract(seed.y - fall / box.y) * box.y;
    // Across: anchored in the world (the wind carries it), wrapped into the box round the view.
    vec2 xz = seed.xz * box.x + drift + vec2(sin(time * 1.3 + seed.w * 40.0), cos(time * 1.1 + seed.w * 31.0)) * sway;
    vec2 lo = center.xz - box.x * 0.5;
    xz = lo + mod(xz - lo, box.x);
    vec3 p = vec3(xz.x, center.y - 12.0 + y, xz.y);
    #ifdef STREAK
      // Rain: the top end of each streak trails back along the way it's moving.
      p += normalize(vec3(streakDir.x, 1.0, streakDir.y)) * streak * position.y;
    #endif
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    // Thin out toward the box's edges, so its wrap never shows as a line.
    vec2 edge = abs(xz - center.xz) / (box.x * 0.5);
    vFade = 1.0 - smoothstep(0.75, 1.0, max(edge.x, edge.y));
    #ifndef STREAK
      gl_PointSize = flakeSize * pxPerUnit * (0.6 + seed.w * 0.8);
    #endif
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(color, opacity * vFade);
    #include <colorspace_fragment>
  }
`;

const SNOW_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(color, opacity * vFade * (1.0 - smoothstep(0.25, 0.5, d)));
    #include <colorspace_fragment>
  }
`;

/** Random seeds per drop: x and z across the box, y up it, w for size and sway. */
function seeds(n: number): THREE.BufferAttribute {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  return new THREE.BufferAttribute(a, 4);
}

/** A soft, lumpy white blob for the mist. */
function mistTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    const x = size * (0.3 + Math.random() * 0.4);
    const y = size * (0.35 + Math.random() * 0.3);
    const r = size * (0.15 + Math.random() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Bolt {
  mesh: THREE.Mesh;
  /** A wider, fainter ribbon round the bolt, its glow. */
  halo: THREE.Mesh;
  glow: THREE.Sprite;
  age: number;
}

/** How bright a strike is over its life: two or three flickers. */
function flicker(age: number): number {
  if (age < 0.06) return 1;
  if (age < 0.11) return 0.25;
  if (age < 0.2) return 0.9;
  if (age < 0.26) return 0.35;
  if (age < 0.34) return 0.6;
  return Math.max(0, 0.6 - (age - 0.34) * 3);
}
const BOLT_LIFE = 0.55;

export class WeatherView {
  readonly root = new THREE.Group();
  /** How bright lightning is lighting the scene now, 0 to about 1 (the Stage adds it to the sky light). */
  flash = 0;
  private readonly rain: THREE.LineSegments;
  private readonly snow: THREE.Points;
  private readonly rainUniforms: Record<string, THREE.IUniform>;
  private readonly snowUniforms: Record<string, THREE.IUniform>;
  private readonly mist: THREE.Sprite[] = [];
  private readonly mistMaterial: THREE.SpriteMaterial;
  private readonly bolts: Bolt[] = [];
  private readonly boltMaterial = new THREE.MeshBasicMaterial({ color: 0xd8e4ff, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  private readonly glowMaterial: THREE.SpriteMaterial;
  private time = 0;
  private fall = { rain: 0, snow: 0 };
  private readonly drift = { rain: new THREE.Vector2(), snow: new THREE.Vector2(), mist: new THREE.Vector2() };

  constructor(private readonly field: Battlefield) {
    this.root.name = 'weather';

    // Rain: a short line per drop, bottom end (y 0) and top end (y 1).
    const rainGeo = new THREE.BufferGeometry();
    const ends = new Float32Array(MAX_DROPS * 2 * 3);
    const dropSeeds = seeds(MAX_DROPS).array as Float32Array;
    const rainSeeds = new Float32Array(MAX_DROPS * 2 * 4);
    for (let i = 0; i < MAX_DROPS; i++) {
      ends[(i * 2 + 1) * 3 + 1] = 1;
      rainSeeds.set(dropSeeds.subarray(i * 4, i * 4 + 4), i * 8);
      rainSeeds.set(dropSeeds.subarray(i * 4, i * 4 + 4), i * 8 + 4);
    }
    rainGeo.setAttribute('position', new THREE.BufferAttribute(ends, 3));
    rainGeo.setAttribute('seed', new THREE.BufferAttribute(rainSeeds, 4));
    this.rainUniforms = this.uniforms(0xc4d2de);
    this.rainUniforms.streakDir = { value: new THREE.Vector2() };
    const rainMat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      vertexShader: '#define STREAK\nuniform vec2 streakDir;\n' + PRECIP_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.LineSegments(rainGeo, rainMat);

    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_FLAKES * 3), 3));
    snowGeo.setAttribute('seed', seeds(MAX_FLAKES));
    this.snowUniforms = this.uniforms(0xffffff);
    this.snowUniforms.flakeSize.value = 0.34;
    this.snowUniforms.sway.value = 0.7;
    const snowMat = new THREE.ShaderMaterial({
      uniforms: this.snowUniforms,
      vertexShader: PRECIP_VERTEX,
      fragmentShader: SNOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(snowGeo, snowMat);

    for (const o of [this.rain, this.snow]) {
      o.frustumCulled = false;
      o.visible = false;
      // After the scene's other see-through things, so smoke doesn't paint over the rain in front of it.
      o.renderOrder = 5;
      this.root.add(o);
    }

    this.mistMaterial = new THREE.SpriteMaterial({ map: mistTexture(), transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0 });
    for (let i = 0; i < MIST_PATCHES; i++) {
      const s = new THREE.Sprite(this.mistMaterial);
      s.userData.seed = [Math.random(), Math.random(), Math.random()];
      s.material.rotation = 0;
      s.renderOrder = 6;
      s.visible = false;
      this.mist.push(s);
      this.root.add(s);
    }

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 64;
    const g = glowCanvas.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.glowMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), color: 0xc8d8ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  }

  private uniforms(color: number): Record<string, THREE.IUniform> {
    return {
      center: { value: new THREE.Vector3() },
      box: { value: new THREE.Vector2(100, FALL_HEIGHT) },
      fall: { value: 0 },
      drift: { value: new THREE.Vector2() },
      streak: { value: 1.4 },
      sway: { value: 0 },
      pxPerUnit: { value: 10 },
      flakeSize: { value: 0.3 },
      time: { value: 0 },
      color: { value: new THREE.Color(color) },
      opacity: { value: 0 },
    };
  }

  /**
   * `seconds` is how far the weather moves on this frame: frame time, but
   * none while the battle is paused, so a paused photo freezes the rain.
   * `light` (0 to 1) dims the drops with the light, for dusk and storms.
   */
  update(w: WeatherState, seconds: number, view: { target: THREE.Vector3; radius: number; pxPerUnit: number; camera: THREE.Camera }, light: number): void {
    this.time += seconds;
    const t = this.time;
    // The box is wider than the view by how far a drop falls across it, seen at the camera's tilt.
    const box = view.radius * 2.3 + 20;

    // Rain.
    this.rain.visible = w.rain > 0.01;
    if (this.rain.visible) {
      this.fall.rain = (this.fall.rain + seconds * RAIN_SPEED) % (FALL_HEIGHT * 1000);
      this.drift.rain.x = (this.drift.rain.x + w.windX * seconds) % 4096;
      this.drift.rain.y = (this.drift.rain.y + w.windZ * seconds) % 4096;
      const u = this.rainUniforms;
      u.center.value.copy(view.target);
      u.box.value.set(box, FALL_HEIGHT);
      u.fall.value = this.fall.rain;
      u.drift.value.copy(this.drift.rain);
      // Streaks lean with the wind: how far across a drop goes per unit it falls.
      (u.streakDir.value as THREE.Vector2).set(-w.windX / RAIN_SPEED, -w.windZ / RAIN_SPEED);
      u.streak.value = 1.1 + 0.9 * w.rain;
      u.opacity.value = (0.22 + 0.3 * w.rain) * (0.35 + 0.65 * light);
      u.time.value = t;
      this.rain.geometry.setDrawRange(0, Math.round(MAX_DROPS * Math.min(1, w.rain)) * 2);
    }

    // Snow.
    this.snow.visible = w.snow > 0.01;
    if (this.snow.visible) {
      this.fall.snow = (this.fall.snow + seconds * SNOW_SPEED) % (FALL_HEIGHT * 1000);
      this.drift.snow.x = (this.drift.snow.x + w.windX * seconds) % 4096;
      this.drift.snow.y = (this.drift.snow.y + w.windZ * seconds) % 4096;
      const u = this.snowUniforms;
      u.center.value.copy(view.target);
      u.box.value.set(box, FALL_HEIGHT);
      u.fall.value = this.fall.snow;
      u.drift.value.copy(this.drift.snow);
      u.pxPerUnit.value = view.pxPerUnit;
      u.opacity.value = (0.55 + 0.4 * w.snow) * (0.3 + 0.7 * light);
      u.time.value = t;
      this.snow.geometry.setDrawRange(0, Math.round(MAX_FLAKES * Math.min(1, w.snow)));
    }

    // Mist: soft patches drifting low over the ground, thicker the thicker the fog.
    const mist = Math.max(0, w.fog - 0.15) / 0.85;
    this.drift.mist.x += (w.windX * 0.4 + 0.6) * seconds;
    this.drift.mist.y += (w.windZ * 0.4 + 0.3) * seconds;
    this.mistMaterial.opacity = mist * 0.4;
    const shade = 0.55 + 0.45 * light;
    this.mistMaterial.color.setRGB(shade, shade, shade * 1.02);
    const span = view.radius * 2.4;
    for (const s of this.mist) {
      s.visible = mist > 0.01;
      if (!s.visible) continue;
      const [a, b, c] = s.userData.seed as number[];
      const lo = view.target.x - span / 2;
      const lz = view.target.z - span / 2;
      const x = lo + (((a * span + this.drift.mist.x - lo) % span) + span) % span;
      const z = lz + (((b * span + this.drift.mist.y - lz) % span) + span) % span;
      s.position.set(x, this.field.surfaceAt(x, z) + 1.5 + c * 2, z);
      const size = view.radius * (0.45 + c * 0.5);
      s.scale.set(size * 1.6, size, 1);
    }

    this.updateLightning(w, seconds, view);
  }

  private updateLightning(w: WeatherState, seconds: number, view: { target: THREE.Vector3; radius: number; camera: THREE.Camera }): void {
    if (seconds > 0 && w.lightning > 0.01 && Math.random() < (seconds * w.lightning) / STRIKE_EVERY) this.strike(view);
    let flash = 0;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += seconds;
      const k = flicker(b.age);
      flash = Math.max(flash, k);
      if (b.age >= BOLT_LIFE) {
        this.root.remove(b.mesh, b.halo, b.glow);
        b.mesh.geometry.dispose();
        b.halo.geometry.dispose();
        (b.halo.material as THREE.Material).dispose();
        (b.glow.material as THREE.Material).dispose();
        (b.mesh.material as THREE.Material).dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = k;
      (b.halo.material as THREE.MeshBasicMaterial).opacity = k * 0.3;
      (b.glow.material as THREE.SpriteMaterial).opacity = k * 0.8;
    }
    // A strike off screen still lights the sky, a little.
    this.flash = flash;
  }

  /** A lightning bolt somewhere in view: a jagged ribbon from the clouds to the ground, with a branch or two. */
  private strike(view: { target: THREE.Vector3; radius: number; camera: THREE.Camera }): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * view.radius * 0.8;
    const x = this.field.clampX(view.target.x + Math.cos(a) * r, 2);
    const z = this.field.clampZ(view.target.z + Math.sin(a) * r, 2);
    const ground = this.field.surfaceAt(x, z);
    const top = ground + 70;
    const right = new THREE.Vector3().setFromMatrixColumn(view.camera.matrixWorld, 0);
    const core: number[] = [];
    const wide: number[] = [];
    const ribbon = (pts: THREE.Vector3[], width: number, positions: number[]) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const w0 = width * (1 - (i / pts.length) * 0.4);
        const w1 = width * (1 - ((i + 1) / pts.length) * 0.4);
        const p0a = pts[i].clone().addScaledVector(right, -w0);
        const p0b = pts[i].clone().addScaledVector(right, w0);
        const p1a = pts[i + 1].clone().addScaledVector(right, -w1);
        const p1b = pts[i + 1].clone().addScaledVector(right, w1);
        positions.push(...p0a.toArray(), ...p0b.toArray(), ...p1b.toArray(), ...p0a.toArray(), ...p1b.toArray(), ...p1a.toArray());
      }
    };
    const path = (from: THREE.Vector3, to: THREE.Vector3, steps: number, jag: number) => {
      const pts = [from.clone()];
      for (let i = 1; i < steps; i++) {
        const p = from.clone().lerp(to, i / steps);
        p.x += (Math.random() - 0.5) * jag;
        p.z += (Math.random() - 0.5) * jag;
        pts.push(p);
      }
      pts.push(to.clone());
      return pts;
    };
    const trunk = path(new THREE.Vector3(x + (Math.random() - 0.5) * 16, top, z + (Math.random() - 0.5) * 16), new THREE.Vector3(x, ground, z), 16, 5);
    ribbon(trunk, 0.38, core);
    ribbon(trunk, 1.9, wide);
    for (let n = 0; n < 2; n++) {
      const from = trunk[2 + Math.floor(Math.random() * 8)];
      const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 22, -(10 + Math.random() * 18), (Math.random() - 0.5) * 22));
      const branch = path(from, to, 7, 3);
      ribbon(branch, 0.18, core);
      ribbon(branch, 0.9, wide);
    }
    const ribbonMesh = (positions: number[], color: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const m = new THREE.Mesh(geo, this.boltMaterial.clone());
      (m.material as THREE.MeshBasicMaterial).color.set(color);
      m.frustumCulled = false;
      m.renderOrder = 7;
      return m;
    };
    const mesh = ribbonMesh(core, 0xeef3ff);
    const halo = ribbonMesh(wide, 0x7f9cff);
    const glow = new THREE.Sprite(this.glowMaterial.clone());
    glow.position.set(x, ground + 1.5, z);
    glow.scale.set(14, 14, 1);
    glow.renderOrder = 7;
    this.root.add(halo, mesh, glow);
    this.bolts.push({ mesh, halo, glow, age: 0 });
  }

  dispose(): void {
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as THREE.Material).dispose();
    this.mistMaterial.map?.dispose();
    this.mistMaterial.dispose();
    this.glowMaterial.map?.dispose();
    this.glowMaterial.dispose();
    this.boltMaterial.dispose();
    for (const b of this.bolts) {
      b.halo.geometry.dispose();
      (b.halo.material as THREE.Material).dispose();
      b.mesh.geometry.dispose();
      (b.mesh.material as THREE.Material).dispose();
      (b.glow.material as THREE.Material).dispose();
    }
    this.bolts.length = 0;
  }
}
