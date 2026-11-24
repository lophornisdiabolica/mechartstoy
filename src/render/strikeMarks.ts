import * as THREE from 'three';
import { Game } from '../game/game';
import { GameEvents } from '../game/context';

/** Rings drawn at once, at most. */
const MOST = 64;
/** Steps the inner triangle grows by (stepped rather than smooth, and never flashing). */
const STEPS = 4;
/** How big the inner triangle starts, as a share of the strike's radius. */
const START = 0.25;
/** Seconds before it lands that the beam comes down from the sky. */
const DROP = 0.35;
/** How high the beam's foot starts, above the ground. */
const DROP_FROM = 60;
const RING = 0xff7a3a;
const LASER = 0xff5a2a;

interface Mark {
  e: GameEvents['strikeCalled'];
  /** Page sim time it was called at. */
  at: number;
  ring: THREE.Mesh;
  inner: THREE.Mesh;
  laser: THREE.Mesh;
  beam: THREE.Group;
  /** Where the ground is under it. */
  y: number;
}

/** Width of a ring's band, as a share of its radius (lines are only ever a pixel wide, so these are flat bands). */
const BAND = 0.09;
/** Thickness of the caller's targeting laser, world units. */
const LASER_WIDTH = 0.14;

/** A band of outer radius 1 with `sides` corners (6, a hexagon; 3, a triangle), `band` wide, lying flat. */
function polygon(sides: number, band: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(1 - band, 1, sides, 1, Math.PI / 6);
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * Zenith's orbital strikes, before they land (see game/zenith.ts): a
 * hexagon on the ground the size of the blast, a triangle inside it that
 * grows in a few steps over the warning time until its corners meet the
 * hexagon's, and the caller's targeting laser painting the spot. Bands and
 * bars rather than lines, so they read at any zoom; all steady: nothing
 * blinks. Just before it lands, the beam comes down out of the sky (drawn
 * here, every frame, so it falls smoothly).
 */
export class StrikeMarks {
  readonly root = new THREE.Group();
  private readonly marks: Mark[] = [];
  private readonly hex = polygon(6, BAND);
  /** The growing triangle: a thicker band, since it starts small. */
  private readonly tri = polygon(3, BAND * 2);
  private readonly bar = new THREE.BoxGeometry(LASER_WIDTH, LASER_WIDTH, 1).translate(0, 0, 0.5);
  /** The beam: a white-hot core in a wider glow, its foot at the origin. */
  private readonly core = new THREE.BoxGeometry(0.35, 16.4, 0.35).translate(0, 8, 0);
  private readonly glow = new THREE.BoxGeometry(0.9, 16, 0.9).translate(0, 8, 0);
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0xffb860 });
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
    ring.scale.setScalar(e.radius);
    const inner = new THREE.Mesh(this.tri, this.ringMat);
    inner.position.set(e.x, y, e.z);
    inner.scale.setScalar(e.radius * START);
    // A thin bar from the caller's dish to the spot.
    const from = new THREE.Vector3(e.fromX, e.fromY, e.fromZ);
    const to = new THREE.Vector3(e.x, y, e.z);
    const laser = new THREE.Mesh(this.bar, this.laserMat);
    laser.position.copy(from);
    laser.lookAt(to);
    laser.scale.z = Math.max(0.01, from.distanceTo(to));
    const beam = new THREE.Group();
    beam.add(new THREE.Mesh(this.glow, this.glowMat), new THREE.Mesh(this.core, this.coreMat));
    beam.position.set(e.x, y, e.z);
    beam.visible = false;
    for (const o of [ring, inner, laser, beam]) {
      o.renderOrder = 3;
      o.userData.noShadow = true;
      this.root.add(o);
    }
    this.marks.push({ e, at: this.time, ring, inner, laser, beam, y });
  }

  private drop(i: number): void {
    const m = this.marks[i];
    this.root.remove(m.ring, m.inner, m.laser, m.beam);
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
      // The triangle grows by steps: small at first, its corners on the hexagon's for the last step.
      const step = Math.min(STEPS - 1, Math.floor(k * STEPS));
      m.inner.scale.setScalar(m.e.radius * (START + ((1 - START) * step) / (STEPS - 1)));
      // The laser only while the caller is still painting (most of the wait).
      m.laser.visible = k < 0.85;
      // The beam, only for the last moment, falling straight down.
      const left = m.e.delay - (this.time - m.at);
      m.beam.visible = left < DROP;
      if (m.beam.visible) m.beam.position.y = m.y + DROP_FROM * Math.max(0, left / DROP);
    }
  }

  dispose(): void {
    this.off();
    while (this.marks.length > 0) this.drop(0);
    this.hex.dispose();
    this.tri.dispose();
    this.bar.dispose();
    this.core.dispose();
    this.glow.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.ringMat.dispose();
    this.laserMat.dispose();
  }
}
