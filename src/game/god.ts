import { createNoise2D, NoiseFunction2D } from 'simplex-noise';
import { Entity, System, World } from '../core/ecs';
import { Rng } from '../core/rng';
import * as D from '../core/dmath';
import { placeBridge } from '../world/waterways';
import { MOVE_RULES } from '../world/moveClasses';
import { Building, Faction, GOD, GroundFollow, Health, Hit, makeTransform, Mover, NEUTRAL, Projectile, Renderable, Rubble, Transform, Unit, Wreck } from './components';
import { SimContext } from './context';
import { applyDamage } from './systems/projectiles';
import { spawnBuilding } from './spawn';
import { WeaponDef } from './units';

/**
 * God powers: what the player can do to a battle from above, on any side's
 * behalf or none. Each is a command (see Game.command), so it plays the same
 * in the sim worker as on the page, and nothing here runs unless a power was
 * used: battles nobody touches play exactly as before, and sims never use
 * them. There are no cooldowns; it's a toy.
 *
 * Every power works through what the battle already has, so its effects are
 * the battle's own: bombs are shells that hurt whoever is under them, a
 * quake reshapes the ground (routes, slopes and line of fire follow), a
 * planted forest is the dense forest that blocks shots and slows vehicles,
 * a wall is the engineers' wall, a bridge is a map bridge.
 */

export { GOD };

export type BrushSize = 'small' | 'medium' | 'large';
export const BRUSH_RADIUS: Record<BrushSize, number> = { small: 3, medium: 6, large: 10 };

export type StrikeId = 'light' | 'heavy' | 'carpet' | 'big';
export interface StrikeDef {
  name: string;
  blurb: string;
  /** Bombers flying the line side by side, and the bombs each drops along it. */
  planes: number;
  bombs: number;
  damage: number;
  splash: number;
  /** Depth of the crater each bomb leaves (0 for none). */
  crater: number;
  /** One bomb on a point, rather than a line of them. */
  point?: boolean;
}

export const STRIKES: Record<StrikeId, StrikeDef> = {
  light: { name: 'Light', blurb: 'A string of small bombs: deadly to infantry, a scratch on armour', planes: 1, bombs: 12, damage: 45, splash: 1.6, crater: 0 },
  heavy: { name: 'Heavy', blurb: 'Fewer, much bigger bombs that wreck tanks and buildings and pock the ground', planes: 1, bombs: 7, damage: 260, splash: 3.2, crater: 0.5 },
  carpet: { name: 'Carpet', blurb: 'Three bombers abreast, saturating a wide strip', planes: 3, bombs: 12, damage: 150, splash: 2.6, crater: 0.3 },
  big: { name: 'Big one', blurb: 'One enormous bomb on a point: flattens everything nearby and leaves a deep crater', planes: 1, bombs: 1, damage: 1600, splash: 9, crater: 2.4, point: true },
};

export type QuakeId = 'tremor' | 'quake' | 'cataclysm';
export interface QuakeDef {
  name: string;
  blurb: string;
  radius: number;
  seconds: number;
  /** How far the ground heaves up and down, at the epicentre. */
  heave: number;
  /** Damage over the whole quake, at the epicentre, to buildings and to units on the ground. */
  buildingDamage: number;
  unitDamage: number;
}

export const QUAKES: Record<QuakeId, QuakeDef> = {
  tremor: { name: 'Tremor', blurb: 'A short shake: rattles buildings and roughens the ground a little', radius: 8, seconds: 3, heave: 0.5, buildingDamage: 120, unitDamage: 8 },
  quake: { name: 'Quake', blurb: 'The ground heaves into ridges and hollows; buildings crack and burn', radius: 14, seconds: 5, heave: 1.3, buildingDamage: 450, unitDamage: 25 },
  cataclysm: { name: 'Cataclysm', blurb: 'A wide upheaval that brings down whole bases and leaves broken hills', radius: 22, seconds: 8, heave: 2.6, buildingDamage: 1400, unitDamage: 70 },
};

export type TerrainBrush = 'raise' | 'lower' | 'flatten';
export type ForestBrush = 'plant' | 'clear';

