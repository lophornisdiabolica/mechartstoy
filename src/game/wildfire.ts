import { System } from '../core/ecs';
import { Rng } from '../core/rng';
import { BiomeId } from '../world/biomes';
import { CellArea } from '../world/ground';
import { SimContext } from './context';
import { FIRE_CELL, LIT } from './fire';
import { GARRISON, NEUTRAL } from './components';
import * as D from '../core/dmath';

/**
 * Fire that's nobody's: a wildfire creeping through the woods (the
 * Wildfire setting), and a burning oil field (see traits.ts).
 *
 * Wildfire. Any fire that gets going in a stand of trees (a flamer's, a
 * burning wreck's, a burning oil pool's) catches the trees: the stand burns
 * for half a minute or so, the fire creeping slowly on to the trees beside
 * it, under a pall of smoke that throws shots off. Once a stand's burned
 * out, its trees are down and the ground is burnt. It's nobody's fire, so
 * it burns everyone in it, whoever lit it. How readily it spreads goes with
 * the Wildfire setting and how dry the biome is: a desert's scrub goes up
 * fast, a jungle's barely creeps.
 *
 * Everyone keeps clear. Ground burning with nobody's fire costs a lot to
 * route through (see NavObstacles.hazard), so units go round a fire they
 * know of, and a unit caught in one gets out of it the shortest way (see
 * fireEscape, used by systems/ai.ts).
 */

/** Seconds between wildfire updates. */
const TICK = 0.5;
/** Seconds a stand of trees burns for. */
const WOOD_FUEL = 30;
/** Heat a burning stand keeps up every tick: well alight, short of white-hot. */
const WOOD_HEAT = 0.2;
/** Smoke a burning stand gives off every tick. */
const WOOD_SMOKE = 0.14;
/** Chance a second, at Wildfire 1 in an ordinary biome, that a burning stand sets each of the four stands beside it alight. */
const SPREAD = 0.035;
/** How readily each biome's woods burn. */
const DRY: Record<BiomeId, number> = {
  temperate: 1,
  desert: 1.8,
  snow: 0.3,
  forest: 0.9,
  jungle: 0.35,
  steppe: 1.6,
  tundra: 0.4,
  ash: 1.4,
  scrap: 1.2,
  crystal: 0.8,
};
/** Route cost a cell of nobody's fire adds (open ground is 1). */
const HAZARD = 12;
/** Seconds between bringing the routes' fire map up to date. */
const HAZARD_EVERY = 1;
/** How far a unit caught in nobody's fire looks for a way out. */
const ESCAPE_REACH = 7;

/** Whether this map's fires spread through the woods at all. */
export function wildfireOn(ctx: SimContext): boolean {
  return (ctx.settings.map.wildfire ?? 0) > 0 && ctx.field.woods.trees.length > 0;
}

/** Wildfire in the woods (when the setting's on), and keeping the routes clear of nobody's fire. */
export function wildfireSystem(ctx: SimContext, seed: number): System {
  // Its own random stream, so the rest of the battle's isn't touched.
  const rng = new Rng(seed ^ 0x77696c64);
  const fire = ctx.fire;
  const field = ctx.field;
  const woods = field.woods;
  const spread = SPREAD * (ctx.settings.map.wildfire ?? 0) * (DRY[field.config.biome] ?? 1);
  // Fuel left per fire cell (-1: not burned yet), and the cells burning now.
  const fuel = new Float32Array(fire.cols * fire.rows).fill(-1);
  const burning = new Set<number>();
  // Map cells per fire cell: the same grid (both FIRE_CELL across from the map's corner).
  const sameGrid = field.config.cellSize === FIRE_CELL;
  const treesIn = (k: number) => {
    const c = fire.center(k);
    return sameGrid ? woods.standingIn(mapCell(ctx, c.x, c.z)).length : woods.hasTreesAt(c.x, c.z) ? 1 : 0;
  };
  const hazard = new Set<number>();
  let acc = 0;
  let hazardAt = 0;
  return {
    name: 'wildfire',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      if (spread > 0 && fire.count > 0) {
        // Fire that's got going in a stand of trees catches it.
        fire.forEach((k, heat) => {
          if (heat < LIT || burning.has(k) || fuel[k] === 0) return;
          if (treesIn(k) === 0) return;
          if (fuel[k] < 0) fuel[k] = WOOD_FUEL * rng.range(0.8, 1.2);
          burning.add(k);
        });
        const catching: number[] = [];
        for (const k of burning) {
          const c = fire.center(k);
          fuel[k] -= step;
          if (fuel[k] <= 0) {
            // Burned out: the trees are down, and the ground's burnt.
            fuel[k] = 0;
            burning.delete(k);
            // (The ground first, so the trees are drawn lying charred on it.)
            field.paint(c.x, c.z, FIRE_CELL * 0.5, 'burnt', (g) => g !== 'road' && g !== 'trench');
            for (const t of [...woods.standingNear(c.x, c.z, 0)]) {
              const tree = woods.trees[t];
              if (fire.cellAt(tree.x, tree.z) === k) woods.fell(t, { x: tree.x + 0.3, z: tree.z });
            }
            continue;
          }
          fire.add(c.x, c.z, FIRE_CELL * 0.5, WOOD_HEAT, GARRISON, 'wildfire');
          ctx.smoke.add(c.x, c.z, FIRE_CELL * 1.5, WOOD_SMOKE, NEUTRAL);
          // Creeps on to the stands beside it.
          for (const n of neighbours(fire.cols, fire.rows, k)) {
            if (burning.has(n) || fuel[n] === 0 || rng.next() >= spread * step) continue;
            if (treesIn(n) > 0) catching.push(n);
          }
        }
        for (const n of catching) {
          const c = fire.center(n);
          fire.add(c.x, c.z, FIRE_CELL * 0.5, LIT * 1.5, GARRISON, 'wildfire');
        }
      }
      if (world.time >= hazardAt) {
        hazardAt = world.time + HAZARD_EVERY;
        markHazards(ctx, hazard);
      }
    },
  };
}

