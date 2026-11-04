import * as THREE from 'three';
import { Entity } from '../core/ecs';
import { Armed, Faction, Health, Transform } from '../game/components';
import { STRENGTH_CELL } from '../game/commander/strength';
import { Game } from '../game/game';
import { fightingStrength } from '../game/offensive';
import { MOVE_RULES, MoveClass } from '../world/moveClasses';
import { unitRoutes } from '../sim/mirror';
import { factionColors } from './models';

/** The debug overlays: what each draws is in DebugOverlay's comment. */
export type DebugLayer = 'lanes' | 'routes' | 'fire' | 'strength' | 'cost';
export const DEBUG_LAYERS: { id: DebugLayer; label: string }[] = [
  { id: 'lanes', label: 'Lanes and rally points' },
  { id: 'routes', label: 'Unit routes' },
  { id: 'fire', label: 'Targets and line of fire' },
  { id: 'strength', label: 'Strength map' },
  { id: 'cost', label: 'Route costs' },
];

/** How far above the ground the overlays float. */
const LIFT = 0.45;
/** Seconds (real time) between redraws of the moving layers, and of the slow ones. */
const FAST = 0.2;
const SLOW = 1;
/** Strength that shows a strength-map cell at full colour (a few tanks' worth). */
const STRENGTH_FULL = 400;
const CLEAR_SHOT = new THREE.Color(0xfff0a0);
const BLOCKED_SHOT = new THREE.Color(0xff3b3b);
const SPOT = new THREE.Color(0x9ad0ff);

/**
 * Debug overlays for watching why the battle does what it does (O opens
 * the panel that switches them):
 * - lanes: every side's lanes toward each enemy, in its colour, with a
 *   cross at each lane's rally point;
 * - routes: each moving unit's planned route from where it is, through the
 *   waypoints it has left, to where it's headed (with the sim in its
 *   worker, the routes come from there, four times a second);
 * - fire: a line from each armed unit or building to its target, pale when
 *   it has a clear shot and red when the shot is blocked, with a blue line
 *   to the spot it's moving to for a clear one;
 * - strength: the strength map the Commanders read, recounted on the page
 *   (ground and air together), each cell in the colour of the side that's
 *   strongest there, more solid the more strength;
 * - cost: what ground costs a movement class to cross, from yellow (a bit
 *   slower) to red (much slower), with ground it can't cross at all dark.
 * Purely visual: nothing here changes the battle.
 */