export type BlessingKind = 'production' | 'healing' | 'curse';
export type BlessingStrength = 'minor' | 'major' | 'divine';
export const BLESSING_SECONDS: Record<BlessingStrength, number> = { minor: 30, major: 60, divine: 120 };
/** Per kind and strength: production's extra rate, healing's and the curse's share of health per second. */
export const BLESSING_AMOUNT: Record<BlessingKind, Record<BlessingStrength, number>> = {
  production: { minor: 0.5, major: 1, divine: 2 },
  healing: { minor: 0.02, major: 0.05, divine: 0.12 },
  curse: { minor: 0.01, major: 0.025, divine: 0.06 },
};

export interface Blessing {
  faction: number;
  kind: BlessingKind;
  amount: number;
  until: number;
  /** How long it was granted for, for the time-left bars. */
  seconds: number;
}

/** Something the player does with a god power (the 'power' command). */
export type Power =
  | { kind: 'airstrike'; strike: StrikeId; ax: number; az: number; bx: number; bz: number }
  | { kind: 'quake'; quake: QuakeId; x: number; z: number }
  /** One dab of a brush stroke; `level` is the height a flatten stroke levels to (where it started). */
  | { kind: 'terrain'; brush: TerrainBrush; size: BrushSize; x: number; z: number; level: number }
  | { kind: 'forest'; brush: ForestBrush; size: BrushSize; x: number; z: number }
  | { kind: 'bridge'; ax: number; az: number; bx: number; bz: number }
  | { kind: 'wall'; ax: number; az: number; bx: number; bz: number }
  | { kind: 'bless'; faction: number; blessing: BlessingKind; strength: BlessingStrength }
  | { kind: 'unbless'; faction: number };

/** Seconds a bomb takes to fall. */
const FALL = 1.1;
/** How high the bombers fly over the highest ground they cross, and how fast. */
const BOMBER_ALTITUDE = 13;
const BOMBER_SPEED = 26;
/** How far before the line they start and after it they leave, so they fly in and out of view. */
const RUN_UP = 45;
/** Seconds between a quake's heaves. */
const PULSE = 0.5;
/** Room between wall segments' centres, and the most a wall can have. */
const WALL_STEP = 2.4;
const WALL_MOST = 30;
/** Lowest and highest god powers can take the ground, from sea level. */
const LOWEST = -3;
const HIGHEST = 22;
/** Trees per cell of planted forest (as in woods.ts). */
const TREES_PER_CELL = 2;

interface Run {
  plane: Entity;
  /** Where the bomber flies, start to finish, at a constant height. */
  sx: number;
  sz: number;
  ux: number;
  uz: number;
  length: number;
  y: number;
  travelled: number;
  /** Distances along the flight where each bomb is let go, and where it lands. */
  drops: { at: number; x: number; z: number }[];
  def: StrikeDef;
  weapon: WeaponDef;
}

interface Falling {
  lands: number;
  x: number;
  z: number;
  def: StrikeDef;
}

interface Quake {
  def: QuakeDef;
  x: number;
  z: number;
  next: number;
  pulses: number;
  noise: NoiseFunction2D;
}

/** What a side's blessings are now, for the page (mirrored, see sim/mirror.ts). */
export type GodState = Blessing[];

/** The god powers in play: bomb runs, quakes and blessings (see godSystem). */
export class Divine {
  blessings: Blessing[] = [];
  private runs: Run[] = [];
  private falling: Falling[] = [];
  private quakes: Quake[] = [];
  /** Counts powers used, to give each its own random stream. */
  private used = 0;

  /** Production rate multiplier from blessings on a side (exactly 1 with none). */
  production(faction: number, time: number): number {
    let f = 1;
    for (const b of this.blessings) if (b.faction === faction && b.kind === 'production' && time < b.until) f *= 1 + b.amount;
    return f;
  }

  /** Whether anything is in play (so the system can skip its work). */
  get busy(): boolean {
    return this.blessings.length > 0 || this.runs.length > 0 || this.falling.length > 0 || this.quakes.length > 0;
  }

  /** A random stream for one use of a power. */
  stream(world: World): Rng {
    return new Rng((world.tick * 7919 + ++this.used * 104729) ^ 0x60d);
  }

