import { System, World } from '../core/ecs';
import { MOVE_RULES, MoveClass } from '../world/moveClasses';
import { CellArea } from '../world/ground';
import { FloodPlain } from '../world/traits';
import { Faction, Health, Mover, Targetable, Transform, Unit } from './components';
import { SimContext } from './context';
import * as D from '../core/dmath';

/*
 * The Dam trait's flood (the valley and the dam are laid out in
 * world/traits.ts). The dam holds the water back from a low valley until
 * it breaks: any stretch of it shot to pieces, or its sluices opened by
 * whoever holds the dam control outpost by it (the sluice house). Then the
 * valley floods, from the dam outward, over a minute or so, and stays
 * flooded: the ground there sinks under the sea, so routes over it are cut
 * and boats can get in.
 *
 * Whoever holds the sluice house opens the sluices once, when it'll catch
 * enemies in the valley and hardly any of its own: a gamble it takes only
 * once.
 *
 * Everyone keeps clear of the water coming: ground the flood's about to
 * reach costs a lot to route over (see NavObstacles.hazard), and a unit in
 * its way gets out of the valley the shortest way (see floodEscape, used by
 * systems/ai.ts). Land units the water catches out of their depth drown.
 */

/** Seconds between flood updates, and between the sluice house's holder looking at the valley. */
const TICK = 0.5;
const WATCH = 2;
/** How fast the water spreads from the dam (at least), and in how many seconds it fills any valley. */
const LEAST_SPEED = 0.35;
const FILL_TIME = 70;
/** How far behind the front the ground's sunk all the way. */
const RAMP = 4;
/** How far ahead of the front ground costs a lot to route over, and is to be got out of. */
const AHEAD = 14;
/** Route cost of ground the water's coming for (open ground is 1). */
const HAZARD = 40;
/** The sluice house's holder opens the sluices on at least this many enemies in the valley, with at most this many of its own there. */
const OPEN_ON = 5;
const OWN_AT_MOST = 1;
/** How far a unit in the water's way looks for a way out. */
const ESCAPE_REACH = 24;

export type FloodState = 'held' | 'flooding' | 'flooded';

/** The valley below the dam: whether it's flooding, and how far the water's got. */
export class Flood {
  state: FloodState = 'held';
  /** How far from the dam the water's reached. */
  front = 0;
  /** The map cells in the valley, and each one's distance from the dam (-1: not in it). */
  readonly cellDist: Float32Array;
  readonly far: number;

  constructor(
    readonly plain: FloodPlain,
    cols: number,
    rows: number,
  ) {
    this.cellDist = new Float32Array(cols * rows).fill(-1);
    const stride = cols + 1;
    // A cell's in the valley if any of its corners is.
    plain.verts.forEach((k, n) => {
      const i = k % stride;
      const j = (k - i) / stride;
      for (const [ci, cj] of [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]]) {
        if (ci < 0 || cj < 0 || ci >= cols || cj >= rows) continue;
        const c = cj * cols + ci;
        const d = plain.dist[n];
        if (this.cellDist[c] < 0 || d < this.cellDist[c]) this.cellDist[c] = d;
      }
    });
    this.far = plain.dist.length > 0 ? plain.dist[plain.dist.length - 1] : 0;
  }

  /** Each valley cell's way out: the nearest cell out of the valley a land unit can drive to from it (-1: none). Worked out when the dam goes. */
  exits: Int32Array | null = null;

  /** Work out the ways out of the valley, over dry land, from every cell in it (see exits). */
  findExits(field: { config: { cols: number; rows: number }; isWater(x: number, z: number): boolean }, center: (c: number) => { x: number; z: number }, passable: (x: number, z: number) => boolean): void {
    const { cols, rows } = field.config;
    const exits = new Int32Array(cols * rows).fill(-1);
    const queue: number[] = [];
    const dry = (c: number) => {
      const p = center(c);
      return !field.isWater(p.x, p.z) && passable(p.x, p.z);
    };
    for (let c = 0; c < this.cellDist.length; c++) {
      if (this.cellDist[c] < 0 || !dry(c)) continue;
      for (const n of around(c, cols, rows)) {
        if (this.cellDist[n] >= 0 || !dry(n)) continue;
        exits[c] = n;
        queue.push(c);
        break;
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      for (const n of around(c, cols, rows)) {
        if (this.cellDist[n] < 0 || exits[n] >= 0 || !dry(n)) continue;
        exits[n] = exits[c];
        queue.push(n);
      }
    }
    this.exits = exits;
  }

  /** Whether the water's coming for this map cell (or is over it), while the valley floods. */
  threatens(cell: number): boolean {
    const d = this.cellDist[cell];
    return this.state === 'flooding' && d >= 0 && d < this.front + AHEAD;
  }
}

