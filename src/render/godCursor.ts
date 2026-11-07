import * as THREE from 'three';
import { Battlefield } from '../world/battlefield';

/** Points in the outline. */
const MAX_POINTS = 256;

/**
 * Where a god power will land, draped over the ground: a ring for brushes,
 * quakes and the big bomb, a strip for an airstrike's line, a bridge or a
 * wall. Drawn over everything so hills don't hide it.
 */
export class GodCursor {
  readonly root: THREE.LineLoop;
  private readonly positions = new Float32Array(MAX_POINTS * 3);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  private field: Battlefield | null = null;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);
    this.root = new THREE.LineLoop(this.geometry, this.material);
    this.root.name = 'godCursor';
    this.root.frustumCulled = false;
    this.root.renderOrder = 10;
    this.root.visible = false;
  }

  attach(field: Battlefield): void {
    this.field = field;
    this.hide();
  }

  hide(): void {
    this.root.visible = false;
  }

  circle(x: number, z: number, radius: number, color: number): void {
    const n = 72;
    const pts: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push([x + Math.cos(a) * radius, z + Math.sin(a) * radius]);
    }
    this.draw(pts, color);
  }

  /** A strip `width` wide from (ax, az) to (bx, bz). */
  line(ax: number, az: number, bx: number, bz: number, width: number, color: number): void {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) return this.circle(ax, az, width / 2, color);
    const nx = (-(bz - az) / len) * (width / 2);
    const nz = ((bx - ax) / len) * (width / 2);
    const steps = Math.min(100, Math.max(2, Math.ceil(len / 1.5)));
    const pts: [number, number][] = [];
    for (let k = 0; k <= steps; k++) pts.push([ax + ((bx - ax) * k) / steps + nx, az + ((bz - az) * k) / steps + nz]);
    for (let k = steps; k >= 0; k--) pts.push([ax + ((bx - ax) * k) / steps - nx, az + ((bz - az) * k) / steps - nz]);
    this.draw(pts, color);
  }

  private draw(pts: [number, number][], color: number): void {
    const field = this.field;
    if (!field) return;
    const n = Math.min(MAX_POINTS, pts.length);
    for (let k = 0; k < n; k++) {
      const [x, z] = pts[k];
      const h = field.surfaceAt(x, z);
      this.positions[k * 3] = x;
      this.positions[k * 3 + 1] = (Number.isFinite(h) ? h : field.seaLevel) + 0.2;
      this.positions[k * 3 + 2] = z;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.material.color.set(color);
    this.root.visible = true;
  }
}