  /** Use a power. Returns false if it couldn't be (a bridge over dry land, say). */
  use(world: World, ctx: SimContext, p: Power): boolean {
    switch (p.kind) {
      case 'airstrike':
        return this.airstrike(world, ctx, p);
      case 'quake': {
        if (!ctx.field.contains(p.x, p.z)) return false;
        const rng = this.stream(world);
        this.quakes.push({ def: QUAKES[p.quake], x: p.x, z: p.z, next: world.time, pulses: 0, noise: createNoise2D(() => rng.next()) });
        return true;
      }
      case 'terrain':
        return terrainDab(world, ctx, p.brush, BRUSH_RADIUS[p.size], p.x, p.z, p.level);
      case 'forest':
        return p.brush === 'plant' ? plantForest(world, ctx, p.x, p.z, BRUSH_RADIUS[p.size], this.stream(world)) : clearForest(ctx, p.x, p.z, BRUSH_RADIUS[p.size]);
      case 'bridge':
        return dropBridge(ctx, p);
      case 'wall':
        return dropWall(world, ctx, p) > 0;
      case 'bless': {
        if (p.faction < 0 || p.faction >= ctx.sides.count) return false;
        const seconds = BLESSING_SECONDS[p.strength];
        // A new blessing of the same kind replaces the old one rather than piling up.
        this.blessings = this.blessings.filter((b) => !(b.faction === p.faction && b.kind === p.blessing));
        this.blessings.push({ faction: p.faction, kind: p.blessing, amount: BLESSING_AMOUNT[p.blessing][p.strength], until: world.time + seconds, seconds });
        const site = ctx.field.baseSites.find((s) => s.faction === p.faction);
        if (site) ctx.events.emit('power', { kind: p.blessing === 'curse' ? 'curse' : 'bless', x: site.x, z: site.z, radius: site.radius, faction: p.faction });
        return true;
      }
      case 'unbless':
        this.blessings = this.blessings.filter((b) => b.faction !== p.faction);
        return true;
    }
  }

  /** Can a power go there? (The page asks before sending, so it can say why not.) */
  static possible(ctx: SimContext, p: Power): boolean {
    if (p.kind === 'bridge') return bridgeLine(ctx, p) !== null;
    return true;
  }

  private airstrike(world: World, ctx: SimContext, p: Extract<Power, { kind: 'airstrike' }>): boolean {
    const def = STRIKES[p.strike];
    const field = ctx.field;
    let { ax, az, bx, bz } = p;
    if (!field.contains(ax, az) && !field.contains(bx, bz)) return false;
    let length = D.hypot(bx - ax, bz - az);
    // A click (or the big one) is a line through the point, flown from the west.
    if (def.point || length < 2) {
      const half = def.point ? 0.5 : 9;
      const ux0 = length >= 2 ? (bx - ax) / length : 1;
      const uz0 = length >= 2 ? (bz - az) / length : 0;
      const cx = def.point ? ax : (ax + bx) / 2;
      const cz = def.point ? az : (az + bz) / 2;
      ax = cx - ux0 * half;
      az = cz - uz0 * half;
      bx = cx + ux0 * half;
      bz = cz + uz0 * half;
      length = half * 2;
    }
    const ux = (bx - ax) / length;
    const uz = (bz - az) / length;
    const rng = this.stream(world);
    // Fly high enough to clear the tallest ground the line crosses.
    let top = field.seaLevel;
    for (let s = 0; s <= length; s += 2) top = Math.max(top, field.heightAt(ax + ux * s, az + uz * s));
    const y = top + BOMBER_ALTITUDE;
    const weapon: WeaponDef = { ...ctx.units.bomber.weapon, name: `${def.name} bomb`, damage: def.damage, splash: def.splash, projectile: 'artillery', arc: false };
    // Bombs keep the bomber's speed as they fall, so each is let go this far before the spot it's meant for, and lands under the bomber.
    const lead = BOMBER_SPEED * FALL;
    for (let k = 0; k < def.planes; k++) {
      const side = (k - (def.planes - 1) / 2) * 4.5;
      const sx = ax - uz * side - ux * RUN_UP;
      const sz = az + ux * side - uz * RUN_UP;
      const drops: Run['drops'] = [];
      for (let i = 0; i < def.bombs; i++) {
        const along = def.bombs === 1 ? length / 2 : (length * (i + 0.5)) / def.bombs;
        const jitter = def.point ? 0 : 0.8;
        const x = ax - uz * side + ux * along + rng.range(-jitter, jitter);
        const z = az + ux * side + uz * along + rng.range(-jitter, jitter);
        drops.push({ at: RUN_UP + along - lead, x, z });
      }
      const plane = world.create();
      world.add(plane, Transform, makeTransform(sx, y, sz, D.atan2(-uz, ux)));
      world.add(plane, Renderable, { model: 'god:bomber', scale: def.point ? 1.6 : 1.2 });
      this.runs.push({ plane, sx, sz, ux, uz, length: length + RUN_UP * 2, y, travelled: 0, drops, def, weapon });
    }
    return true;
  }

