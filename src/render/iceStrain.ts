import * as THREE from 'three';
import { Game } from '../game/game';
import { STRENGTH } from '../game/ice';

/** The strained ice's shade, and how dark it gets just before it gives way. */
const STRAINED = new THREE.Color(0x24384a);
const DARKEST = 0.7;
/** Strain (as a share of what breaks it) below which the ice doesn't darken at all. */
const UNMARKED = 0.12;
/** How far over the ice the shading lies. */
const LIFT = 0.015;
/** How fast the drawn shade catches up with the sim's strain, per second. */
const CATCH_UP = 4;

/**
 * The Frozen lake's ice darkening as it takes strain (see game/ice.ts): a
 * see-through dark sheet over each patch, deeper the nearer the patch is to
 * giving way, so a tank parked on it shows the ice going grey under it.
 * Nothing over holes.
 */
export class IceStrain {
  readonly root = new THREE.Group();
  private readonly mesh: THREE.Mesh | null = null;
  private readonly alpha: Float32Array;
  private readonly colors: THREE.BufferAttribute | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'ice-strain';
    const ice = game.ctx.ice;
    this.alpha = new Float32Array(ice?.cells.length ?? 0);
    if (!ice) return;
    const field = game.field;
    const { cols, cellSize } = field.config;
    const y = ice.sheet.level + LIFT;
    const n = ice.cells.length;
    const positions = new Float32Array(n * 6 * 3);
    const rgba = new Float32Array(n * 6 * 4);
    ice.cells.forEach((c, s) => {
      const i = c % cols;
      const j = (c - i) / cols;
      const x0 = field.bounds.minX + i * cellSize;
      const z0 = field.bounds.minZ + j * cellSize;
      const x1 = x0 + cellSize;
      const z1 = z0 + cellSize;
      // Two triangles, wound to face up.
      const corners = [x0, z0, x0, z1, x1, z1, x0, z0, x1, z1, x1, z0];
      for (let v = 0; v < 6; v++) {
        positions.set([corners[v * 2], y, corners[v * 2 + 1]], (s * 6 + v) * 3);
        rgba.set([STRAINED.r, STRAINED.g, STRAINED.b, 0], (s * 6 + v) * 4);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.colors = new THREE.BufferAttribute(rgba, 4);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', this.colors);
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  update(seconds: number): void {
    const ice = this.game.ctx.ice;
    if (!ice || !this.colors) return;
    const rgba = this.colors.array as Float32Array;
    const k = Math.min(1, seconds * CATCH_UP);
    let dirty = false;
    for (let s = 0; s < ice.cells.length; s++) {
      const hole = ice.refreezeAt[s] > 0;
      const share = hole ? 0 : Math.min(1, ice.strain[s] / STRENGTH);
      const t = Math.max(0, (share - UNMARKED) / (1 - UNMARKED));
      // A hole's shade goes at once; strain's eases in.
      const want = DARKEST * t * t * (3 - 2 * t);
      const was = this.alpha[s];
      const now = hole ? 0 : was + (want - was) * k;
      if (Math.abs(now - was) < 0.002) continue;
      this.alpha[s] = now;
      for (let v = 0; v < 6; v++) rgba[(s * 6 + v) * 4 + 3] = now;
      dirty = true;
    }
    if (dirty) this.colors.needsUpdate = true;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
