import * as THREE from 'three';
import { FROST_CELL, FROZEN } from '../game/frost';
import { Game } from '../game/game';

/** Most frosted cells drawn at once. */
const MOST = 8000;
/** Frost at which a patch is at its whitest and most solid. */
const THICK = 4;
/** How opaque the thickest frost is: the shape of the ground still shows through. */
const MOST_OPAQUE = 0.62;
/** How fast the drawn frost catches up with the sim's, per second: quickly as it freezes, slowly as it thaws. */
const FREEZE_RATE = 6;
const THAW_RATE = 1.5;
/** How far over the ground (or water) the sheet lies. */
const LIFT = 0.07;

const RIME = new THREE.Color(0xeef8ff);
const THIN = new THREE.Color(0xb8d8ea);
const _c = new THREE.Color();

/**
 * Frosted ground (see game/frost.ts), drawn as one continuous sheet of ice
 * laid over the frozen cells: each cell is a quad whose corners take the
 * average of the cells round them, so neighbouring cells meet without
 * seams, thick frost covers the ground (and water) completely, and the
 * edges fade out softly. The sheet is see-through enough that the shape of
 * the ground still shows.
 *
 * What's drawn eases toward the sim's frost rather than jumping with it,
 * so an aura's edge, freezing and thawing a little every tick, doesn't
 * flicker.
 */
export class FrostGround {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MOST * 4 * 3);
  private readonly colors = new Float32Array(MOST * 4 * 4);
  /** The frost as drawn, per cell, easing toward the sim's. */
  private shown: Float32Array | null = null;
  /** Cells drawn with some frost. */
  private live: number[] = [];
  private listed: Uint8Array | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'frost-ground';
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    // The sheet lies along the ground: lit as if flat, which it nearly is.
    const normals = new Float32Array(MOST * 4 * 3);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    const index = new Uint32Array(MOST * 6);
    for (let i = 0; i < MOST; i++) index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
    this.geometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.userData.noShadow = true;
    this.root.add(this.mesh);
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
    // Ease what's drawn toward the sim's frost.
    frost.forEach((k) => {
      if (!listed[k]) {
        listed[k] = 1;
        this.live.push(k);
      }
    });
    const next: number[] = [];
    for (const k of this.live) {
      const want = frost.frost[k];
      const rate = want > shown[k] ? FREEZE_RATE : THAW_RATE;
      shown[k] += (want - shown[k]) * Math.min(1, rate * seconds);
      if (want <= 0 && shown[k] < 0.02) {
        shown[k] = 0;
        listed[k] = 0;
      } else next.push(k);
    }
    this.live = next;

    const field = this.game.field;
    const cols = frost.cols;
    const rows = frost.rows;
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : shown[j * cols + i]);
    // A corner's frost: the average of the four cells round it.
    const corner = (i: number, j: number) => (at(i - 1, j - 1) + at(i, j - 1) + at(i - 1, j) + at(i, j)) / 4;
    let q = 0;
    for (const k of this.live) {
      if (q >= MOST) break;
      if (shown[k] < FROZEN * 0.3) continue;
      const i = k % cols;
      const j = (k - i) / cols;
      const c = frost.center(k);
      const x0 = c.x - FROST_CELL / 2;
      const z0 = c.z - FROST_CELL / 2;
      for (let v = 0; v < 4; v++) {
        const ci = i + (v & 1);
        const cj = j + (v >> 1);
        const x = x0 + (v & 1) * FROST_CELL;
        const z = z0 + (v >> 1) * FROST_CELL;
        const p = (q * 4 + v) * 3;
        this.positions[p] = x;
        this.positions[p + 1] = Math.max(field.surfaceAt(x, z), field.seaLevel) + LIFT;
        this.positions[p + 2] = z;
        const amount = corner(ci, cj);
        const thick = Math.min(1, amount / THICK);
        _c.copy(THIN).lerp(RIME, thick);
        const o = (q * 4 + v) * 4;
        this.colors[o] = _c.r;
        this.colors[o + 1] = _c.g;
        this.colors[o + 2] = _c.b;
        // Fades in from nothing at FROZEN's edge to its most where it's thick.
        this.colors[o + 3] = MOST_OPAQUE * Math.min(1, Math.max(0, (amount - FROZEN * 0.3) / (THICK * 0.5)));
      }
      q++;
    }
    this.geometry.setDrawRange(0, q * 6);
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
