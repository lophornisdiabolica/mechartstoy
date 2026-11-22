import * as THREE from 'three';
import { Game } from '../game/game';
import { Faction, Transform, Wreck } from '../game/components';
import { MAX_WRECKAGE, WRECKAGE_CELL } from '../game/wreckage';
import { factionColors } from './models';

/** Pieces of junk per tank-sized wreck of wreckage on a cell. */
const PIECES_PER = 14;
/** Most pieces drawn on one cell (a full one). */
const MOST_PER_CELL = Math.ceil(MAX_WRECKAGE * PIECES_PER);
/** Most pieces drawn at once, of each shape. */
const MOST = 16000;
/** How fast the drawn wreckage catches up with the sim's, per second: piling on quickly, rusting away and being eaten slowly enough to watch. */
const GROW_RATE = 1.2;
const SHRINK_RATE = 1.2;
/** Seconds between redraws of the pieces (they only change as wreckage comes and goes). */
const REDRAW = 0.2;
/** A heap is redrawn when it has sunk by this many pieces' worth since it was last drawn. */
const SINK_STEP = 0.15;
/** How many pieces are on their way into the ground at once on a heap that's going: each sinks over this many pieces' worth of rust. */
const SINK_SPAN = 3;
/** How far into its sinking a piece is gone: the last sliver isn't left poking out. */
const SUNK = 0.9;
/** How fast a heap that starts going starts sinking its top pieces (per second), so they don't drop all at once. */
const SINK_EASE = 1.5;
/** How high a full cell's heap rises, world units. */
const HEAP = 1.6;
/** How far a cell's pieces reach from its middle, in cells: past its edge, so neighbouring cells' pieces mingle into one heap. */
const REACH = 0.7;
/** Wreckage on a spot, in tank-sized wrecks, at which its heap stands at full height. */
const FULL_HEAP = 7;
/** How far round a wreck its side's colours tint the junk, world units. */
const TINT_REACH = 2.6;
/** Share of a tinted heap's pieces that take a side's colours; the rest are bare char and steel. */
const TINTED = 0.55;

/** Charred metal and burnt paint, a little bare steel, and only now and then a dull rust: the shades the hulks are drawn in. */
const NEUTRAL = [0x2a2623, 0x2a2623, 0x332e2a, 0x332e2a, 0x3d3832, 0x45403a, 0x4f5357, 0x5f6468, 0x43362d].map((c) => new THREE.Color(c));
const CHAR = new THREE.Color(0x2a2623);