/** The dam and the flood: breaks when a stretch of dam's destroyed or the sluices are opened, then floods the valley. */
export function floodSystem(ctx: SimContext): System {
  const flood = ctx.flood!;
  const field = ctx.field;
  const plain = flood.plain;
  const { cols } = field.config;
  const stride = cols + 1;
  const start = plain.verts.map((k) => field.heights[k]);
  const speed = Math.max(LEAST_SPEED, flood.far / FILL_TIME);
  let acc = 0;
  let watchAt = 0;
  // How far the water's sunk the ground so far (the index of the first vertex not yet all the way down).
  let sunk = 0;
  const breach = (faction: number) => {
    if (flood.state !== 'held') return;
    flood.state = 'flooding';
    const cs = field.config.cellSize;
    flood.findExits(field, (c) => ({ x: field.bounds.minX + ((c % cols) + 0.5) * cs, z: field.bounds.minZ + (Math.floor(c / cols) + 0.5) * cs }), (x, z) => ctx.navs.land.terrainAllowsAt(x, z));
    ctx.events.emit('flood', { faction, x: plain.x, z: plain.z });
  };
  ctx.events.on('buildingDestroyed', (ev) => {
    if (ev.def.id === 'dam') breach(-1);
  });
  return {
    name: 'flood',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      if (flood.state === 'held') {
        if (world.time >= watchAt) {
          watchAt = world.time + WATCH;
          const opener = sluiceOpener(world, ctx, flood);
          if (opener !== null) breach(opener);
        }
        return;
      }
      if (flood.state !== 'flooding') return;
      flood.front += speed * step;
      // Sink the ground the water's reached.
      let area: CellArea | null = null;
      for (let n = sunk; n < plain.verts.length && plain.dist[n] < flood.front; n++) {
        const t = Math.min(1, (flood.front - plain.dist[n]) / RAMP);
        const k = plain.verts[n];
        const h = start[n] + (plain.to[n] - start[n]) * t;
        if (h === field.heights[k]) continue;
        field.heights[k] = h;
        const i = k % stride;
        const j = (k - i) / stride;
        area = area ? { i0: Math.min(area.i0, i - 2), j0: Math.min(area.j0, j - 2), i1: Math.max(area.i1, i + 1), j1: Math.max(area.j1, j + 1) } : { i0: i - 2, j0: j - 2, i1: i + 1, j1: j + 1 };
      }
      while (sunk < plain.verts.length && plain.dist[sunk] + RAMP <= flood.front) sunk++;
      if (area) {
        const a = area as CellArea;
        field.changed({ i0: Math.max(0, a.i0), j0: Math.max(0, a.j0), i1: Math.min(cols - 1, a.i1), j1: Math.min(field.config.rows - 1, a.j1) });
      }
      // Ground the water's coming for costs a lot to route over; once it's water, the water keeps everyone off.
      const obstacles = ctx.navs.land.obstacles;
      const done = sunk >= plain.verts.length;
      let changed: CellArea | null = null;
      for (let c = 0; c < flood.cellDist.length; c++) {
        const d = flood.cellDist[c];
        if (d < 0) continue;
        const want = !done && d < flood.front + AHEAD && d >= flood.front - RAMP ? HAZARD : 0;
        if (obstacles.hazard[c] === want || (want === 0 && obstacles.hazard[c] !== HAZARD)) continue;
        obstacles.hazard[c] = want;
        const i = c % cols;
        const j = (c - i) / cols;
        changed = changed ? { i0: Math.min(changed.i0, i), j0: Math.min(changed.j0, j), i1: Math.max(changed.i1, i), j1: Math.max(changed.j1, j) } : { i0: i, j0: j, i1: i, j1: j };
      }
      if (changed) obstacles.record(changed);
      drown(world, ctx, flood);
      if (done) flood.state = 'flooded';
    },
  };
}

