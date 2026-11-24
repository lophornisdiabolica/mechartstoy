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
  ring: THREE.LineLoop;
  inner: THREE.LineLoop;
  laser: THREE.Line;
}

/** A hexagon of radius 1, lying flat. */
function hexagon(): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pts.push(Math.cos(a), 0, Math.sin(a));
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
}

/**
 * Zenith's orbital strikes, before they land (see game/zenith.ts): a
 * hexagon ring on the ground where the beam will come down, closing in on
 * its true size in a few steps over the warning time, a small hexagon at
 * its middle, and the caller's targeting laser painting the spot. All
 * steady lines: nothing blinks.
 */
export class StrikeMarks {
  readonly root = new THREE.Group();
  private readonly marks: Mark[] = [];
  private readonly hex = hexagon();
  private readonly ringMat = new THREE.LineBasicMaterial({ color: RING, transparent: true, opacity: 0.85, depthWrite: false });
  private readonly laserMat = new THREE.LineBasicMaterial({ color: LASER, transparent: true, opacity: 0.6, depthWrite: false });
  private time = 0;
  private readonly off: () => void;

  constructor(private readonly game: Game) {
    this.root.name = 'strike-marks';
    this.off = game.events.on('strikeCalled', (e) => this.add(e));
  }

  private add(e: GameEvents['strikeCalled']): void {
    if (this.marks.length >= MOST) this.drop(0);
    const y = this.game.field.surfaceAt(e.x, e.z) + 0.15;
    const ring = new THREE.LineLoop(this.hex, this.ringMat);
    ring.position.set(e.x, y, e.z);
    const inner = new THREE.LineLoop(this.hex, this.ringMat);
    inner.position.set(e.x, y, e.z);
    inner.scale.setScalar(Math.max(0.4, e.radius * 0.18));
    const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(e.fromX, e.fromY, e.fromZ), new THREE.Vector3(e.x, y, e.z)]), this.laserMat);
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
    m.laser.geometry.dispose();
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
    this.ringMat.dispose();
    this.laserMat.dispose();
  }
}
