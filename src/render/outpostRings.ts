import * as THREE from 'three';
import { Game } from '../game/game';
import { CAPTURE_RADIUS } from '../game/outposts';
import { Battlefield } from '../world/battlefield';
import { factionColors } from './models';
import { RoadTops } from './roadTops';
import { meshHeightAt } from './terrainMesh';

const SEGMENTS = 64;
const WIDTH = 0.45;

/**
 * The height of whatever is drawn at (x, z): the ground (or water) or a road on it,
 * whichever is higher. Roads stand up to a few tenths above the ground and
 * the ground mesh's triangles don't quite follow surfaceAt, so a ring at a
 * fixed height over surfaceAt dipped in and out of them and flickered.
 */
function drawnHeight(field: Battlefield, roads: RoadTops, x: number, z: number): number {
  return Math.max(meshHeightAt(field, x, z), field.surfaceAt(x, z), roads.at(x, z));
}

/**
 * A flat ring round (x, z) that sits over the ground and roads, built as one
 * quad per segment so a draw range can show part of it. Each corner takes the
 * highest point from it to halfway to its neighbours, so the straight edges
 * between corners don't cut through a bump or a road's crown.
 */
function groundRing(field: Battlefield, roads: RoadTops, x: number, z: number, radius: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const index: number[] = [];
  const at = (a: number, r: number) => drawnHeight(field, roads, x + Math.cos(a) * r, z + Math.sin(a) * r);
  const step = (Math.PI * 2) / SEGMENTS;
  for (let i = 0; i <= SEGMENTS; i++) {
    // Clockwise from the top, as seen from above, like a clock filling up.
    const a = -Math.PI / 2 + i * step;
    for (const r of [radius - WIDTH, radius]) {
      let y = -Infinity;
      for (const da of [-step / 2, 0, step / 2]) for (const dr of [-WIDTH / 2, 0, WIDTH / 2]) y = Math.max(y, at(a + da, r + dr));
      pos.push(x + Math.cos(a) * r, y + lift, z + Math.sin(a) * r);
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

  private readonly stop: () => void;

  /** `terrain` is the drawn ground and roads (see buildTerrain), whose roads the rings sit on. */
  constructor(private readonly game: Game, terrain: THREE.Object3D) {
    this.root.name = 'outpost-rings';
    const surfaces: RoadTops = terrain.userData.roadTops ?? new RoadTops();
    const ownerRing = (o: { x: number; z: number }) => groundRing(game.field, surfaces, o.x, o.z, CAPTURE_RADIUS, 0.08);
    const progressRing = (o: { x: number; z: number }) => groundRing(game.field, surfaces, o.x, o.z, CAPTURE_RADIUS + WIDTH * 1.2, 0.1);
    this.rings = game.ctx.outposts.map((o) => {
      // Pulled toward the camera a little too, like the roads, for what's left of a near tie.
      const material = () => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
      const owner = new THREE.Mesh(ownerRing(o), material());
      (owner.material as THREE.MeshBasicMaterial).opacity = 0.45;
      const progress = new THREE.Mesh(progressRing(o), material());
      (progress.material as THREE.MeshBasicMaterial).opacity = 0.9;
      for (const m of [owner, progress]) {
        m.renderOrder = 2;
        m.userData.noShadow = true;
        this.root.add(m);
      }
      return { owner, progress, shown: { owner: NaN, claimant: NaN } };
    });
    // Craters and god powers move the ground and the roads on it, so rings near a change are rebuilt to sit on the new surface.
    // (The terrain listens first, so its roads are already redrawn by now.)
    this.stop = game.field.onChange((area) => {
      const reach = CAPTURE_RADIUS + WIDTH * 3;
      game.ctx.outposts.forEach((o, i) => {
        const [i0, j0] = game.field.cellAt(o.x - reach, o.z - reach);
        const [i1, j1] = game.field.cellAt(o.x + reach, o.z + reach);
        if (area.i1 < i0 || area.i0 > i1 || area.j1 < j0 || area.j0 > j1) return;
        const ring = this.rings[i];
        const range = ring.progress.geometry.drawRange.count;
        ring.owner.geometry.dispose();
        ring.owner.geometry = ownerRing(o);
        ring.progress.geometry.dispose();
        ring.progress.geometry = progressRing(o);
        ring.progress.geometry.setDrawRange(0, range);
      });
    });
  }

  dispose(): void {
    this.stop();
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
