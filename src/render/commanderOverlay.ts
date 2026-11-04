import * as THREE from 'three';
import { Goal } from '../game/commander/commander';
import { PlaceKind } from '../game/commander/places';
import { Game } from '../game/game';
import { Battlefield } from '../world/battlefield';
import { factionColors } from './models';

/** Ribbon width of a plan arrow, and how far apart its points follow the ground. */
const ARROW_WIDTH = 0.9;
const ARROW_STEP = 2;
const HEAD_LENGTH = 3;
const HEAD_WIDTH = 2.6;
/** How far above the ground the overlay floats. */
const LIFT = 0.25;

/** Marker colour for each kind of key place the map itself doesn't already show. */
const PLACE_COLORS: Partial<Record<PlaceKind, number>> = {
  bridge: 0x8fd3ff,
  crossing: 0xffffff,
  high: 0xe8d27a,
};

/** A flat arrow from (ax, az) to (bx, bz) that follows the ground. */
function arrow(field: Battlefield, ax: number, az: number, bx: number, bz: number): THREE.BufferGeometry | null {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < HEAD_LENGTH + 1) return null;
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  // Left of the way it points, as seen from above.
  const nx = dz;
  const nz = -dx;
  const pos: number[] = [];
  const index: number[] = [];
  const at = (x: number, z: number) => pos.push(x, field.surfaceAt(x, z) + LIFT, z);
  const shaft = len - HEAD_LENGTH;
  const steps = Math.max(1, Math.ceil(shaft / ARROW_STEP));
  for (let i = 0; i <= steps; i++) {
    const d = (i / steps) * shaft;
    const x = ax + dx * d;
    const z = az + dz * d;
    at(x + (nx * ARROW_WIDTH) / 2, z + (nz * ARROW_WIDTH) / 2);
    at(x - (nx * ARROW_WIDTH) / 2, z - (nz * ARROW_WIDTH) / 2);
    if (i > 0) {
      const k = (i - 1) * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const hx = ax + dx * shaft;
  const hz = az + dz * shaft;
  const h = pos.length / 3;
  at(hx + (nx * HEAD_WIDTH) / 2, hz + (nz * HEAD_WIDTH) / 2);
  at(hx - (nx * HEAD_WIDTH) / 2, hz - (nz * HEAD_WIDTH) / 2);
  at(bx, bz);
  index.push(h, h + 1, h + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
}

/** A small ring lying on the ground. */
function marker(field: Battlefield, x: number, z: number, radius: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(radius * 0.7, radius, 24).rotateX(-Math.PI / 2);
  g.translate(x, field.surfaceAt(x, z) + LIFT, z);
  return g;
}

/**
 * What each side's Commander means to do, drawn on the map (see
 * game/commander): an arrow in the side's colour from its army to each goal
 * in turn, fainter the less ready it is for it, an arrow from each task
 * force to its outpost, a ring at home for a side
 * that's defending, and markers on the crossings, bridges and high ground it
 * knows about. Purely visual, and off unless asked for.
 */
export class CommanderOverlay {
  readonly root = new THREE.Group();
  private shownAt = NaN;
  private readonly materials = new Map<string, THREE.MeshBasicMaterial>();

  constructor(private readonly game: Game) {
    this.root.name = 'commander-overlay';
    this.root.visible = false;
  }

  get visible(): boolean {
    return this.root.visible;
  }

  set visible(on: boolean) {
    this.root.visible = on;
    if (on) this.update();
  }

  /** Redraw if the Commander's picture changed (every couple of seconds). */
  update(): void {
    const c = this.game.ctx.commander;
    if (!this.root.visible || c.updatedAt === this.shownAt) return;
    this.shownAt = c.updatedAt;
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      (child as THREE.Mesh).geometry.dispose();
    }
    const field = this.game.field;
    for (const p of c.places) {
      const color = PLACE_COLORS[p.kind];
      if (color !== undefined) this.add(marker(field, p.x, p.z, p.kind === 'high' ? 1.6 : 1.2), color, 0.75);
    }
    c.sides.forEach((side, f) => {
      if (side.armyX === null || side.armyZ === null) return;
      const color = factionColors(f).primary;
      let from = { x: side.armyX, z: side.armyZ };
      for (const goal of side.goals) {
        if (goal.kind === 'defend') {
          this.add(marker(field, goal.x, goal.z, 6), color, 0.6);
          continue;
        }
        // A task force's arrow starts from where its squads are; the team's goals chain on from the army.
        const force = goal.force !== undefined ? c.taskForces.forces.find((tf) => tf.id === goal.force) : undefined;
        const start = force ?? from;
        const g = arrow(field, start.x, start.z, goal.x, goal.z);
        if (g) this.add(g, color, force ? 0.85 : opacity(goal));
        if (!force) from = goal;
      }
    });
  }

  private add(geometry: THREE.BufferGeometry, color: number, opacity: number): void {
    const key = `${color}:${opacity.toFixed(2)}`;
    let material = this.materials.get(key);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      this.materials.set(key, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 3;
    mesh.userData.noShadow = true;
    this.root.add(mesh);
  }

  /** Free its materials (the stage frees the meshes with the rest of the battle). */
  dispose(): void {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}

/** A goal it's set on shows solid; a push it's still building up to shows faint, firming up as it gets ready. */
function opacity(goal: Goal): number {
  return 0.2 + 0.65 * Math.round(Math.max(0, Math.min(1, goal.score)) * 10) / 10;
}
