import * as THREE from 'three';
import { FIRE_CELL, LIT, WHITE_HOT } from '../game/fire';
import { Game } from '../game/game';

/** Most patches drawn at once. */
const MOST = 4000;
/** How far above the ground the patches float. */
const LIFT = 0.08;

const SCORCHED = new THREE.Color(0x1a1410);
const COLD = new THREE.Color(0x4a3a2a);
const EMBER = new THREE.Color(0x9a2a08);
const FLAME = new THREE.Color(0xff6a10);
const WHITE = new THREE.Color(0xfff2b0);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
/** A fixed scrap of noise per cell, 0 to 1. */
function hash(k: number): number {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

/**
 * Burning and scorched ground (see game/fire.ts): a flat patch per cell,
 * dark where it's scorched, flickering orange where it burns, and a glaring
 * yellow-white where it's white-hot. Unlit, so fire glows at dusk; scorch
 * marks are drawn see-through so the ground's colour shows through them.
 */
export class FireGround {
  readonly root = new THREE.Group();
  private readonly glow: THREE.InstancedMesh;
  private readonly scorch: THREE.InstancedMesh;
  private seen = -1;
  private time = 0;

  constructor(private readonly game: Game) {
    this.root.name = 'fire-ground';
    // Rough discs rather than squares, each turned and nudged its own way, so the grid doesn't show.
    const plane = new THREE.CircleGeometry(FIRE_CELL * 0.75, 7);
    this.glow = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), MOST);
    this.scorch = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), MOST);
    for (const m of [this.glow, this.scorch]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
    this.scorch.renderOrder = 1;
    this.glow.renderOrder = 2;
  }

  update(simSeconds: number): void {
    const fire = this.game.ctx.fire;
    this.time += simSeconds;
    // Redraw when the fire changes, and keep flickering while anything burns.
    if (fire.version === this.seen && simSeconds === 0) return;
    this.seen = fire.version;
    const field = this.game.field;
    let glows = 0;
    let scorches = 0;
    fire.forEach((k, heat, left) => {
      const c = fire.center(k);
      const x = c.x + (hash(k) - 0.5) * FIRE_CELL * 0.5;
      const z = c.z + (hash(k + 7919) - 0.5) * FIRE_CELL * 0.5;
      _q.setFromAxisAngle(UP, hash(k + 31) * Math.PI * 2).multiply(FLAT);
      const y = Math.max(field.surfaceAt(x, z), field.seaLevel) + LIFT;
      if (scorches < MOST && (left > 0 || heat > 0)) {
        _p.set(x, y, z);
        _s.setScalar(0.9 + hash(k + 3) * 0.4);
        _m.compose(_p, _q, _s);
        this.scorch.setMatrixAt(scorches, _m);
        // Fresh scorch is darkest; it fades as it goes cold.
        _c.copy(SCORCHED).lerp(COLD, 1 - Math.min(1, left / 6));
        this.scorch.setColorAt(scorches, _c);
        scorches++;
      }
      if (heat >= LIT * 0.6 && glows < MOST) {
        const flicker = 0.85 + 0.15 * Math.sin(this.time * 17 + k * 1.7) * Math.sin(this.time * 7.3 + k);
        const white = heat >= WHITE_HOT;
        _p.set(x, y + 0.02, z);
        _s.setScalar((white ? 1.1 : 0.7 + Math.min(0.35, heat * 0.3)) * flicker);
        _m.compose(_p, _q, _s);
        this.glow.setMatrixAt(glows, _m);
        if (white) _c.copy(FLAME).lerp(WHITE, Math.min(1, (heat - WHITE_HOT) / 1 + 0.5));
        else _c.copy(EMBER).lerp(FLAME, Math.min(1, heat / WHITE_HOT));
        _c.multiplyScalar(flicker);
        this.glow.setColorAt(glows, _c);
        glows++;
      }
    });
    this.glow.count = glows;
    this.scorch.count = scorches;
    for (const m of [this.glow, this.scorch]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    this.glow.dispose();
    this.scorch.dispose();
    this.glow.geometry.dispose();
    (this.glow.material as THREE.Material).dispose();
    (this.scorch.material as THREE.Material).dispose();
  }
}
