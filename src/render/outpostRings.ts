import * as THREE from 'three';
import { Game } from '../game/game';
import { CAPTURE_RADIUS } from '../game/outposts';
import { Battlefield } from '../world/battlefield';
import { factionColors } from './models';

const SEGMENTS = 64;
const WIDTH = 0.45;

/** A flat ring round (x, z) that follows the ground, built as one quad per segment so a draw range can show part of it. */
function groundRing(field: Battlefield, x: number, z: number, radius: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    // Clockwise from the top, as seen from above, like a clock filling up.
    const a = -Math.PI / 2 + (i / SEGMENTS) * Math.PI * 2;
    for (const r of [radius - WIDTH, radius]) {
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      pos.push(px, field.surfaceAt(px, pz) + lift, pz);
    }
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const k = i * 2;
    index.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/**
 * The capture ring round each outpost: a faint ring in the holder's colour,
 * and an arc in the capturing side's colour that fills as they take it.
 * Purely visual.
 */
export class OutpostRings {
  readonly root = new THREE.Group();
  private readonly rings: { owner: THREE.Mesh; progress: THREE.Mesh; shown: { owner: number; claimant: number } }[];

  constructor(private readonly game: Game) {
    this.root.name = 'outpost-rings';
    this.rings = game.ctx.outposts.map((o) => {
      const material = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const owner = new THREE.Mesh(groundRing(game.field, o.x, o.z, CAPTURE_RADIUS, 0.08), material());
      (owner.material as THREE.MeshBasicMaterial).opacity = 0.45;
      const progress = new THREE.Mesh(groundRing(game.field, o.x, o.z, CAPTURE_RADIUS + WIDTH * 1.2, 0.1), material());
      (progress.material as THREE.MeshBasicMaterial).opacity = 0.9;
      for (const m of [owner, progress]) {
        m.renderOrder = 2;
        m.userData.noShadow = true;
        this.root.add(m);
      }
      return { owner, progress, shown: { owner: NaN, claimant: NaN } };
    });
  }

  update(): void {
    this.game.ctx.outposts.forEach((o, i) => {
      const ring = this.rings[i];
      if (ring.shown.owner !== o.owner) {
        (ring.owner.material as THREE.MeshBasicMaterial).color.setHex(factionColors(o.owner).primary);
        ring.shown.owner = o.owner;
      }
      if (o.claimant >= 0 && ring.shown.claimant !== o.claimant) {
        (ring.progress.material as THREE.MeshBasicMaterial).color.setHex(factionColors(o.claimant).primary);
        ring.shown.claimant = o.claimant;
      }
      ring.progress.visible = o.progress > 0 && o.claimant >= 0;
      ring.progress.geometry.setDrawRange(0, Math.ceil(o.progress * SEGMENTS) * 6);
    });
  }
}