  /** One tick of everything in play. */
  update(world: World, ctx: SimContext, dt: number): void {
    const time = world.time;
    // Bombers fly their lines and let go of their bombs.
    for (let r = this.runs.length - 1; r >= 0; r--) {
      const run = this.runs[r];
      run.travelled += BOMBER_SPEED * dt;
      const t = world.get(run.plane, Transform);
      if (t) {
        t.x = run.sx + run.ux * run.travelled;
        t.z = run.sz + run.uz * run.travelled;
        t.y = run.y;
      }
      while (run.drops.length > 0 && run.drops[0].at <= run.travelled) {
        const d = run.drops.shift()!;
        const sx = run.sx + run.ux * d.at;
        const sz = run.sz + run.uz * d.at;
        const ey = ctx.field.surfaceAt(d.x, d.z);
        const p = world.create();
        world.add(p, Transform, makeTransform(sx, run.y - 0.6, sz, D.atan2(-run.uz, run.ux)));
        world.add(p, Renderable, { model: run.def.point ? 'god:bigBomb' : 'god:bomb', scale: 1 });
        world.add(p, Projectile, {
          kind: 'artillery',
          weapon: run.weapon,
          faction: GOD,
          source: 'airstrike',
          target: null,
          sx,
          sy: run.y - 0.6,
          sz,
          ex: d.x,
          ey,
          ez: d.z,
          arcHeight: 0,
          elapsed: 0,
          duration: FALL,
        });
        this.falling.push({ lands: time + FALL, x: d.x, z: d.z, def: run.def });
      }
      if (run.travelled >= run.length) {
        world.destroy(run.plane);
        this.runs.splice(r, 1);
      }
    }
    // Bombs that have landed this tick (the projectile system dealt their damage) leave craters.
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      if (f.lands > time + 1e-6) continue;
      this.falling.splice(i, 1);
      if (f.def.crater > 0) crater(world, ctx, f.x, f.z, f.def.splash * 0.55, f.def.crater);
      if (f.def.point) ctx.events.emit('power', { kind: 'bigBomb', x: f.x, z: f.z, radius: f.def.splash, faction: GOD });
    }
    // Quakes heave the ground in pulses.
    for (let i = this.quakes.length - 1; i >= 0; i--) {
      const q = this.quakes[i];
      if (time < q.next) continue;
      const total = Math.max(1, Math.round(q.def.seconds / PULSE));
      quakePulse(world, ctx, q, total);
      q.pulses++;
      q.next = time + PULSE;
      if (q.pulses >= total) this.quakes.splice(i, 1);
    }
    // Blessings heal or wither their side's units.
    if (this.blessings.length > 0) {
      this.blessings = this.blessings.filter((b) => time < b.until);
      for (const b of this.blessings) {
        if (b.kind === 'production') continue;
        for (const e of world.query(Unit, Health, Faction)) {
          if (world.req(e, Faction).id !== b.faction) continue;
          const h = world.req(e, Health);
          if (h.hp <= 0) continue;
          if (b.kind === 'healing') h.hp = Math.min(h.max, h.hp + h.max * b.amount * dt);
          else {
            h.hp -= h.max * b.amount * dt;
            if (h.hp <= 0) h.lastHit = CURSE;
          }
        }
      }
    }
  }
}

const CURSE: Hit = { source: 'curse', faction: GOD };
const QUAKE: Hit = { source: 'earthquake', faction: GOD };

