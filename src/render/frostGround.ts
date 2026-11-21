import * as THREE from 'three';
import { FROST_CELL, FROZEN } from '../game/frost';
import { Game } from '../game/game';

/** Most frosted cells drawn at once. */
const MOST = 8000;
/** How opaque the ice plates are: the shape of the ground still shows through. */
const OPACITY = 0.55;
/** A plate's share of its cell at its biggest: the rest is the thin seam between plates. */
const FILL = 0.93;
/** Frost at which a plate is full size. */
const FULL = 1.5;
/** How fast the drawn frost catches up with the sim's, per second: quickly as it freezes, slowly as it thaws. */
const FREEZE_RATE = 6;
const THAW_RATE = 1.5;
/** How far over the ground (or water) the plates lie. */
const LIFT = 0.07;
/**
 * The plates' shades, thinnest to thickest frost, and the frost each takes
 * over at: a few flat steps rather than a gradient.
 */
const SHADES: [number, THREE.Color][] = [
  [0, new THREE.Color(0xb8d8ea)],
  [1.5, new THREE.Color(0xd2e8f4)],
  [3.5, new THREE.Color(0xeef8ff)],
];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Frosted ground (see game/frost.ts): a pale six-sided plate of ice over
 * each frozen cell, laid on a hexagonal lattice (every other row of cells
 * shifted half a cell across, and each plate stretched a little along the
 * rows to fill the square cells' spacing), so thick frost is a honeycomb of
 * plates with only thin seams between them, over water too. Plates grow
 * as the frost builds, and come in a few flat shades, whiter where it's
 * thick.
 *
 * What's drawn eases toward the sim's frost rather than jumping with it,
 * so an aura's edge, freezing and thawing a little every tick, doesn't
 * flicker.
 */
export class FrostGround {
  readonly root = new THREE.Group();
  private readonly plates: THREE.InstancedMesh;
  /** The frost as drawn, per cell, easing toward the sim's. */
  private shown: Float32Array | null = null;
  /** Cells drawn with some frost. */
  private live: number[] = [];
  private listed: Uint8Array | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'frost-ground';
    // Flat sides across the rows (along x), points along them (z): one cell wide, as tall as the lattice needs.
    const plate = new THREE.CircleGeometry(FROST_CELL / Math.sqrt(3), 6, Math.PI / 6).rotateX(-Math.PI / 2);
    const material = new THREE.MeshLambertMaterial({ transparent: true, opacity: OPACITY, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.plates = new THREE.InstancedMesh(plate, material, MOST);
    this.plates.count = 0;
    this.plates.frustumCulled = false;
    this.plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plates.renderOrder = 1;
    this.plates.userData.noShadow = true;
    this.root.add(this.plates);
  }

  update(seconds: number): void {
    const frost = this.game.ctx.frost;
    if (frost.count === 0 && this.live.length === 0) return;
    const n = frost.cols * frost.rows;
    if (!this.shown || this.shown.length !== n) {
      this.shown = new Float32Array(n);
      this.listed = new Uint8Array(n);
      this.live = [];
    }
    const shown = this.shown;
    const listed = this.listed!;
    frost.forEach((k) => {
      if (!listed[k]) {
        listed[k] = 1;
        this.live.push(k);
      }
    });
    const field = this.game.field;
    const cols = frost.cols;
    const next: number[] = [];
    let q = 0;
    for (const k of this.live) {
      const want = frost.frost[k];
      const rate = want > shown[k] ? FREEZE_RATE : THAW_RATE;
      shown[k] += (want - shown[k]) * Math.min(1, rate * seconds);
      if (want <= 0 && shown[k] < 0.02) {
        shown[k] = 0;
        listed[k] = 0;
        continue;
      }
      next.push(k);
      const amount = shown[k];
      if (amount < FROZEN * 0.5 || q >= MOST) continue;
      const c = frost.center(k);
      // Every other row a half cell across from the last: a quarter each way, so no plate strays far from its cell.
      const row = (k - (k % cols)) / cols;
      const x = c.x + (row % 2 === 0 ? -0.25 : 0.25) * FROST_CELL;
      const z = c.z;
      const lies = field.surfaceAt(x, z) < field.seaLevel;
      _p.set(x, Math.max(field.surfaceAt(x, z), field.seaLevel) + LIFT, z);
      // Tip each plate to the slope under it (flat on water), so it lies on the ground rather than cutting into it.
      const dx = lies ? 0 : field.surfaceAt(x + 0.5, z) - field.surfaceAt(x - 0.5, z);
      const dz = lies ? 0 : field.surfaceAt(x, z + 0.5) - field.surfaceAt(x, z - 0.5);
      _e.set(Math.atan(dz), 0, -Math.atan(dx), 'YXZ');
      _q.setFromEuler(_e);
      const size = FILL * (0.6 + 0.4 * Math.min(1, amount / FULL));
      // Stretched along the rows by 2/√3 so the rows, a cell apart, meet point to point.
      _s.set(size, 1, size * (2 / Math.sqrt(3)));
      _m.compose(_p, _q, _s);
      this.plates.setMatrixAt(q, _m);
      let shade = SHADES[0][1];
      for (const [from, colour] of SHADES) if (amount >= from) shade = colour;
      this.plates.setColorAt(q, shade);
      q++;
    }
    this.live = next;
    this.plates.count = q;
    this.plates.instanceMatrix.needsUpdate = true;
    if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.plates.dispose();
    this.plates.geometry.dispose();
    (this.plates.material as THREE.Material).dispose();
  }
}
