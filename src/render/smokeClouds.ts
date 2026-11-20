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

/**
 * Veil's smoke (see game/smoke.ts): a soft grey puff over each smoky cell,
 * taller and darker where it's thick, rolling slowly and shrinking away as
 * it thins.
 */
export class SmokeClouds {
  readonly root = new THREE.Group();
  private readonly puffs: THREE.InstancedMesh;
  private t = 0;

  constructor(private readonly game: Game) {
    this.root.name = 'smoke-clouds';
    const puff = new THREE.IcosahedronGeometry(SMOKE_CELL * 0.75, 0);
    this.puffs = new THREE.InstancedMesh(puff, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }), MOST);
    this.puffs.count = 0;
    this.puffs.frustumCulled = false;
    this.puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.puffs.renderOrder = 2;
    this.puffs.userData.noShadow = true;
    this.root.add(this.puffs);
  }

  update(dt: number): void {
    const smoke = this.game.ctx.smoke;
    if (smoke.count === 0 && this.puffs.count === 0) return;
    this.t += dt;
    const field = this.game.field;
    let n = 0;
    smoke.forEach((k, amount) => {
      if (amount < 0.15 || n >= MOST) return;
      const c = smoke.center(k);
      const roll = this.t * 0.3 + hash(k) * 6;
      const x = c.x + Math.sin(roll) * 0.3;
      const z = c.z + Math.cos(roll * 0.8) * 0.3;
      const thick = Math.min(1, amount / (THICK * 3));
      const size = (0.6 + 0.6 * Math.min(1, amount / THICK)) * (0.85 + hash(k + 3) * 0.3);
      _p.set(x, Math.max(field.surfaceAt(x, z), field.seaLevel) + size * (0.6 + thick * 0.8), z);
      _e.set(hash(k + 11) * 3, roll * 0.2, hash(k + 17) * 3);
      _q.setFromEuler(_e);
      _s.set(size * 1.2, size * (0.8 + thick * 0.8), size * 1.2);
      _m.compose(_p, _q, _s);
      this.puffs.setMatrixAt(n, _m);
      _c.copy(PALE).lerp(DARK, thick);
      this.puffs.setColorAt(n, _c);
      n++;
    });
    this.puffs.count = n;
    this.puffs.instanceMatrix.needsUpdate = true;
    if (this.puffs.instanceColor) this.puffs.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.puffs.dispose();
    this.puffs.geometry.dispose();
    (this.puffs.material as THREE.Material).dispose();
  }
}