function around(c: number, cols: number, rows: number): number[] {
  const i = c % cols;
  const j = (c - i) / cols;
  const out: number[] = [];
  if (i > 0) out.push(c - 1);
  if (i < cols - 1) out.push(c + 1);
  if (j > 0) out.push(c - cols);
  if (j < rows - 1) out.push(c + cols);
  return out;
}

/** Land units out of their depth in the flooding valley drown. */
function drown(world: World, ctx: SimContext, flood: Flood): void {
  const field = ctx.field;
  const r = flood.front + 2;
  ctx.grid.forEachNear(flood.plain.x, flood.plain.z, r, (e) => {
    if (world.get(e, Targetable)?.kind !== 'unit') return;
    const move = world.get(e, Mover)?.move;
    if (!move) return;
    const rules = MOVE_RULES[move];
    if (rules.flies || rules.maxDepth > 2) return;
    const t = world.req(e, Transform);
    const [i, j] = field.cellAt(t.x, t.z);
    if (flood.cellDist[j * field.config.cols + i] < 0 || field.deckAt(t.x, t.z) !== null) return;
    const h = world.get(e, Health);
    if (!h || h.hp <= 0) return;
    if (field.seaLevel - field.heightAt(t.x, t.z) > rules.maxDepth + 0.1) {
      h.hp = 0;
      ctx.bridges.drowned.add(e);
    }
  });
}

/** The side holding the sluice house that would open the sluices now, or null. */
function sluiceOpener(world: World, ctx: SimContext, flood: Flood): number | null {
  const house = ctx.outposts.find((o) => o.kind.sluices);
  if (!house || house.owner < 0) return null;
  const side = house.owner;
  let enemies = 0;
  let own = 0;
  const { cols } = ctx.field.config;
  for (const e of world.query(Unit, Faction, Transform)) {
    const move = world.get(e, Mover)?.move;
    if (!move || MOVE_RULES[move].flies || MOVE_RULES[move].maxDepth > 2) continue;
    const t = world.req(e, Transform);
    const [i, j] = ctx.field.cellAt(t.x, t.z);
    if (flood.cellDist[j * cols + i] < 0) continue;
    const f = world.req(e, Faction).id;
    if (f === side || ctx.sides.allied(side, f)) own++;
    else if (ctx.sides.hostile(side, f)) enemies++;
  }
  return enemies >= OPEN_ON && own <= OWN_AT_MOST ? side : null;
}

/**
 * Where a unit of this move class at (x, z) should go to get out of the
 * flood's way: the nearest spot out of the valley, or null if the water's
 * not coming for it (or it can swim).
 */
export function floodEscape(ctx: SimContext, move: MoveClass, x: number, z: number): { x: number; z: number } | null {
  const flood = ctx.flood;
  if (!flood || flood.state !== 'flooding') return null;
  const rules = MOVE_RULES[move];
  if (rules.flies || rules.maxDepth > 2) return null;
  const field = ctx.field;
  const { cols } = field.config;
  const [ci, cj] = field.cellAt(x, z);
  if (!flood.threatens(cj * cols + ci)) return null;
  // The way out over dry land, worked out when the dam went.
  const exit = flood.exits?.[cj * cols + ci] ?? -1;
  if (exit >= 0) {
    const cs = field.config.cellSize;
    const ex = field.bounds.minX + ((exit % cols) + 0.5) * cs;
    const ez = field.bounds.minZ + (Math.floor(exit / cols) + 0.5) * cs;
    // A little past the valley's edge.
    const d = D.hypot(ex - x, ez - z) || 1;
    return { x: ex + ((ex - x) / d) * cs, z: ez + ((ez - z) / d) * cs };
  }
  // Otherwise, out of the valley the nearest way, away from the dam's side first.
  const away = D.atan2(z - flood.plain.z, x - flood.plain.x);
  for (let r = 2; r <= ESCAPE_REACH; r += 2) {
    const turns = Math.max(8, Math.round(r * 1.5));
    for (let n = 0; n < turns; n++) {
      const a = away + ((n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2) * Math.PI * 2) / turns;
      const px = x + D.cos(a) * r;
      const pz = z + D.sin(a) * r;
      if (!field.contains(px, pz, 1)) continue;
      const [i, j] = field.cellAt(px, pz);
      if (flood.cellDist[j * cols + i] >= 0 || field.isWater(px, pz)) continue;
      if (!ctx.navs.land.terrainAllowsAt(px, pz)) continue;
      return { x: px, z: pz };
    }
  }
  return null;
}
