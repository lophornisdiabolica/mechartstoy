import * as THREE from 'three';
import { Game } from '../game/game';
import { MAX_WRECKAGE, WRECKAGE_CELL } from '../game/wreckage';

/** Pieces of junk per tank-sized wreck of wreckage on a cell. */
const PIECES_PER = 6;
/** Most pieces drawn on one cell (a full one). */
const MOST_PER_CELL = Math.ceil(MAX_WRECKAGE * PIECES_PER);
/** Most pieces drawn at once, of each shape. */
const MOST = 24000;
/** How fast the drawn wreckage catches up with the sim's, per second: piling on quickly, rusting away and being eaten slowly enough to watch. */
const GROW_RATE = 3;
const SHRINK_RATE = 1.2;
/** Seconds between redraws of the pieces (they only change as wreckage comes and goes). */
const REDRAW = 0.2;
/** Size of the pieces next to the sizes below: smaller and more of them reads as a heap rather than a few stray bits. */
const PIECE_SCALE = 0.8;
/** How high a full cell's heap rises, world units. */
const HEAP = 0.55;

/** Charred metal, burnt paint, rust and a little bare steel: a few flat shades, as the hulks are drawn. */
const SHADES = [0x2a2623, 0x332e2a, 0x3d3832, 0x4a443d, 0x5b3a26, 0x6e4528, 0x585d61, 0x6b7074].map((c) => new THREE.Color(c));

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** A cheap repeatable random number for a cell's piece, 0 to 1. */
function hash(k: number, i: number, salt: number): number {
  let h = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(i + 7, 0x85ebca6b) ^ Math.imul(salt + 3, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * The wreckage on the ground (see game/wreckage.ts), drawn as heaps of
 * junk: torn armour plates, bent girders, wheels and drums, chunks of hull,
 * in char, rust and bare steel. Each cell's pieces are always the same ones
 * in the same places (picked from the cell), so a heap grows by adding
 * pieces on top as more wrecks fall apart there, and shrinks a piece at a
 * time as it rusts away or is eaten, never reshuffling. A full cell is a
 * knee-high heap; a much-fought field is a scrapyard.
 *
 * Two instanced meshes (boxes and cylinders) draw every piece, so a big
 * scrapyard is two draw calls.
 */
export class WreckageGround {
  readonly root = new THREE.Group();
  private readonly boxes: THREE.InstancedMesh;
  private readonly drums: THREE.InstancedMesh;
  /** The wreckage as drawn, per cell, easing toward the sim's. */
  private shown: Float32Array | null = null;
  private listed: Uint8Array | null = null;
  private live: number[] = [];
  private sinceDraw = REDRAW;
  /** Pieces drawn per cell at the last redraw: a redraw is needed only when one changes. */
  private drawnCount: Uint8Array | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'wreckage';
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    this.boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, MOST);
    this.drums = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 7), material, MOST);
    for (const m of [this.boxes, this.drums]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m);
    }
  }

  /** Pieces drawn now (for tests and the stats readout). */
  get pieces(): number {
    return this.boxes.count + this.drums.count;
  }

  update(seconds: number): void {
    const wreckage = this.game.ctx.wreckage;
    if (wreckage.count === 0 && this.live.length === 0) return;
    const n = wreckage.cols * wreckage.rows;
    if (!this.shown || this.shown.length !== n) {
      this.shown = new Float32Array(n);
      this.listed = new Uint8Array(n);
      this.drawnCount = new Uint8Array(n);
      this.live = [];
    }
    const shown = this.shown;
    const listed = this.listed!;
    const drawn = this.drawnCount!;
    wreckage.forEach((k) => {
      if (!listed[k]) {
        listed[k] = 1;
        this.live.push(k);
      }
    });
    let changed = false;
    const next: number[] = [];
    for (const k of this.live) {
      const want = wreckage.mass[k];
      const rate = want > shown[k] ? GROW_RATE : SHRINK_RATE;
      shown[k] += (want - shown[k]) * Math.min(1, rate * seconds);
      const count = Math.min(MOST_PER_CELL, Math.floor(shown[k] * PIECES_PER + 0.35));
      if (count !== drawn[k]) changed = true;
      if (want <= 0 && count === 0) {
        shown[k] = 0;
        listed[k] = 0;
        drawn[k] = 0;
        continue;
      }
      next.push(k);
    }
    this.live = next;
    this.sinceDraw += seconds;
    if (!changed || this.sinceDraw < REDRAW) return;
    this.sinceDraw = 0;
    this.draw();
  }

  /** Lay out every piece on every cell again. */
  private draw(): void {
    const wreckage = this.game.ctx.wreckage;
    const field = this.game.field;
    const shown = this.shown!;
    const drawn = this.drawnCount!;
    let b = 0;
    let d = 0;
    for (const k of this.live) {
      const count = Math.min(MOST_PER_CELL, Math.floor(shown[k] * PIECES_PER + 0.35));
      drawn[k] = count;
      if (count === 0) continue;
      const c = wreckage.center(k);
      // The heap rises toward the middle of the cell, more so the fuller it is.
      const heap = HEAP * Math.min(1, shown[k] / MAX_WRECKAGE);
      for (let i = 0; i < count; i++) {
        const r = (salt: number) => hash(k, i, salt);
        // The first pieces lie in a clump in the middle; later ones land further out and on top,
        // so a heap's footprint and height both grow as it fills. Each piece always lands in the same place.
        const fill = i / MOST_PER_CELL;
        const reach = WRECKAGE_CELL * (0.18 + 0.52 * Math.sqrt(fill));
        const angle = r(1) * Math.PI * 2;
        const dist = reach * Math.sqrt(r(2));
        const x = c.x + Math.cos(angle) * dist;
        const z = c.z + Math.sin(angle) * dist;
        const ground = field.surfaceAt(x, z);
        // Nothing lies on water: pieces of a shoreline heap that would land in it are left out.
        if (ground < field.seaLevel) continue;
        const kind = r(3);
        const shade = SHADES[Math.floor(r(4) * SHADES.length)];
        // Tipped every which way, but mostly lying down.
        _e.set((r(5) - 0.5) * 1.1, r(6) * Math.PI * 2, (r(7) - 0.5) * 1.1, 'YXZ');
        _q.setFromEuler(_e);
        let drum = false;
        if (kind < 0.38) {
          // A torn armour plate.
          _s.set(0.35 + r(8) * 0.45, 0.05 + r(9) * 0.04, 0.25 + r(10) * 0.35);
        } else if (kind < 0.58) {
          // A bent girder or barrel.
          _s.set(0.6 + r(8) * 0.6, 0.07 + r(9) * 0.05, 0.07 + r(10) * 0.05);
        } else if (kind < 0.82) {
          // A chunk of hull.
          const size = 0.16 + r(8) * 0.22;
          _s.set(size * (0.8 + r(9) * 0.6), size * (0.6 + r(10) * 0.5), size);
        } else {
          // A road wheel or a drum: squat or tall.
          drum = true;
          const rad = 0.14 + r(8) * 0.16;
          _s.set(rad * 2, rad * (r(9) < 0.5 ? 0.7 : 2.2), rad * 2);
        }
        // Higher toward the middle of the heap, and the fuller it is.
        const lift = heap * Math.sqrt(fill) * (1 - dist / (WRECKAGE_CELL * 0.75)) * (0.6 + r(11) * 0.4);
        _p.set(x, ground + lift + _s.y * 0.3, z);
        _s.multiplyScalar(PIECE_SCALE);
        _m.compose(_p, _q, _s);
        if (drum) {
          if (d >= MOST) continue;
          this.drums.setMatrixAt(d, _m);
          this.drums.setColorAt(d, shade);
          d++;
        } else {
          if (b >= MOST) continue;
          this.boxes.setMatrixAt(b, _m);
          this.boxes.setColorAt(b, shade);
          b++;
        }
      }
    }
    this.boxes.count = b;
    this.drums.count = d;
    for (const m of [this.boxes, this.drums]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const m of [this.boxes, this.drums]) {
      m.dispose();
      m.geometry.dispose();
    }
    (this.boxes.material as THREE.Material).dispose();
  }
}