/** Where a power was used, for the ticker: its point, the middle of its line, or the side's base. */
export function powerSpot(ctx: SimContext, p: Power): { x: number; z: number } {
  if ('ax' in p) return { x: (p.ax + p.bx) / 2, z: (p.az + p.bz) / 2 };
  if ('x' in p) return { x: p.x, z: p.z };
  const site = ctx.field.baseSites.find((s) => s.faction === p.faction);
  return site ? { x: site.x, z: site.z } : { x: 0, z: 0 };
}

/** Runs the god powers in play (see Divine); does nothing when none are. */
export function godSystem(ctx: SimContext): System {
  return {
    name: 'god',
    update(world, dt) {
      if (ctx.god.busy) ctx.god.update(world, ctx, dt);
    },
  };
}

/** Smooth falloff from 1 at the centre to 0 at `radius`. */
function falloff(d: number, radius: number): number {
  if (d >= radius) return 0;
  const k = 1 - (d * d) / (radius * radius);
  return k * k;
}

/**
 * After the ground moved round a point: buildings, wrecks and ruins sit on
 * it again, and dense forest trees stand on it (units follow the ground by
 * themselves).
 */
export function settle(world: World, ctx: SimContext, x: number, z: number, radius: number): void {
  const field = ctx.field;
  const r2 = (radius + 2) * (radius + 2);
  for (const type of [Building, Wreck, Rubble]) {
    for (const e of world.query(type, Transform)) {
      // Whatever follows the ground (units, and wrecks still settling) does so by itself.
      if (world.has(e, GroundFollow)) continue;
      const t = world.req(e, Transform);
      if (D.sq(t.x - x) + D.sq(t.z - z) > r2) continue;
      t.y = field.heightAt(t.x, t.z);
    }
  }
  for (const k of [...field.woods.standingNear(x, z, radius + 1)]) {
    const tree = field.woods.trees[k];
    tree.y = field.heightAt(tree.x, tree.z);
  }
}

function clampHeight(ctx: SimContext, h: number): number {
  const sea = ctx.field.seaLevel;
  return Math.max(sea + LOWEST, Math.min(sea + HIGHEST, h));
}

/** One dab of the terrain brush. */
function terrainDab(world: World, ctx: SimContext, brush: TerrainBrush, radius: number, x: number, z: number, level: number): boolean {
  const field = ctx.field;
  if (!field.contains(x, z)) return false;
  // Bigger brushes move more ground per dab, so a big hill doesn't take forever.
  const amount = 0.25 + radius * 0.03;
  const moved = field.reshape(x, z, radius, (h, d) => {
    const k = falloff(d, radius);
    if (brush === 'raise') return clampHeight(ctx, h + amount * k);
    if (brush === 'lower') return clampHeight(ctx, h - amount * k);
    return clampHeight(ctx, h + (level - h) * Math.min(1, k * 0.6));
  });
  if (moved > 0) settle(world, ctx, x, z, radius);
  return true;
}

/** A bomb crater: a bowl with a low lip, kept above the water. */
function crater(world: World, ctx: SimContext, x: number, z: number, radius: number, depth: number): void {
  const field = ctx.field;
  const floor = field.seaLevel + 0.1;
  const moved = field.reshape(x, z, radius * 1.3, (h, d) => {
    const t = d / radius;
    // Down in the bowl, up a little on the lip just outside it.
    const dh = t < 1 ? -depth * (1 - t * t) : depth * 0.25 * (1 - (t - 1) / 0.3);
    const out = h + dh;
    return dh < 0 ? (h <= floor ? h : Math.max(floor, out)) : clampHeight(ctx, out);
  });
  if (moved > 0) settle(world, ctx, x, z, radius * 1.3);
}

