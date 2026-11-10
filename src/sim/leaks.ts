import { Game } from '../game/game';
import { BattleSettings } from '../game/settings';

/*
 * Leak checks for long battles (npm run leaks, and test/leaks.test.ts).
 *
 * A battle left running for hours should settle into a steady state: units
 * die as fast as they're built, so the number of entities levels off, and
 * everything the sim keeps about them should level off with it. A leak is
 * something that keeps growing anyway: a cache keyed by something that
 * never repeats (a squad number, an attack number, a position), a list
 * nothing ever trims, a listener added per battle and never removed.
 *
 * collectionSizes walks everything reachable from a Game and adds up the
 * size of every Map, Set and array, by where it was found (its path, with
 * [*] for "any element of"), so two samples of a battle show which ones
 * grew. leakRun plays a battle and samples it every so often; leakReport
 * picks out the collections that kept growing.
 */

/** How many elements each collection reachable from `root` holds, by path (collections at the same path inside different elements are added up). */
export function collectionSizes(root: object, rootName = 'game', maxDepth = 12): Map<string, number> {
  const sizes = new Map<string, number>();
  const seen = new Set<object>();
  // Breadth first, so an object reachable two ways is counted at its shortest path.
  let frontier: [object, string][] = [[root, rootName]];
  for (let depth = 0; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: [object, string][] = [];
    const visit = (value: unknown, path: string) => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      // Fixed-size buffers (heightmaps, route grids) can't grow.
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
      next.push([value, path]);
    };
    for (const [obj, path] of frontier) {
      if (seen.has(obj)) continue;
      seen.add(obj);
      if (obj instanceof Map) {
        sizes.set(path, (sizes.get(path) ?? 0) + obj.size);
        for (const [k, v] of obj) {
          visit(k, `${path}[key]`);
          visit(v, `${path}[*]`);
        }
      } else if (obj instanceof Set) {
        sizes.set(path, (sizes.get(path) ?? 0) + obj.size);
        for (const v of obj) visit(v, `${path}[*]`);
      } else if (Array.isArray(obj)) {
        sizes.set(path, (sizes.get(path) ?? 0) + obj.length);
        for (const v of obj) visit(v, `${path}[*]`);
      } else {
        for (const key of Object.keys(obj)) {
          let v: unknown;
          try {
            v = (obj as Record<string, unknown>)[key];
          } catch {
            continue;
          }
          visit(v, `${path}.${key}`);
        }
      }
    }
    frontier = next;
  }
  return sizes;
}

export interface LeakSample {
  /** Battle time, minutes. */
  minute: number;
  /** Live entities. */
  entities: number;
  /** JS heap in use (MB) after a garbage collection, if the runtime lets us force one (node --expose-gc). */
  heapMB: number | null;
  sizes: Map<string, number>;
}

/** Play a battle for `minutes`, sampling it every `every` minutes (and at the start). */
export function leakRun(settings: BattleSettings, seed: number, minutes: number, every: number, progress?: (s: LeakSample) => void): LeakSample[] {
  const game = new Game(seed, { settings });
  const samples: LeakSample[] = [];
  const dt = 1 / 30;
  const sample = () => {
    const s: LeakSample = { minute: game.world.time / 60, entities: [...game.world.entities()].length, heapMB: heapMB(), sizes: collectionSizes(game) };
    samples.push(s);
    progress?.(s);
  };
  sample();
  for (let m = every; m <= minutes + 1e-9; m += every) {
    while (game.world.time < m * 60 && game.outcome === null) game.step(dt);
    sample();
    if (game.outcome !== null) break;
  }
  return samples;
}

function heapMB(): number | null {
  const g = globalThis as { gc?: () => void; process?: { memoryUsage(): { heapUsed: number } } };
  if (!g.gc || !g.process) return null;
  g.gc();
  return g.process.memoryUsage().heapUsed / (1024 * 1024);
}

/**
 * Collections that grow for a while but have a cap in the code, so they
 * can't grow for ever (with where the cap is).
 */
export const BOUNDED: Record<string, string> = {
  // Cleared once it holds 500 picks (Sides.target).
  'game.ctx.sides.targets': 'Sides.target',
  // A ring of the last CHANGE_LOG map and obstacle changes (NavObstacles).
  'game.ctx.nav.obstacles.log': 'NavObstacles.record',
  'game.ctx.navs.land.obstacles.log': 'NavObstacles.record',
};

export interface Grower {
  path: string;
  /** Its size at the first sample after warm-up, and at the end. */
  from: number;
  to: number;
}

/**
 * The collections that kept growing after warm-up: bigger at every sample
 * from `warmup` minutes on (allowing `slack` dips), by at least `least`
 * elements and more than the battle's entities grew in proportion.
 */
export function leakReport(samples: LeakSample[], warmup: number, least = 20, slack = 1): Grower[] {
  const after = samples.filter((s) => s.minute >= warmup - 1e-9);
  if (after.length < 3) return [];
  const first = after[0];
  const last = after[after.length - 1];
  const entityGrowth = last.entities / Math.max(1, first.entities);
  const out: Grower[] = [];
  for (const [path, to] of last.sizes) {
    if (path in BOUNDED) continue;
    const from = first.sizes.get(path) ?? 0;
    if (to - from < least || to <= from * Math.max(1.25, entityGrowth * 1.25)) continue;
    let dips = 0;
    for (let k = 1; k < after.length; k++) if ((after[k].sizes.get(path) ?? 0) < (after[k - 1].sizes.get(path) ?? 0)) dips++;
    if (dips > slack) continue;
    out.push({ path, from, to });
  }
  return out.sort((a, b) => b.to - b.from - (a.to - a.from));
}