export class DebugOverlay {
  readonly root = new THREE.Group();
  private readonly shown = new Set<DebugLayer>();
  private readonly groups = new Map<DebugLayer, THREE.Group>();
  private readonly lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false });
  private readonly ribbonMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  private readonly cellMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
  private fastTimer = 0;
  private slowTimer = 0;
  /** Which movement class the cost layer shows. */
  private costClassShown: MoveClass = 'tracked';
  /** Units' routes from the sim worker (see RemoteSim.routes); null reads them from the game itself. */
  routeSource: ((on: boolean) => number[][] | null) | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'debug-overlay';
    for (const { id } of DEBUG_LAYERS) {
      const g = new THREE.Group();
      g.name = `debug-${id}`;
      g.visible = false;
      this.groups.set(id, g);
      this.root.add(g);
    }
  }

  isShown(layer: DebugLayer): boolean {
    return this.shown.has(layer);
  }

  show(layer: DebugLayer, on: boolean): void {
    if (on) this.shown.add(layer);
    else {
      this.shown.delete(layer);
      this.clear(layer);
    }
    this.groups.get(layer)!.visible = on;
    if (layer === 'routes') this.routeSource?.(on);
    if (on) this.redraw(layer);
  }

  get costClass(): MoveClass {
    return this.costClassShown;
  }

  set costClass(move: MoveClass) {
    this.costClassShown = move;
    if (this.shown.has('cost')) this.redraw('cost');
  }

  update(frameSeconds: number): void {
    if (this.shown.size === 0) return;
    this.fastTimer -= frameSeconds;
    this.slowTimer -= frameSeconds;
    if (this.fastTimer <= 0) {
      this.fastTimer = FAST;
      for (const layer of ['routes', 'fire'] as const) if (this.shown.has(layer)) this.redraw(layer);
    }
    if (this.slowTimer <= 0) {
      this.slowTimer = SLOW;
      for (const layer of ['strength', 'lanes'] as const) if (this.shown.has(layer)) this.redraw(layer);
      // The cost layer only changes with the map, so it's redrawn far less often.
      if (this.shown.has('cost') && Math.random() < 0.1) this.redraw('cost');
    }
  }

  private clear(layer: DebugLayer): void {
    const g = this.groups.get(layer)!;
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  private redraw(layer: DebugLayer): void {
    this.clear(layer);
    const g = this.groups.get(layer)!;
    const obj = layer === 'lanes' ? this.lanes() : layer === 'routes' ? this.routes() : layer === 'fire' ? this.fire() : layer === 'strength' ? this.strength() : this.cost();
    if (obj) {
      obj.traverse((o) => {
        o.renderOrder = 4;
        o.userData.noShadow = true;
        o.frustumCulled = false;
      });
      g.add(obj);
    }
  }

  private y(x: number, z: number): number {
    return this.game.field.surfaceAt(x, z) + LIFT;
  }

  /** Line segments from flat [ax, az, bx, bz, ...] pairs with a colour per segment. */
  private segments(points: number[], colors: THREE.Color[]): THREE.LineSegments | null {
    if (points.length === 0) return null;
    const pos = new Float32Array((points.length / 2) * 3);
    const col = new Float32Array((points.length / 2) * 3);
    for (let k = 0; k < points.length / 2; k++) {
      const x = points[k * 2];
      const z = points[k * 2 + 1];
      pos.set([x, this.y(x, z), z], k * 3);
      const c = colors[k >> 1];
      col.set([c.r, c.g, c.b], k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.LineSegments(geo, this.lineMaterial);
  }

  /** Flat ribbons `width` wide along [ax, az, bx, bz, ...] pairs, a colour per segment (lines are only a pixel wide). */
  private ribbons(points: number[], colors: THREE.Color[], width: number, offset = 0): THREE.Mesh | null {
    if (points.length === 0) return null;
    const pos: number[] = [];
    const col: number[] = [];
    const index: number[] = [];
    const step = 2;
    for (let s = 0; s < points.length / 4; s++) {
      const [ax, az, bx, bz] = points.slice(s * 4, s * 4 + 4);
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const nx = ((bz - az) / len) * (width / 2);
      const nz = (-(bx - ax) / len) * (width / 2);
      // Shifted sideways by `offset` (to its right), so overlapping ribbons both show.
      const ox = (-(bz - az) / len) * offset;
      const oz = ((bx - ax) / len) * offset;
      const c = colors[s];
      // Follow the ground along the way, a point every couple of units.
      const n = Math.max(1, Math.ceil(len / step));
      const base = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n + ox;
        const z = az + ((bz - az) * i) / n + oz;
        pos.push(x + nx, this.y(x + nx, z + nz), z + nz, x - nx, this.y(x - nx, z - nz), z - nz);
        col.push(c.r, c.g, c.b, c.r, c.g, c.b);
        if (i > 0) {
          const k = base + (i - 1) * 2;
          index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(index);
    return new THREE.Mesh(geo, this.ribbonMaterial);
  }

  /** Coloured flat squares, one per [x, z, half size] with a colour each. */
  private cells(squares: number[], colors: THREE.Color[]): THREE.Mesh | null {
    if (squares.length === 0) return null;
    const n = squares.length / 3;
    const pos = new Float32Array(n * 12);
    const col = new Float32Array(n * 12);
    const index: number[] = [];
    for (let k = 0; k < n; k++) {
      const [x, z, h] = [squares[k * 3], squares[k * 3 + 1], squares[k * 3 + 2]];
      const corners = [
        [x - h, z - h],
        [x + h, z - h],
        [x + h, z + h],
        [x - h, z + h],
      ];
      corners.forEach(([cx, cz], c) => {
        pos.set([cx, this.y(cx, cz) - 0.2, cz], k * 12 + c * 3);
        col.set([colors[k].r, colors[k].g, colors[k].b], k * 12 + c * 3);
      });
      const b = k * 4;
      index.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);
    return new THREE.Mesh(geo, this.cellMaterial);
  }

  private sideColor(f: number): THREE.Color {
    return new THREE.Color(f >= 0 ? factionColors(f).primary : 0xcccccc);
  }

  private lanes(): THREE.Object3D | null {
    const { ctx } = this.game;
    const group = new THREE.Group();
    for (let from = 0; from < ctx.sides.count; from++) {
      if (ctx.sides.eliminated[from]) continue;
      const pts: number[] = [];
      const colors: THREE.Color[] = [];
      const color = this.sideColor(from);
      for (const to of ctx.sides.enemiesOf(from)) {
        const lanes = ctx.lanes.lanes(from, to);
        lanes.forEach((lane, k) => {
          for (let i = 1; i < lane.length; i++) {
            pts.push(lane[i - 1].x, lane[i - 1].z, lane[i].x, lane[i].z);
            colors.push(color);
          }
          const r = ctx.lanes.rally(from, to, k);
          pts.push(r.x - 1.5, r.z - 1.5, r.x + 1.5, r.z + 1.5, r.x - 1.5, r.z + 1.5, r.x + 1.5, r.z - 1.5);
          colors.push(color, color);
        });
      }
      // A side's lanes toward an enemy are that enemy's lanes back: each keeps to its own right.
      const ribbon = this.ribbons(pts, colors, 0.7, 0.45);
      if (ribbon) group.add(ribbon);
    }
    return group;
  }

  private routes(): THREE.Object3D | null {
    const { world } = this.game;
    const routes = this.routeSource ? this.routeSource(true) : unitRoutes(world);
    if (!routes) return null;
    const pts: number[] = [];
    const colors: THREE.Color[] = [];
    const palette = new Map<number, THREE.Color>();
    for (const route of routes) {
      const e = route[0] as Entity;
      if (!world.isAlive(e)) continue;
      const t = world.get(e, Transform);
      if (!t) continue;
      const f = world.get(e, Faction)?.id ?? -1;
      let color = palette.get(f);
      if (!color) palette.set(f, (color = this.sideColor(f).lerp(new THREE.Color(0xffffff), 0.35)));
      let x = t.x;
      let z = t.z;
      for (let k = 3; k + 1 < route.length; k += 2) {
        pts.push(x, z, route[k], route[k + 1]);
        colors.push(color);
        x = route[k];
        z = route[k + 1];
      }
      pts.push(x, z, route[1], route[2]);
      colors.push(color);
    }
    return this.segments(pts, colors);
  }

  private fire(): THREE.Object3D | null {
    const { world } = this.game;
    const pts: number[] = [];
    const colors: THREE.Color[] = [];
    for (const e of world.query(Armed, Transform)) {
      const a = world.req(e, Armed);
      if (a.target === null || !world.isAlive(a.target)) continue;
      const to = world.get(a.target, Transform);
      if (!to) continue;
      const t = world.req(e, Transform);
      pts.push(t.x, t.z, to.x, to.z);
      colors.push(a.blocked ? BLOCKED_SHOT : CLEAR_SHOT);
      if (a.blocked && a.spotX !== null && a.spotZ !== null) {
        pts.push(t.x, t.z, a.spotX, a.spotZ);
        colors.push(SPOT);
      }
    }
    return this.segments(pts, colors);
  }

  private strength(): THREE.Object3D | null {
    const { world, field, ctx } = this.game;
    const { minX, minZ } = field.bounds;
    const cols = Math.ceil(field.width / STRENGTH_CELL);
    const rows = Math.ceil(field.depth / STRENGTH_CELL);
    const sides = ctx.sides.count;
    const grid = Array.from({ length: sides }, () => new Float32Array(cols * rows));
    for (const e of world.query(Armed, Health, Faction, Transform)) {
      const f = world.req(e, Faction).id;
      if (f < 0 || f >= sides) continue;
      const t = world.req(e, Transform);
      const i = Math.max(0, Math.min(cols - 1, Math.floor((t.x - minX) / STRENGTH_CELL)));
      const j = Math.max(0, Math.min(rows - 1, Math.floor((t.z - minZ) / STRENGTH_CELL)));
      grid[f][j * cols + i] += fightingStrength(world, e);
    }
    const squares: number[] = [];
    const colors: THREE.Color[] = [];
    const ground = new THREE.Color(0x202020);
    for (let k = 0; k < cols * rows; k++) {
      let best = -1;
      let top = 0;
      let total = 0;
      for (let f = 0; f < sides; f++) {
        total += grid[f][k];
        if (grid[f][k] > top) {
          top = grid[f][k];
          best = f;
        }
      }
      if (best < 0) continue;
      // Contested cells fade toward grey; strength makes them more solid.
      const solid = Math.min(1, Math.sqrt(total / STRENGTH_FULL));
      const lead = top / total;
      const c = this.sideColor(best).lerp(new THREE.Color(0x888888), 1 - lead).lerp(ground, 1 - solid);
      squares.push(minX + ((k % cols) + 0.5) * STRENGTH_CELL, minZ + (Math.floor(k / cols) + 0.5) * STRENGTH_CELL, STRENGTH_CELL / 2 - 0.3);
      colors.push(c);
    }
    return this.cells(squares, colors);
  }

  private cost(): THREE.Object3D | null {
    const nav = this.game.ctx.navs.for(this.costClassShown);
    const squares: number[] = [];
    const colors: THREE.Color[] = [];
    const slow = new THREE.Color(0xffe066);
    const slower = new THREE.Color(0xff3b1f);
    const closed = new THREE.Color(0x1a1010);
    const half = nav.cellSize / 2;
    for (let j = 0; j < nav.rows; j++) {
      for (let i = 0; i < nav.cols; i++) {
        const c = nav.center(i, j);
        if (nav.blocked(i, j)) {
          squares.push(c.x, c.z, half);
          colors.push(closed);
          continue;
        }
        const cost = nav.costAt(c.x, c.z);
        if (cost <= 1.05) continue;
        squares.push(c.x, c.z, half);
        colors.push(slow.clone().lerp(slower, Math.min(1, (cost - 1) / 3)));
      }
    }
    return this.cells(squares, colors);
  }

  dispose(): void {
    for (const layer of this.shown) this.clear(layer);
    this.lineMaterial.dispose();
    this.ribbonMaterial.dispose();
    this.cellMaterial.dispose();
  }
}

/** Movement classes the cost layer can show (not aircraft, which ignore the ground). */
export const COST_CLASSES: MoveClass[] = (Object.keys(MOVE_RULES) as MoveClass[]).filter((m) => !MOVE_RULES[m].flies);