/** The map cell a point is in. */
function mapCell(ctx: SimContext, x: number, z: number): number {
  const [i, j] = ctx.field.cellAt(x, z);
  return j * ctx.field.config.cols + i;
}

function neighbours(cols: number, rows: number, k: number): number[] {
  const i = k % cols;
  const j = (k - i) / cols;
  const out: number[] = [];
  // Side by side only (not corner to corner), so it creeps rather than races.
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (i + di < 0 || j + dj < 0 || i + di >= cols || j + dj >= rows) continue;
    out.push((j + dj) * cols + i + di);
  }
  return out;
}

/**
 * Bring the routes' fire map up to date: ground burning with nobody's fire
 * costs HAZARD more to cross, and routes through where it's changed get
 * re-planned.
 */
function markHazards(ctx: SimContext, was: Set<number>): void {
  const fire = ctx.fire;
  const obstacles = ctx.navs.land.obstacles;
  const now = new Set<number>();
  fire.forEach((k, heat) => {
    if (heat >= LIT && fire.owners(k) === GARRISON) now.add(k);
  });
  let area: CellArea | null = null;
  const touch = (k: number, on: boolean) => {
    const c = fire.center(k);
    const [i, j] = ctx.field.cellAt(c.x, c.z);
    obstacles.hazard[j * obstacles.cols + i] = on ? HAZARD : 0;
    area = area ? { i0: Math.min(area.i0, i), j0: Math.min(area.j0, j), i1: Math.max(area.i1, i), j1: Math.max(area.j1, j) } : { i0: i, j0: j, i1: i, j1: j };
  };
  for (const k of now) if (!was.has(k)) touch(k, true);
  for (const k of was) if (!now.has(k)) touch(k, false);
  was.clear();
  for (const k of now) was.add(k);
  if (area) obstacles.record(area);
}

/**
 * Where a unit of `faction` standing at (x, z) should go to get out of
 * nobody's fire burning it: the nearest spot that isn't burning, or null if
 * it isn't in any (or can't see a way out).
 */
export function fireEscape(ctx: SimContext, faction: number, x: number, z: number): { x: number; z: number } | null {
  const fire = ctx.fire;
  if (fire.count === 0) return null;
  const k = fire.cellAt(x, z);
  if (k < 0 || fire.heat[k] < LIT || fire.owners(k) !== GARRISON || !ctx.sides.hostile(GARRISON, faction)) return null;
  for (let r = FIRE_CELL; r <= ESCAPE_REACH; r += FIRE_CELL) {
    const turns = Math.max(8, Math.round((r / FIRE_CELL) * 6));
    for (let n = 0; n < turns; n++) {
      // Start from the same side each time for the same spot, so it doesn't dither.
      const a = (n / turns) * Math.PI * 2 + (x * 0.37 + z * 0.61);
      const px = x + D.cos(a) * r;
      const pz = z + D.sin(a) * r;
      if (!ctx.field.contains(px, pz, 1) || fire.heatAt(px, pz) >= LIT * 0.5) continue;
      if (!ctx.navs.land.terrainAllowsAt(px, pz)) continue;
      return { x: px, z: pz };
    }
  }
  return null;
}