/** One heave of a quake: the ground rises and falls in ridges, buildings crack, units are shaken. */
function quakePulse(world: World, ctx: SimContext, q: Quake, total: number): void {
  const { def } = q;
  const field = ctx.field;
  // Strongest at the start, dying away.
  const strength = 1.6 * (1 - q.pulses / total) + 0.2;
  const step = (def.heave / total) * strength;
  const phase = q.pulses * 3.7;
  heave(ctx, q, step, phase);
  settle(world, ctx, q.x, q.z, def.radius);

  const share = 1 / total;
  for (const e of world.query(Health, Transform)) {
    const t = world.req(e, Transform);
    const d = D.hypot(t.x - q.x, t.z - q.z);
    if (d > def.radius) continue;
    const k = 1 - 0.7 * (d / def.radius);
    if (world.has(e, Building)) {
      applyDamage(world, ctx, e, def.buildingDamage * share * k, QUAKE);
      continue;
    }
    const mover = world.get(e, Mover);
    if (!mover || MOVE_RULES[mover.move].flies || MOVE_RULES[mover.move].minDepth > 0) continue;
    applyDamage(world, ctx, e, def.unitDamage * share * k, QUAKE);
  }
  // The trees nearest the epicentre come down.
  for (const tr of [...field.woods.standingNear(q.x, q.z, def.radius * 0.7)]) {
    const tree = field.woods.trees[tr];
    if (q.noise(tree.x * 0.7, tree.z * 0.7) > 0.4 - strength * 0.3) field.woods.fell(tr, { x: q.x, z: q.z });
  }
  ctx.events.emit('power', { kind: 'quake', x: q.x, z: q.z, radius: def.radius, faction: GOD, strength: def.heave * strength });
}

/** Move the ground round a quake by noise at each vertex. */
function heave(ctx: SimContext, q: Quake, step: number, phase: number): void {
  const field = ctx.field;
  const { cols, rows } = field.config;
  const r = q.def.radius;
  const [i0, j0] = field.cellAt(q.x - r, q.z - r);
  const [i1, j1] = field.cellAt(q.x + r, q.z + r);
  let moved = false;
  for (let j = j0; j <= Math.min(rows, j1 + 1); j++) {
    for (let i = i0; i <= Math.min(cols, i1 + 1); i++) {
      const x = field.vertexX(i);
      const z = field.vertexZ(j);
      const k = falloff(D.hypot(x - q.x, z - q.z), r);
      if (k <= 0) continue;
      // Ridges that build up over the pulses, with a judder that comes and goes.
      const ridge = q.noise(x / 4.5, z / 4.5);
      const judder = q.noise(x / 2 + phase, z / 2 - phase) * 0.5;
      const idx = j * (cols + 1) + i;
      const was = field.heights[idx];
      // Water stays water and dry land stays dry, so a quake doesn't drown a base or drain a river.
      const sea = field.seaLevel;
      let h = clampHeight(ctx, was + (ridge + judder) * step * k * 2);
      if (was >= sea + 0.15 && h < sea + 0.15) h = sea + 0.15;
      if (was < sea && h >= sea) h = sea - 0.05;
      if (h !== was) {
        field.heights[idx] = h;
        moved = true;
      }
    }
  }
  if (moved) field.changed({ i0: Math.max(0, i0 - 2), j0: Math.max(0, j0 - 2), i1: Math.min(cols - 1, i1 + 1), j1: Math.min(rows - 1, j1 + 1) });
}

/** Grow dense forest in a brush: every open, dry, gentle cell gets trees (not on roads, bridges or under buildings). */
function plantForest(world: World, ctx: SimContext, x: number, z: number, radius: number, rng: Rng): boolean {
  const field = ctx.field;
  if (!field.contains(x, z)) return false;
  const { cols, cellSize } = field.config;
  const thicket = 3; // groundCode('thicket'), see ground.ts
  const area = field.areaAround(x, z, radius);
  // Buildings near the brush, to keep the trees off them.
  const blocks: { x: number; z: number; r: number }[] = [];
  for (const e of world.query(Building, Transform)) {
    const t = world.req(e, Transform);
    const r = world.req(e, Building).def.radius + 1;
    if (D.hypot(t.x - x, t.z - z) < radius + r + 2) blocks.push({ x: t.x, z: t.z, r });
  }
  const cells: number[] = [];
  for (let j = area.j0; j <= area.j1; j++) {
    for (let i = area.i0; i <= area.i1; i++) {
      const k = j * cols + i;
      const cx = field.bounds.minX + (i + 0.5) * cellSize;
      const cz = field.bounds.minZ + (j + 0.5) * cellSize;
      if (D.hypot(cx - x, cz - z) > radius) continue;
      if (field.ground[k] === thicket || field.roadCell[k]) continue;
      if (field.heightAt(cx, cz) < field.seaLevel + 0.3 || field.slopeAt(cx, cz) > 0.9) continue;
      if (field.nearBridge(cx, cz, 1.5) || blocks.some((b) => D.hypot(b.x - cx, b.z - cz) < b.r)) continue;
      cells.push(k);
      for (let n = 0; n < TREES_PER_CELL; n++) {
        const tx = cx + ((n - (TREES_PER_CELL - 1) / 2) * 0.7 + rng.range(-0.25, 0.25)) * cellSize * 0.5;
        const tz = cz + rng.range(-0.3, 0.3) * cellSize;
        field.woods.grow(tx, tz, rng.range(0.85, 1.2));
      }
    }
  }
  if (cells.length === 0) return false;
  field.setGround(cells, 'thicket');
  ctx.events.emit('power', { kind: 'grow', x, z, radius, faction: GOD });
  return true;
}

