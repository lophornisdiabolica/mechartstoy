import * as THREE from 'three';
import { Game } from '../game/game';
import { GameEvents } from '../game/context';

/** Rings drawn at once, at most. */
const MOST = 64;
/** Steps a ring closes in by (stepped rather than smooth, and never flashing). */
const STEPS = 4;
/** How much wider than the strike a ring starts. */
const START = 1.8;
const RING = 0xff7a3a;
const LASER = 0xff5a2a;

interface Mark {
  e: GameEvents['strikeCalled'];
  /** Page sim time it was called at. */
  at: number;
  ring: THREE.Mesh;
  inner: THREE.Mesh;
  laser: THREE.Mesh;
}

/** Width of a ring's band, as a share of its radius (lines are only ever a pixel wide, so these are flat bands). */
const BAND = 0.09;
/** Thickness of the caller's targeting laser, world units. */
const LASER_WIDTH = 0.14;

/** A hexagonal band of outer radius 1, `band` wide, lying flat. */
function hexagon(band: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(1 - band, 1, 6, 1, Math.PI / 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Zenith's orbital strikes, before they land (see game/zenith.ts): a
 * hexagon ring on the ground where the beam will come down, closing in on
 * its true size in a few steps over the warning time, a small hexagon at
 * its middle, and the caller's targeting laser painting the spot. Bands
 * and bars rather than lines, so they read at any zoom; all steady:
 * nothing blinks.
 */
export class StrikeMarks {
  readonly root = new THREE.Group();
  private readonly marks: Mark[] = [];
  private readonly hex = hexagon(BAND);
  /** The small middle mark: a thicker band, since it's small. */
  private readonly dot = hexagon(BAND * 3);
  private readonly beam = new THREE.BoxGeometry(LASER_WIDTH, LASER_WIDTH, 1).translate(0, 0, 0.5);
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: RING, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  private readonly laserMat = new THREE.MeshBasicMaterial({ color: LASER, transparent: true, opacity: 0.6, depthWrite: false });
  private time = 0;
  private readonly off: () => void;

  constructor(private readonly game: Game) {
    this.root.name = 'strike-marks';
    this.off = game.events.on('strikeCalled', (e) => this.add(e));
  }

  private add(e: GameEvents['strikeCalled']): void {
    if (this.marks.length >= MOST) this.drop(0);
    const y = this.game.field.surfaceAt(e.x, e.z) + 0.15;
    const ring = new THREE.Mesh(this.hex, this.ringMat);
    ring.position.set(e.x, y, e.z);
    const inner = new THREE.Mesh(this.dot, this.ringMat);
    inner.position.set(e.x, y, e.z);
    inner.scale.setScalar(Math.max(0.4, e.radius * 0.18));
    // A thin bar from the caller's dish to the spot.
    const from = new THREE.Vector3(e.fromX, e.fromY, e.fromZ);
    const to = new THREE.Vector3(e.x, y, e.z);
    const laser = new THREE.Mesh(this.beam, this.laserMat);
    laser.position.copy(from);
    laser.lookAt(to);
    laser.scale.z = Math.max(0.01, from.distanceTo(to));
    for (const o of [ring, inner, laser]) {
      o.renderOrder = 3;
      o.userData.noShadow = true;
      this.root.add(o);
    }
    this.marks.push({ e, at: this.time, ring, inner, laser });
  }

  private drop(i: number): void {
    const m = this.marks[i];
    this.root.remove(m.ring, m.inner, m.laser);
    this.marks.splice(i, 1);
  }

  update(simSeconds: number): void {
    this.time += simSeconds;
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      const k = (this.time - m.at) / m.e.delay;
      if (k >= 1) {
        this.drop(i);
        continue;
      }
      // Closing in by steps: wide at first, its true size for the last step.
      const step = Math.min(STEPS - 1, Math.floor(k * STEPS));
      const scale = m.e.radius * (START - ((START - 1) * step) / (STEPS - 1));
      m.ring.scale.setScalar(scale);
      // The laser only while the caller is still painting (most of the wait).
      m.laser.visible = k < 0.85;
    }
  }

  dispose(): void {
    this.off();
    while (this.marks.length > 0) this.drop(0);
    this.hex.dispose();
    this.dot.dispose();
    this.beam.dispose();
    this.ringMat.dispose();
    this.laserMat.dispose();
  }
}
