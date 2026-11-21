import * as THREE from 'three';
import { Armed, Arsenal, Collider, Transform } from '../game/components';
import { Game } from '../game/game';

/** Most jammed units marked at once. */
const MOST = 400;
/** How fast a mark fades in and out, per second. */
const FADE = 3;
const OPACITY = 0.3;
const COLOUR = 0x6ab8aa;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Cipher's jamming (see game/hacking.ts), shown where it bites: a faint,
 * still hexagonal ring on the ground under each unit whose guns are
 * jammed, fading in as the jam takes and out as it lifts. Nothing flashes
 * or moves, so a jammed fight reads at a glance without catching the eye.
 */
export class JamMarks {
  readonly root = new THREE.Group();
  private readonly rings: THREE.InstancedMesh;
  /** How strongly each marked unit's ring is drawn, 0 to 1. */
  private readonly shown = new Map<number, number>();

  constructor(private readonly game: Game) {
    this.root.name = 'jam-marks';
    const ring = new THREE.RingGeometry(0.82, 1, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: OPACITY, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.rings = new THREE.InstancedMesh(ring, material, MOST);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.renderOrder = 1;
    this.rings.userData.noShadow = true;
    this.root.add(this.rings);
  }

  update(seconds: number): void {
    const world = this.game.world;
    const now = world.time;
    const jammed = (a: Armed) => a.jammed !== undefined && a.jammed > now;
    const want = new Set<number>();
    for (const e of world.query(Armed, Transform)) {
      if (jammed(world.req(e, Armed)) || world.get(e, Arsenal)?.arms.some(jammed)) want.add(e);
    }
    if (want.size === 0 && this.shown.size === 0) return;
    for (const e of want) if (!this.shown.has(e)) this.shown.set(e, 0);
    const field = this.game.field;
    let n = 0;
    for (const [e, k] of this.shown) {
      const on = want.has(e) && world.has(e, Transform);
      const next = Math.max(0, Math.min(1, k + (on ? FADE : -FADE) * seconds));
      if (next <= 0 || !world.has(e, Transform)) {
        this.shown.delete(e);
        continue;
      }
      this.shown.set(e, next);
      if (n >= MOST) continue;
      const t = world.req(e, Transform);
      const r = (world.get(e, Collider)?.radius ?? 0.5) * 1.4 + 0.3;
      _p.set(t.x, Math.max(field.surfaceAt(t.x, t.z), field.seaLevel) + 0.08, t.z);
      _s.set(r, 1, r);
      _m.compose(_p, _q.identity(), _s);
      this.rings.setMatrixAt(n, _m);
      // Fading is done by darkening toward black, which the see-through ring shows as fainter.
      this.rings.setColorAt(n, _c.set(COLOUR).multiplyScalar(next));
      n++;
    }
    this.rings.count = n;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.rings.dispose();
    this.rings.geometry.dispose();
    (this.rings.material as THREE.Material).dispose();
  }
}
