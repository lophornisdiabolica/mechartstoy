import * as THREE from 'three';
import { FROST_CELL, FROZEN } from '../game/frost';
import { Game } from '../game/game';

/** Most frost patches drawn at once. */
const MOST = 6000;
/** Frost at which a patch is at its whitest. */
const THICK = 5;

const RIME = new THREE.Color(0xe8f6ff);
const THIN = new THREE.Color(0xb8d8ea);

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
 * Frosted ground (see game/frost.ts): a pale six-sided plate of ice over
 * each frozen cell, each a little turned and sized so the patches read as
 * a crust rather than a grid, whiter where the frost is thick, and
 * shrinking away as it thaws. Water freezes over the same way.
 */
export class FrostGround {
  readonly root = new THREE.Group();
  private readonly plates: THREE.InstancedMesh;
  private seen = -1;

  constructor(private readonly game: Game) {
    this.root.name = 'frost-ground';
    const plate = new THREE.CircleGeometry(FROST_CELL * 0.72, 6).rotateX(-Math.PI / 2);
    this.plates = new THREE.InstancedMesh(plate, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.78, depthWrite: false }), MOST);
    this.plates.count = 0;
    this.plates.frustumCulled = false;
    this.plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plates.renderOrder = 1;
    this.plates.userData.noShadow = true;
    this.root.add(this.plates);
  }

  update(): void {
    const frost = this.game.ctx.frost;
    if (frost.version === this.seen) return;
    this.seen = frost.version;
    const field = this.game.field;
    let n = 0;
    frost.forEach((k, amount) => {
      if (amount < FROZEN * 0.5 || n >= MOST) return;
      const c = frost.center(k);
      const x = c.x + (hash(k) - 0.5) * FROST_CELL * 0.3;
      const z = c.z + (hash(k + 7919) - 0.5) * FROST_CELL * 0.3;
      const y = Math.max(field.surfaceAt(x, z), field.seaLevel) + 0.06 + hash(k + 5) * 0.03;
      const size = (0.55 + 0.45 * Math.min(1, amount / 2)) * (0.85 + hash(k + 3) * 0.3);
      _p.set(x, y, z);
      // Tip each plate a touch toward the slope under it, so it lies on the ground rather than cutting into it.
      const dx = field.surfaceAt(x + 0.5, z) - field.surfaceAt(x - 0.5, z);
      const dz = field.surfaceAt(x, z + 0.5) - field.surfaceAt(x, z - 0.5);
      _e.set(Math.atan(dz), hash(k + 31) * Math.PI, -Math.atan(dx), 'YXZ');
      _q.setFromEuler(_e);
      _s.set(size, 1, size);
      _m.compose(_p, _q, _s);
      this.plates.setMatrixAt(n, _m);
      _c.copy(THIN).lerp(RIME, Math.min(1, amount / THICK));
      this.plates.setColorAt(n, _c);
      n++;
    });
    this.plates.count = n;
    this.plates.instanceMatrix.needsUpdate = true;
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.plates.dispose();
    this.plates.geometry.dispose();
    (this.plates.material as THREE.Material).dispose();
  }
}