/** The shapes junk comes in (one instanced mesh each). */
type Shape = 'box' | 'drum' | 'rod' | 'wedge' | 'lump';
const SHAPES: Shape[] = ['box', 'drum', 'rod', 'wedge', 'lump'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** A cheap repeatable random number for a cell's piece, 0 to 1. */
function hash(k: number, i: number, salt: number): number {
  let h = Math.imul(k + 1, 0x9e3779b1) ^ Math.imul(i + 7, 0x85ebca6b) ^ Math.imul(salt + 3, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * What a piece of junk is, picked from a random number: its shape and size
 * (world units, before tumbling), and how far it lies flat (0) or stands
 * any way up (1). Plates and track lengths lie down; lumps and wheels land
 * any way up.
 */
function piece(kind: number, r: (salt: number) => number, out: THREE.Vector3): { shape: Shape; tumble: number } {
  if (kind < 0.16) {
    // A torn armour plate.
    out.set(0.35 + r(8) * 0.45, 0.05 + r(9) * 0.04, 0.25 + r(10) * 0.35);
    return { shape: 'box', tumble: 0.4 };
  }
  if (kind < 0.27) {
    // A length of track: long, flat and dark.
    out.set(0.7 + r(8) * 0.7, 0.07, 0.22 + r(9) * 0.1);
    return { shape: 'box', tumble: 0.25 };
  }
  if (kind < 0.36) {
    // A bent girder or strut.
    out.set(0.6 + r(8) * 0.6, 0.07 + r(9) * 0.05, 0.07 + r(10) * 0.05);
    return { shape: 'box', tumble: 0.8 };
  }
  if (kind < 0.47) {
    // A blocky chunk of hull or a hatch.
    const size = 0.18 + r(8) * 0.24;
    out.set(size * (0.8 + r(9) * 0.7), size * (0.5 + r(10) * 0.5), size);
    return { shape: 'box', tumble: 0.6 };
  }
  if (kind < 0.58) {
    // A road wheel or sprocket, flat on its side or on its edge.
    const rad = 0.16 + r(8) * 0.14;
    out.set(rad * 2, 0.08 + r(9) * 0.06, rad * 2);
    return { shape: 'drum', tumble: r(10) < 0.3 ? 1 : 0.3 };
  }
  if (kind < 0.66) {
    // A gun barrel or a pipe: long and thin, lying down.
    const rad = 0.05 + r(8) * 0.05;
    out.set(0.8 + r(9) * 0.9, rad * 2, rad * 2);
    return { shape: 'rod', tumble: 0.3 };
  }
  if (kind < 0.72) {
    // A drum or fuel can.
    const rad = 0.12 + r(8) * 0.1;
    out.set(rad * 2, rad * (1.6 + r(9) * 1.2), rad * 2);
    return { shape: 'drum', tumble: 1 };
  }
  if (kind < 0.86) {
    // A wedge of sloped armour, torn off a glacis or a turret's cheek.
    const size = 0.25 + r(8) * 0.3;
    out.set(size * (0.8 + r(9) * 0.6), size * (0.4 + r(10) * 0.4), size * (0.6 + r(11) * 0.6));
    return { shape: 'wedge', tumble: 0.7 };
  }
  // A mangled lump: an engine block, a crumpled turret, twisted metal.
  const size = 0.2 + r(8) * 0.28;
  out.set(size * (0.9 + r(9) * 0.5), size * (0.6 + r(10) * 0.5), size * (0.9 + r(11) * 0.4));
  return { shape: 'lump', tumble: 1 };
}

/**
 * The wreckage on the ground (see game/wreckage.ts), drawn as heaps of
 * junk: armour plates and sloped wedges, track lengths and road wheels,
 * girders, gun barrels and drums, blocky chunks of hull and mangled lumps.
 * They're charred and grey, and about half of a heap's pieces keep the
 * colours of the sides whose vehicles died there, darkened as the hulks
 * are. Each cell's pieces are always the same ones in the same places
 * (picked from the cell), so a heap grows by adding pieces on top as more
 * wrecks fall apart there, and never reshuffles. As it rusts away or is
 * eaten its top pieces sink slowly into the ground, a few at a time, and
 * are gone once they're under. The heap's height is blended across
 * neighbouring cells, so the cells of one heap make one mound, and a
 * much-fought field is a scrapyard.
 *
 * One instanced mesh per shape (boxes, drums, rods, wedges, lumps) draws every
 * piece, so a big scrapyard is five draw calls. Pieces are laid out again
 * only when a heap grows by a piece or sinks a little further, a few times
 * a second at most.
 */
export class WreckageGround {
  readonly root = new THREE.Group();
  private readonly meshes: Record<Shape, THREE.InstancedMesh>;
  /** The wreckage as drawn, per cell, easing toward the sim's. */
  private shown: Float32Array | null = null;
  private listed: Uint8Array | null = null;
  private live: number[] = [];
  private sinceDraw = REDRAW;
  /** Pieces' worth drawn per cell at the last redraw: a redraw is needed only when one moves on. */
  private drawn: Float32Array | null = null;
  /** How far each cell's top pieces are sinking, 0 (a heap growing or still) to 1 (going). */
  private sinking: Float32Array | null = null;
  /** The sides whose wrecks fell near each cell, with how many (see TINT_REACH). */
  private readonly tints = new Map<number, Map<number, number>>();
  /** Wrecks already counted toward the tints. */
  private seen = new Set<number>();
  /**
   * Each cell's pieces' colours, picked once when a piece first shows (-2 not
   * yet, -1 char and steel, else the side), so a heap's pieces keep their
   * colours when another side's wrecks fall there later.
   */
  private readonly hues = new Map<number, Int16Array>();

  constructor(private readonly game: Game) {
    this.root.name = 'wreckage';
    const material = new THREE.MeshLambertMaterial({ flatShading: true });
    const geometry: Record<Shape, THREE.BufferGeometry> = {
      box: new THREE.BoxGeometry(1, 1, 1),
      drum: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
      // A cylinder lying along x: barrels and pipes.
      rod: new THREE.CylinderGeometry(0.5, 0.5, 1, 6).rotateZ(Math.PI / 2),
      // A three-sided prism lying on a face: a wedge.
      wedge: new THREE.CylinderGeometry(0.58, 0.58, 1, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6),
      lump: new THREE.DodecahedronGeometry(0.55, 0),
    };
    this.meshes = {} as Record<Shape, THREE.InstancedMesh>;
    for (const shape of SHAPES) {
      const m = new THREE.InstancedMesh(geometry[shape], material, MOST);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes[shape] = m;
      this.root.add(m);
    }
  }

  /** Pieces drawn now (for tests and the stats readout). */
  get pieces(): number {
    return SHAPES.reduce((sum, s) => sum + this.meshes[s].count, 0);
  }

  update(seconds: number): void {
    const wreckage = this.game.ctx.wreckage;
    this.sinceDraw += seconds;
    if (this.sinceDraw >= REDRAW) this.noteWrecks();
    if (wreckage.count === 0 && this.live.length === 0) return;
    const n = wreckage.cols * wreckage.rows;
    if (!this.shown || this.shown.length !== n) {
      this.shown = new Float32Array(n);
      this.listed = new Uint8Array(n);
      this.drawn = new Float32Array(n);
      this.sinking = new Float32Array(n);
      this.live = [];
    }
    const shown = this.shown;
    const listed = this.listed!;
    const drawn = this.drawn!;
    const sinking = this.sinking!;
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
      const growing = want > shown[k] + 1e-4;
      shown[k] += (want - shown[k]) * Math.min(1, (growing ? GROW_RATE : SHRINK_RATE) * seconds);
      sinking[k] = growing ? 0 : Math.min(1, sinking[k] + seconds * SINK_EASE);
      const pieces = shown[k] * PIECES_PER;
      // A growing heap gains whole pieces; a going one sinks a little at a time.
      if (growing ? Math.floor(pieces + 0.35) !== Math.floor(drawn[k] + 0.35) : Math.abs(pieces - drawn[k]) >= SINK_STEP) changed = true;
      if (want <= 0 && pieces < 0.05) {
        shown[k] = 0;
        listed[k] = 0;
        drawn[k] = 0;
        sinking[k] = 0;
        this.tints.delete(k);
        this.hues.delete(k);
        changed = true;
        continue;
      }
      next.push(k);
    }
    this.live = next;
    if (!changed || this.sinceDraw < REDRAW) return;
    this.sinceDraw = 0;
    this.draw();
  }

  /** Count each new wreck's side toward the tint of the cells round it. */
  private noteWrecks(): void {
    const world = this.game.world;
    const wreckage = this.game.ctx.wreckage;
    const now = new Set<number>();
    const reach = Math.ceil(TINT_REACH / WRECKAGE_CELL);
    for (const e of world.query(Wreck, Faction, Transform)) {
      now.add(e);
      if (this.seen.has(e)) continue;
      const t = world.req(e, Transform);
      const side = world.req(e, Faction).id;
      const mid = wreckage.cellAt(t.x, t.z);
      if (mid < 0) continue;
      const i0 = mid % wreckage.cols;
      const j0 = (mid - i0) / wreckage.cols;
      for (let dj = -reach; dj <= reach; dj++) {
        for (let di = -reach; di <= reach; di++) {
          const i = i0 + di;
          const j = j0 + dj;
          if (i < 0 || j < 0 || i >= wreckage.cols || j >= wreckage.rows) continue;
          const w = 1 - Math.hypot(di, dj) * WRECKAGE_CELL / (TINT_REACH + WRECKAGE_CELL);
          if (w <= 0) continue;
          const k = j * wreckage.cols + i;
          let sides = this.tints.get(k);
          if (!sides) this.tints.set(k, (sides = new Map()));
          sides.set(side, (sides.get(side) ?? 0) + w);
        }
      }
    }
    this.seen = now;
  }

  /** A piece's colour: char and steel, or (on a tinted heap) a side's colours darkened as its hulks are. */
  private colour(k: number, i: number, r: (salt: number) => number, out: THREE.Color): THREE.Color {
    let hues = this.hues.get(k);
    if (!hues) this.hues.set(k, (hues = new Int16Array(MOST_PER_CELL).fill(-2)));
    if (hues[i] === -2) hues[i] = this.pickSide(k, r);
    const side = hues[i];
    if (side < 0) return out.copy(NEUTRAL[Math.floor(r(4) * NEUTRAL.length)]);
    const c = factionColors(side);
    out.setHex(r(14) < 0.7 ? c.primary : c.secondary);
    // Burnt most of the way to char, some more than others.
    return out.lerp(CHAR, 0.8 + r(15) * 0.14);
  }

  /** Whose colours a new piece takes: a side whose wrecks fell near, by how many, or none. */
  private pickSide(k: number, r: (salt: number) => number): number {
    const sides = this.tints.get(k);
    if (!sides || r(12) >= TINTED) return -1;
    let total = 0;
    for (const w of sides.values()) total += w;
    let pick = r(13) * total;
    for (const [side, w] of sides) {
      pick -= w;
      if (pick <= 0) return side;
    }
    return -1;
  }

  /** Lay out every piece on every cell again. */
  private draw(): void {
    const wreckage = this.game.ctx.wreckage;
    const field = this.game.field;
    const shown = this.shown!;
    const drawn = this.drawn!;
    const sinking = this.sinking!;
    const counts: Record<Shape, number> = { box: 0, drum: 0, rod: 0, wedge: 0, lump: 0 };
    for (const k of this.live) {
      const pieces = Math.min(MOST_PER_CELL, shown[k] * PIECES_PER);
      drawn[k] = shown[k] * PIECES_PER;
      const going = sinking[k];
      // A going heap keeps the pieces still partly above ground; a growing one shows whole pieces only.
      const count = going > 0 ? Math.ceil(pieces) : Math.floor(pieces + 0.35);
      if (count === 0) continue;
      const c = wreckage.center(k);
      for (let i = 0; i < count; i++) {
        const r = (salt: number) => hash(k, i, salt);
        // Pieces cover the cell and a little past it, so a cell's pieces meet its neighbours';
        // later ones land on top of earlier ones. Each piece always lands in the same place.
        const fill = i / MOST_PER_CELL;
        const x = c.x + (r(1) - 0.5) * 2 * REACH * WRECKAGE_CELL;
        const z = c.z + (r(2) - 0.5) * 2 * REACH * WRECKAGE_CELL;
        const ground = field.surfaceAt(x, z);
        // Nothing lies on water: pieces of a shoreline heap that would land in it are left out.
        if (ground < field.seaLevel) continue;
        const { shape, tumble } = piece(r(3), r, _s);
        if (counts[shape] >= MOST) continue;
        // Lying more or less flat, or any way up, by its shape.
        _e.set((r(5) - 0.5) * Math.PI * tumble, r(6) * Math.PI * 2, (r(7) - 0.5) * Math.PI * tumble, 'YXZ');
        _q.setFromEuler(_e);
        // The heap's surface: as high as the wreckage round that spot (smoothed across cells, so the
        // cells of one heap make one mound), and the later pieces lie on top of the earlier ones.
        const lift = HEAP * this.depth(x, z) * (0.25 + 0.75 * Math.sqrt(fill)) * (0.7 + r(11) * 0.3);
        // The top pieces of a heap that's going sink into the ground before they're gone, each at
        // its own pace and finishing at its own time (some a little before their turn), slowly at
        // first and faster at the end, so few linger with just a sliver showing.
        const span = SINK_SPAN * (0.5 + r(16));
        const under = (i + r(17) * 0.8 + span - pieces) / span;
        if (going > 0 && under >= SUNK) continue;
        const sink = going * Math.max(0, Math.min(1, under)) ** 1.6;
        const height = Math.max(_s.x, _s.y, _s.z) * 0.6;
        _p.set(x, ground + lift + _s.y * 0.3 - sink * (lift + height + 0.05), z);
        _m.compose(_p, _q, _s);
        const mesh = this.meshes[shape];
        mesh.setMatrixAt(counts[shape], _m);
        mesh.setColorAt(counts[shape], this.colour(k, i, r, _c));
        counts[shape]++;
      }
    }
    for (const shape of SHAPES) {
      const m = this.meshes[shape];
      m.count = counts[shape];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** How deep the drawn wreckage is at a point, 0 to 1: the cells' amounts blended across the cells round it. */
  private depth(x: number, z: number): number {
    const wreckage = this.game.ctx.wreckage;
    const shown = this.shown!;
    const c = wreckage.cellAt(x, z);
    if (c < 0) return 0;
    const mid = wreckage.center(c);
    // Blend the four nearest cell middles.
    const fx = (x - mid.x) / WRECKAGE_CELL;
    const fz = (z - mid.z) / WRECKAGE_CELL;
    const ox = fx < 0 ? -1 : 1;
    const oz = fz < 0 ? -1 : 1;
    const ax = Math.abs(fx);
    const az = Math.abs(fz);
    const i = c % wreckage.cols;
    const j = (c - i) / wreckage.cols;
    const at = (di: number, dj: number) => {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= wreckage.cols || jj >= wreckage.rows) return 0;
      return shown[jj * wreckage.cols + ii];
    };
    const m = at(0, 0) * (1 - ax) * (1 - az) + at(ox, 0) * ax * (1 - az) + at(0, oz) * (1 - ax) * az + at(ox, oz) * ax * az;
    // A thin scattering lies flat; a heap of a dozen wrecks stands near its full height.
    return Math.sqrt(Math.min(1, m / FULL_HEAP));
  }

  dispose(): void {
    const material = this.meshes.box.material as THREE.Material;
    for (const shape of SHAPES) {
      this.meshes[shape].dispose();
      this.meshes[shape].geometry.dispose();
    }
    material.dispose();
  }
}
