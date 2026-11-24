import * as THREE from 'three';
import { uploadInstances } from './upload';
import { FROST_CELL, FROZEN, FrostField } from '../game/frost';
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
/** How far over the ground (or water) the plates' undersides lie, and how thick they are, so a plate tipped on a slope still shows its edge. */
const LIFT = 0.02;
const THICK = 0.08;
/**
 * The plates' shades, thinnest to thickest frost, and the frost each takes
 * over at: a few flat steps rather than a gradient.
 */
export const FROST_SHADES: [number, THREE.Color][] = [
  [0, new THREE.Color(0xb8d8ea)],
  [1.5, new THREE.Color(0xd2e8f4)],
  [3.5, new THREE.Color(0xeef8ff)],
];
/** Verdant's tangle (see game/verdant.ts): dark mats of vine, darker and denser as it thickens. */
export const TANGLE_SHADES: [number, THREE.Color][] = [
  [0, new THREE.Color(0x5e8a3a)],
  [1.5, new THREE.Color(0x4a7430)],
  [3.5, new THREE.Color(0x365a26)],
];

/** What a ground of plates draws: which field, in which shades, how see-through. */
export interface PatchLook {
  name: string;
  field: (game: Game) => FrostField;
  shades: [number, THREE.Color][];
  opacity: number;
}

export const FROST_LOOK: PatchLook = { name: 'frost-ground', field: (g) => g.ctx.frost, shades: FROST_SHADES, opacity: OPACITY };
export const TANGLE_LOOK: PatchLook = { name: 'tangle-ground', field: (g) => g.ctx.tangle, shades: TANGLE_SHADES, opacity: 0.8 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * Frosted ground (see game/frost.ts): a pale six-sided slab of ice over
 * each frozen cell, laid on a hexagonal lattice (every other row of cells
 * shifted half a cell across, and each plate stretched a little along the
 * rows to fill the square cells' spacing), so thick frost is a honeycomb of
 * plates with only thin seams between them, over water too. Plates grow
 * as the frost builds, and come in a few flat shades, whiter where it's
 * thick.
 *
 * What's drawn eases toward the sim's frost rather than jumping with it,
 * so an aura's edge, freezing and thawing a little every tick, doesn't
 * flicker. Verdant's tangle is drawn the same way in dark greens (TANGLE_LOOK).
 */
export class FrostGround {
  readonly root = new THREE.Group();
  private readonly plates: THREE.InstancedMesh;
  /** The frost as drawn, per cell, easing toward the sim's. */
  private shown: Float32Array | null = null;
  /** Cells drawn with some frost. */
  private live: number[] = [];
  private listed: Uint8Array | null = null;

  constructor(
    private readonly game: Game,
    private readonly look: PatchLook = FROST_LOOK,
  ) {
    this.root.name = look.name;
    // A thin six-sided slab, flat sides across the rows (along x), points along them (z): one cell wide, as tall as the lattice needs.
    const plate = new THREE.CylinderGeometry(FROST_CELL / Math.sqrt(3), FROST_CELL / Math.sqrt(3), THICK, 6).translate(0, THICK / 2, 0);
    const material = new THREE.MeshLambertMaterial({ flatShading: true, transparent: true, opacity: look.opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.plates = new THREE.InstancedMesh(plate, material, MOST);
    this.plates.count = 0;
    this.plates.frustumCulled = false;
    this.plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plates.renderOrder = 1;
    this.plates.userData.noShadow = true;
    this.root.add(this.plates);
  }

  update(seconds: number): void {
    const frost = this.look.field(this.game);
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
      _e.set(-Math.atan(dz), 0, Math.atan(dx), 'YXZ');
      _q.setFromEuler(_e);
      const size = FILL * (0.6 + 0.4 * Math.min(1, amount / FULL));
      // Stretched along the rows by 2/√3 so the rows, a cell apart, meet point to point.
      _s.set(size, 1, size * (2 / Math.sqrt(3)));
      _m.compose(_p, _q, _s);
      this.plates.setMatrixAt(q, _m);
      const shades = this.look.shades;
      let shade = shades[0][1];
      for (const [from, colour] of shades) if (amount >= from) shade = colour;
      this.plates.setColorAt(q, shade);
      q++;
    }
    this.live = next;
    this.plates.count = q;
    uploadInstances(this.plates);
  }

  dispose(): void {
    this.plates.dispose();
    this.plates.geometry.dispose();
    (this.plates.material as THREE.Material).dispose();
  }
}
