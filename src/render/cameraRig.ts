import * as THREE from 'three';
import { Bounds } from '../world/battlefield';

/**
 * Isometric orthographic camera that orbits a ground target.
 *
 * Controls: WASD / arrows pan, right- or middle-drag pans, wheel zooms,
 * Q / E rotate in 90 degree steps. Left mouse is left free for game
 * interaction (step 4). Touch: one-finger drag pans.
 */
export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  /** Ground point the camera looks at. */
  readonly target = new THREE.Vector3();

  /** Classic isometric elevation, about 35.26 degrees. */
  elevation = Math.atan(1 / Math.SQRT2);
  azimuth = Math.PI / 4;
  zoom = 1;
  minZoom = 0.6;
  maxZoom = 4;
  /** World units visible vertically at zoom 1. */
  viewHeight = 70;
  panSpeed = 40;

  private targetAzimuth = this.azimuth;
  private targetZoom = this.zoom;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number } | null = null;
  private aspect = 1;

  constructor(
    private readonly dom: HTMLElement,
    private readonly bounds: Bounds,
  ) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.bindInput();
  }

  setSize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.updateProjection();
  }

  update(frameSeconds: number): void {
    const dt = Math.min(frameSeconds, 0.1);

    let fx = 0;
    let fy = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) fy += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) fy -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) fx += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) fx -= 1;
    if (fx || fy) this.panScreen(fx * this.panSpeed * dt / this.zoom, fy * this.panSpeed * dt / this.zoom);

    const k = 1 - Math.exp(-dt * 10);
    this.azimuth += (this.targetAzimuth - this.azimuth) * k;
    this.zoom += (this.targetZoom - this.zoom) * k;

    const dist = 200;
    const ce = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + Math.cos(this.azimuth) * ce * dist,
      this.target.y + Math.sin(this.elevation) * dist,
      this.target.z + Math.sin(this.azimuth) * ce * dist,
    );
    this.camera.lookAt(this.target);
    this.updateProjection();
  }

  /** Move the target by an amount expressed in screen directions (right, up). */
  panScreen(right: number, up: number): void {
    // Screen-right and screen-up projected onto the ground plane.
    const rx = Math.sin(this.azimuth);
    const rz = -Math.cos(this.azimuth);
    const ux = -Math.cos(this.azimuth);
    const uz = -Math.sin(this.azimuth);
    // Ground distance per screen-up unit is stretched by the view's tilt.
    const upScale = 1 / Math.sin(this.elevation);
    this.target.x += rx * right + ux * up * upScale;
    this.target.z += rz * right + uz * up * upScale;
    this.target.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.target.x));
    this.target.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.target.z));
  }

  private updateProjection(): void {
    const h = this.viewHeight / this.zoom / 2;
    const w = h * this.aspect;
    this.camera.left = -w;
    this.camera.right = w;
    this.camera.top = h;
    this.camera.bottom = -h;
    this.camera.updateProjectionMatrix();
  }

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (key === 'q') this.targetAzimuth -= Math.PI / 2;
      if (key === 'e') this.targetAzimuth += Math.PI / 2;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.dom.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2 || e.pointerType === 'touch') {
        this.drag = { x: e.clientX, y: e.clientY };
        this.dom.setPointerCapture(e.pointerId);
      }
    });
    this.dom.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const worldPerPixel = this.viewHeight / this.zoom / this.dom.clientHeight;
      this.panScreen(-(e.clientX - this.drag.x) * worldPerPixel, (e.clientY - this.drag.y) * worldPerPixel);
      this.drag = { x: e.clientX, y: e.clientY };
    });
    const endDrag = () => (this.drag = null);
    this.dom.addEventListener('pointerup', endDrag);
    this.dom.addEventListener('pointercancel', endDrag);

    this.dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.targetZoom * Math.exp(-e.deltaY * 0.0015)));
      },
      { passive: false },
    );
  }
}
