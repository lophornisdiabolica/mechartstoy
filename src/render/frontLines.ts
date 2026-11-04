import * as THREE from 'three';
import { Armed, Building, Faction, Health, Transform, Unit } from '../game/components';
import { STRENGTH_CELL } from '../game/commander/strength';
import { Game } from '../game/game';
import { fightingStrength } from '../game/offensive';
import { factionColors } from './models';

/** Sim seconds between recounts; the shading eases toward each new count in between. */
const EVERY = 1;
/** How far each side's strength spreads, in cells, and how many passes of spreading. */
const SPREAD_PASSES = 3;
/** Strength a building counts for even when it has no gun: it holds the ground it stands on. */
const BUILDING_HOLD = 60;
/** Strength that makes a cell fully held (more just holds it as firmly). */
const FIRM = 160;
/** Most opacity, for ground held outright. */
const MOST = 0.28;
/** How far above the ground the shading floats. */
const LIFT = 0.2;

/**
 * Front lines: a soft shading of who holds which ground, in each side's
 * colour, from the same kind of strength map the Commanders read (see
 * game/commander/strength.ts), counted on the page from what it can see.
 * Each side's fighting strength (and its buildings, which hold the ground
 * they stand on) spreads a few cells around it; ground one side clearly
 * outweighs the rest on takes its colour, fading out where nobody's strong
 * and toward grey where it's contested. The front is where the colours
 * meet. Purely visual, and off unless asked for.
 */
export class FrontLines {
  readonly root = new THREE.Group();
  private readonly cols: number;
  private readonly rows: number;
  private readonly colors: THREE.BufferAttribute;
  private readonly mesh: THREE.Mesh;
  /** The shading's target colours (RGBA per vertex), eased toward each frame. */
  private readonly target: Float32Array;
  private countedAt = -Infinity;

  constructor(private readonly game: Game) {
    this.root.name = 'front-lines';
    this.root.visible = false;
    const { field } = game;
    this.cols = Math.ceil(field.width / STRENGTH_CELL);
    this.rows = Math.ceil(field.depth / STRENGTH_CELL);
    // A vertex at each cell's centre, so colours blend smoothly between cells.
    const n = this.cols * this.rows;
    const pos = new Float32Array(n * 3);
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const x = Math.min(field.bounds.maxX, field.bounds.minX + (i + 0.5) * STRENGTH_CELL);
        const z = Math.min(field.bounds.maxZ, field.bounds.minZ + (j + 0.5) * STRENGTH_CELL);
        pos.set([x, Math.max(field.surfaceAt(x, z), 0) + LIFT, z], (j * this.cols + i) * 3);
      }
    }
    const index: number[] = [];
    for (let j = 0; j + 1 < this.rows; j++) {
      for (let i = 0; i + 1 < this.cols; i++) {
        const k = j * this.cols + i;
        index.push(k, k + this.cols, k + 1, k + 1, k + this.cols, k + this.cols + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.colors = new THREE.BufferAttribute(new Float32Array(n * 4), 4);
    geo.setAttribute('color', this.colors);
    geo.setIndex(index);
    this.target = new Float32Array(n * 4);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = 2;
    this.mesh.userData.noShadow = true;
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(on: boolean) {
    this.root.visible = on;
    if (on) {
      this.count();
      this.colors.array.set(this.target);
      this.colors.needsUpdate = true;
    }
  }

  /** Each frame while showing: recount every EVERY sim seconds, and ease toward it. */
  update(frameSeconds: number): void {
    if (!this.root.visible) return;
    const time = this.game.world.time;
    if (time - this.countedAt >= EVERY || time < this.countedAt) this.count();
    const k = 1 - Math.exp(-frameSeconds * 2);
    const a = this.colors.array as Float32Array;
    for (let i = 0; i < a.length; i++) a[i] += (this.target[i] - a[i]) * k;
    this.colors.needsUpdate = true;
  }

  /** Recount who holds each cell (see the class comment). */
  private count(): void {
    const { world, ctx, field } = this.game;
    this.countedAt = world.time;
    const sides = ctx.sides.count;
    const n = this.cols * this.rows;
    const grid = Array.from({ length: sides }, () => new Float32Array(n));
    const cell = (x: number, z: number) => {
      const i = Math.max(0, Math.min(this.cols - 1, Math.floor((x - field.bounds.minX) / STRENGTH_CELL)));
      const j = Math.max(0, Math.min(this.rows - 1, Math.floor((z - field.bounds.minZ) / STRENGTH_CELL)));
      return j * this.cols + i;
    };
    for (const e of world.query(Faction, Transform, Health)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= sides) continue;
      const isUnit = world.has(e, Unit);
      if (!isUnit && !world.has(e, Building)) continue;
      // Aircraft don't hold ground.
      if (isUnit && world.req(e, Unit).def.move === 'air') continue;
      const t = world.req(e, Transform);
      const s = (world.has(e, Armed) ? fightingStrength(world, e) : 0) + (isUnit ? 0 : BUILDING_HOLD);
      grid[f][cell(t.x, t.z)] += s;
    }
    // Spread: each pass mixes every cell with its neighbours, so strength reaches a few cells out.
    const tmp = new Float32Array(n);
    for (const g of grid) {
      for (let pass = 0; pass < SPREAD_PASSES; pass++) {
        for (let j = 0; j < this.rows; j++) {
          for (let i = 0; i < this.cols; i++) {
            let sum = 0;
            let w = 0;
            for (let dj = -1; dj <= 1; dj++) {
              for (let di = -1; di <= 1; di++) {
                const ii = i + di;
                const jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= this.cols || jj >= this.rows) continue;
                const weight = di === 0 && dj === 0 ? 2 : 1;
                sum += g[jj * this.cols + ii] * weight;
                w += weight;
              }
            }
            // Keep the total roughly: a spread cell gives as much as it gets.
            tmp[j * this.cols + i] = (sum / w) * 2.2;
          }
        }
        g.set(tmp);
      }
    }
    // Teams hold ground together: count each team's strength, coloured by its strongest side there.
    const team = ctx.sides;
    const palette = Array.from({ length: sides }, (_, f) => new THREE.Color(factionColors(f).primary));
    const grey = new THREE.Color(0x9a9a9a);
    const c = new THREE.Color();
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bestTeam = 0;
      let rest = 0;
      const byTeam = new Map<number, number>();
      for (let f = 0; f < sides; f++) {
        if (grid[f][k] <= 0) continue;
        const t = team.teams[f];
        byTeam.set(t, (byTeam.get(t) ?? 0) + grid[f][k]);
      }
      let top = 0;
      for (const [t, s] of byTeam) {
        if (s > top) {
          rest += top;
          top = s;
          bestTeam = t;
        } else rest += s;
      }
      if (top > 0) {
        let strongest = 0;
        for (let f = 0; f < sides; f++) {
          if (team.teams[f] === bestTeam && grid[f][k] > strongest) {
            strongest = grid[f][k];
            best = f;
          }
        }
      }
      if (best < 0) {
        this.target[k * 4 + 3] = 0;
        continue;
      }
      // How clearly it's held (1 when nobody else is near) and how firmly (enough strength).
      const lead = (top - rest) / top;
      const firm = Math.min(1, top / FIRM);
      c.copy(palette[best]).lerp(grey, 1 - lead);
      this.target.set([c.r, c.g, c.b, MOST * firm * (0.35 + 0.65 * lead)], k * 4);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
