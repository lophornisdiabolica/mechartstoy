import * as THREE from 'three';
import { SMOKE_CELL, THICK } from '../game/smoke';
import { Game } from '../game/game';

/** Most smoke puffs drawn at once. */
const MOST = 5000;

const DARK = new THREE.Color(0x6e6a74);
const PALE = new THREE.Color(0xb4b0ba);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
/** A fixed scrap of noise per cell, 0 to 1. */
function hash(k: number): number {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** How fast the drawn haze catches up with the sim's, per second. */
const EASE = 2.5;

/**
 * Veil's haze (see game/smoke.ts): a low, thin, see-through grey bank over
 * each hazy cell, a little taller and darker where it's thick, rolling
 * slowly. What's drawn eases toward the sim's haze, every frame, so it
 * swells and fades smoothly instead of stepping with each sim tick.
 */
export class SmokeClouds {
  readonly root = new THREE.Group();
  private readonly puffs: THREE.InstancedMesh;
  private t = 0;
  /** The haze as drawn, per cell, easing toward the sim's. */
  private shown: Float32Array | null = null;
  /** Cells drawn with some haze. */
  private live: number[] = [];
  private listed: Uint8Array | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'smoke-clouds';
    // Faceted, like everything else: a low-poly lump, flat-shaded.
    const puff = new THREE.IcosahedronGeometry(SMOKE_CELL * 0.75, 0);
    this.puffs = new THREE.InstancedMesh(puff, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.2, depthWrite: false, flatShading: true }), MOST);
    this.puffs.count = 0;
    this.puffs.frustumCulled = false;
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.renderOrder = 2;
    this.puffs.userData.noShadow = true;
    this.root.add(this.puffs);
  }

  update(dt: number): void {
    const smoke = this.game.ctx.smoke;
    if (smoke.count === 0 && this.live.length === 0) return;
    this.t += dt;
    const n = smoke.cols * smoke.rows;
    if (!this.shown || this.shown.length !== n) {
      this.shown = new Float32Array(n);
      this.listed = new Uint8Array(n);
      this.live = [];
    }
    const shown = this.shown;
    const listed = this.listed!;
    smoke.forEach((k) => {
      if (!listed[k]) {
        listed[k] = 1;
        this.live.push(k);
      }
    });
    const field = this.game.field;
    const ease = Math.min(1, EASE * dt);
    const next: number[] = [];
    let q = 0;
    for (const k of this.live) {
      const want = smoke.smoke[k];
      shown[k] += (want - shown[k]) * ease;
      if (want <= 0 && shown[k] < 0.05) {
        shown[k] = 0;
        listed[k] = 0;
        continue;
      }
      next.push(k);
      const amount = shown[k];
      if (amount < 0.15 || q >= MOST) continue;
      const c = smoke.center(k);
      const roll = this.t * 0.3 + hash(k) * 6;
      const x = c.x + Math.sin(roll) * 0.3;
      const z = c.z + Math.cos(roll * 0.8) * 0.3;
      const thick = Math.min(1, amount / (THICK * 3));
      const size = (0.4 + 0.8 * Math.min(1, amount / THICK)) * (0.85 + hash(k + 3) * 0.3);
      _p.set(x, Math.max(field.surfaceAt(x, z), field.seaLevel) + size * 0.15, z);
      _e.set(hash(k + 11) * 0.6, roll * 0.2, hash(k + 17) * 0.6);
      _q.setFromEuler(_e);
      // Low and wide: a bank lying over the ground, not a cloud standing on it.
      _s.set(size * 1.35, size * (0.3 + thick * 0.35), size * 1.35);
      _m.compose(_p, _q, _s);
      this.puffs.setMatrixAt(q, _m);
      _c.copy(PALE).lerp(DARK, thick);
      this.puffs.setColorAt(q, _c);
      q++;
    }
    this.live = next;
    this.puffs.count = q;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.puffs.dispose();
    this.puffs.geometry.dispose();
    (this.puffs.material as THREE.Material).dispose();
  }
}