/** Fell every standing tree in a brush, away from its middle. */
function clearForest(ctx: SimContext, x: number, z: number, radius: number): boolean {
  const woods = ctx.field.woods;
  let n = 0;
  for (const t of [...woods.standingNear(x, z, radius)]) {
    const tree = woods.trees[t];
    if (D.hypot(tree.x - x, tree.z - z) > radius) continue;
    woods.fell(t, { x, z });
    n++;
  }
  return n > 0;
}

/** A dragged bridge's ends, if its line crosses water (null if not). */
function bridgeLine(ctx: SimContext, p: { ax: number; az: number; bx: number; bz: number }): { a: { x: number; z: number }; b: { x: number; z: number } } | null {
  const field = ctx.field;
  const length = D.hypot(p.bx - p.ax, p.bz - p.az);
  if (length < 3 || length > 70) return null;
  let wet = false;
  for (let s = 0; s <= length; s += 0.75) if (field.isWater(p.ax + ((p.bx - p.ax) * s) / length, p.az + ((p.bz - p.az) * s) / length)) wet = true;
  if (!wet || !field.contains(p.ax, p.az, 2) || !field.contains(p.bx, p.bz, 2)) return null;
  return { a: { x: p.ax, z: p.az }, b: { x: p.bx, z: p.bz } };
}

function dropBridge(ctx: SimContext, p: { ax: number; az: number; bx: number; bz: number }): boolean {
  const line = bridgeLine(ctx, p);
  if (!line) return false;
  if (!placeBridge(ctx.field, line.a, line.b, true)) return false;
  ctx.events.emit('power', { kind: 'bridge', x: (line.a.x + line.b.x) / 2, z: (line.a.z + line.b.z) / 2, radius: D.hypot(line.b.x - line.a.x, line.b.z - line.a.z) / 2, faction: GOD });
  return true;
}

/**
 * A wall of the engineers' segments along a line, belonging to nobody: it
 * stands in everyone's way (routes go round it) until shells knock it down.
 * Segments that would land in water, on a bridge or on a building are left out.
 */
function dropWall(world: World, ctx: SimContext, p: { ax: number; az: number; bx: number; bz: number }): number {
  const field = ctx.field;
  const length = D.hypot(p.bx - p.ax, p.bz - p.az);
  const n = Math.min(WALL_MOST, Math.max(1, Math.round(length / WALL_STEP) + 1));
  const ux = length > 0.1 ? (p.bx - p.ax) / length : 1;
  const uz = length > 0.1 ? (p.bz - p.az) / length : 0;
  // A wall segment's long side is across its heading (see the bld:wall model).
  const heading = D.atan2(-ux, -uz);
  const def = ctx.buildings.wall;
  const others: { x: number; z: number; r: number }[] = [];
  for (const e of world.query(Building, Transform)) {
    const t = world.req(e, Transform);
    others.push({ x: t.x, z: t.z, r: world.req(e, Building).def.radius });
  }
  let built = 0;
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? length / 2 : (length * i) / (n - 1);
    const x = p.ax + ux * s;
    const z = p.az + uz * s;
    if (!field.contains(x, z, 1.5) || field.isWater(x, z) || field.nearBridge(x, z, 1)) continue;
    if (others.some((o) => D.hypot(o.x - x, o.z - z) < o.r + 0.9)) continue;
    spawnBuilding(world, ctx, def, NEUTRAL, x, z, heading, true);
    built++;
  }
  return built;
}
