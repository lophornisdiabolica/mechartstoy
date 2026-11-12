import { World } from '../../core/ecs';
import { Faction, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { Point } from '../../world/navGrid';
import * as D from '../../core/dmath';

/*
 * Shortcuts: where a land army's Commander would gain most from a timber
 * bridge of its own, even where there's a way round already. On a wet map
 * a land army's way to the enemy, or to an outpost on the next island, can
 * be twice as long as the crow flies, while hovercraft and boats go
 * straight over. So each side (all but Tidewater, which crosses water
 * anyway) looks along its shores for narrow water a bridge could span, and
 * weighs each place by how much shorter it makes the way from its rally
 * point to the enemy's base and to the outposts it doesn't hold (an island
 * no land unit could reach before counts for a lot). Places by enemy units
 * count for less, but not nothing: an engineer sent out past the front to
 * bridge a channel can be shot off it, and that's part of the game.
 *
 * The best place goes to the engineers as an urgent bridge job (see
 * Engineers.shortcutJob); it's looked at again every REPLAN seconds, and
 * kept while it's nearly as good as the best, so engineers aren't sent
 * back and forth. Units then find the bridge themselves: it's land on the
 * route grid like any other.
 */

/** Water a bridge is thrown across: at least this wide (narrower, units wade or go round easily), at most this wide (an engineers' bridge's reach, as GAP_SPAN). */
const MIN_WET = 3;
export const MAX_WET = 18;
/** How far from the shore cell the water must start. */
const SHORE_REACH = 2.25;
/** Step along a ray across the water. */
const RAY_STEP = 0.75;
/** Directions looked along from each shore cell. */
const DIRECTIONS = 16;
/** Places whose middles are this close are the same place (the narrowest kept). */
const BUCKET = 4;
/** A bridge has to make a way this much shorter (metres of route cost), and this share of it, to be worth it. */
const MIN_GAIN = 15;
const MIN_SHARE = 0.15;
/** What the way to a place no land unit can reach counts as, as a multiple of the map's width. */
const UNREACHABLE = 2;
/** How much each target counts: the enemy base, and each outpost the side doesn't hold (the nearest OUTPOSTS of them). */
const BASE_WEIGHT = 1;
const OUTPOST_WEIGHT = 0.5;
const OUTPOSTS = 4;
/** Enemy units within this of a place make it worth less: each this share more. */
const DANGER_REACH = 18;
const DANGER_PER = 0.12;
/** No bridging this near an enemy base (past its edge). */
const BASE_CLEAR = 16;
/** Seconds between looks at where to bridge. */
export const REPLAN = 20;
/** The place chosen is kept while it's at least this share as good as the best. */
const KEEP = 0.8;

/** A place a bridge could go: from a on one shore to b on the other, over `wet` metres of water. */
export interface Shortcut {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** The middle, and the way across (unit vector a to b). */
  x: number;
  z: number;
  ux: number;
  uz: number;
  wet: number;
}

/** A place chosen, and what it's worth. */
export interface ShortcutPick {
  spot: Shortcut;
  score: number;
}

export class Shortcuts {
  /** Places along the shores, for a version of the water. */
  private spots: { version: number; list: Shortcut[] } | null = null;
  /** Per side: the place chosen (or none) and when to look again. */
  private picks: ({ pick: ShortcutPick | null; until: number } | undefined)[] = [];

  /** The place a side's engineers should bridge now, if any (see the notes at the top). */
  pick(world: World, ctx: SimContext, side: number, enemy: number): ShortcutPick | null {
    const was = this.picks[side];
    if (was && world.time < was.until && (!was.pick || !ctx.field.nearBridge(was.pick.spot.x, was.pick.spot.z, BRIDGED))) return was.pick;
    const pick = this.choose(world, ctx, side, enemy, was?.pick ?? null);
    this.picks[side] = { pick, until: world.time + REPLAN };
    return pick;
  }

  /** Forget a side's pick (its bridge is up, or the place didn't work out), so it looks again next time. */
  drop(side: number): void {
    this.picks[side] = undefined;
  }

  /** Every place along the shores a bridge could span, worked out again when the water changes. */
  places(ctx: SimContext): Shortcut[] {
    const version = ctx.navs.for('naval').passableVersion;
    if (this.spots && this.spots.version === version) return this.spots.list;
    this.spots = { version, list: findPlaces(ctx) };
    return this.spots.list;
  }

  private choose(world: World, ctx: SimContext, side: number, enemy: number, current: ShortcutPick | null): ShortcutPick | null {
    const { field, lanes } = ctx;
    const places = this.places(ctx).filter((s) => !field.nearBridge(s.x, s.z, BRIDGED) && stillOpen(ctx, s));
    if (places.length === 0) return null;
    const nav = ctx.navs.land;
    const home = field.baseSites[side];
    const from = lanes.rally(side, enemy, 0);
    const fromCosts = nav.costsFrom(from);
    const cellOf = (x: number, z: number) => {
      const [i, j] = nav.cellOf(x, z);
      return j * nav.cols + i;
    };
    const far = field.width * UNREACHABLE;

    // What it's for: the enemy base, and the nearest outposts the side doesn't hold.
    const targets: { at: Point; weight: number }[] = [{ at: field.baseSites[enemy], weight: BASE_WEIGHT }];
    const outposts = ctx.outposts
      .filter((o) => o.owner !== side)
      .sort((a, b) => D.hypot(a.x - home.x, a.z - home.z) - D.hypot(b.x - home.x, b.z - home.z) || a.index - b.index)
      .slice(0, OUTPOSTS);
    for (const o of outposts) targets.push({ at: o, weight: OUTPOST_WEIGHT });

    const gains = new Float64Array(places.length);
    for (const target of targets) {
      const toCosts = nav.costsFrom(target.at);
      const nowRaw = fromCosts[cellOf(target.at.x, target.at.z)];
      const now = Number.isFinite(nowRaw) ? nowRaw : far;
      const need = Math.max(MIN_GAIN, now * MIN_SHARE);
      for (let k = 0; k < places.length; k++) {
        const s = places[k];
        const a = cellOf(s.ax, s.az);
        const b = cellOf(s.bx, s.bz);
        const span = D.hypot(s.bx - s.ax, s.bz - s.az);
        const via = Math.min(fromCosts[a] + span + toCosts[b], fromCosts[b] + span + toCosts[a]);
        const gain = now - via;
        if (gain >= need) gains[k] += target.weight * gain;
      }
    }

    // Enemy units near a place make it worth less.
    const foesNear = (x: number, z: number) => {
      let n = 0;
      ctx.grid.forEachNear(x, z, DANGER_REACH, (e) => {
        const f = world.get(e, Faction);
        if (f && world.has(e, Unit) && ctx.sides.hostile(side, f.id)) {
          const t = world.req(e, Transform);
          if (D.hypot(t.x - x, t.z - z) < DANGER_REACH) n++;
        }
      });
      return n;
    };
    const bases = ctx.sides.enemiesOf(side).map((g) => field.baseSites[g]);
    let best: ShortcutPick | null = null;
    let kept: ShortcutPick | null = null;
    for (let k = 0; k < places.length; k++) {
      if (gains[k] <= 0) continue;
      const s = places[k];
      if (bases.some((b) => D.hypot(b.x - s.x, b.z - s.z) < b.radius + BASE_CLEAR)) continue;
      const score = gains[k] / (1 + DANGER_PER * foesNear(s.x, s.z));
      if (!best || score > best.score) best = { spot: s, score };
      if (current && D.hypot(current.spot.x - s.x, current.spot.z - s.z) < 1) kept = { spot: s, score };
    }
    if (best && kept && kept.score >= best.score * KEEP) return kept;
    return best;
  }
}

/** A place this near a bridge (the map's or engineers') is bridged already. */
const BRIDGED = 10;

/** Whether both ends of a place are still dry land (the map changes: craters, fills, god powers). */
function stillOpen(ctx: SimContext, s: Shortcut): boolean {
  const nav = ctx.navs.land;
  return !ctx.field.isWater(s.ax, s.az) && !ctx.field.isWater(s.bx, s.bz) && nav.terrainAllowsAt(s.ax, s.az) && nav.terrainAllowsAt(s.bx, s.bz);
}

/**
 * Narrow water along the shores: from each shore cell (every other one),
 * rays out over the water in DIRECTIONS directions; one that crosses
 * MIN_WET to MAX_WET metres of water, all of it water (not a cliff), and
 * comes out on dry land a tracked vehicle can drive on, is a place. Of the
 * places with their middles in the same BUCKET, the narrowest is kept.
 */
function findPlaces(ctx: SimContext): Shortcut[] {
  const { field } = ctx;
  const nav = ctx.navs.land;
  const { cols, rows } = nav;
  const wet = (x: number, z: number) => field.isWater(x, z) && nav.terrainBlocksCell(x, z);
  const dry = (x: number, z: number) => field.contains(x, z, 4) && !field.isWater(x, z) && nav.terrainAllowsAt(x, z);
  const dirs: [number, number][] = [];
  for (let n = 0; n < DIRECTIONS; n++) {
    const a = (n / DIRECTIONS) * Math.PI * 2;
    dirs.push([D.cos(a), D.sin(a)]);
  }
  const buckets = new Map<string, Shortcut>();
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1 + (j % 2); i < cols - 1; i += 2) {
      const c = nav.center(i, j);
      if (!dry(c.x, c.z)) continue;
      const step = nav.cellSize;
      if (!wet(c.x + step, c.z) && !wet(c.x - step, c.z) && !wet(c.x, c.z + step) && !wet(c.x, c.z - step)) continue;
      for (const [ux, uz] of dirs) {
        let enter = -1;
        let land = -1;
        for (let s = RAY_STEP; s <= SHORE_REACH + MAX_WET + RAY_STEP; s += RAY_STEP) {
          const x = c.x + ux * s;
          const z = c.z + uz * s;
          if (enter < 0) {
            if (wet(x, z)) enter = s;
            else if (s > SHORE_REACH || !dry(x, z)) break;
            continue;
          }
          if (wet(x, z)) {
            if (s - enter > MAX_WET) break;
            continue;
          }
          // Out of the water: onto dry land, with a step more of it, or nothing (a cliff, the map's edge, a bridge deck).
          if (dry(x, z) && dry(x + ux * 1.5, z + uz * 1.5) && field.deckAt(x, z) === null) land = s;
          break;
        }
        if (enter < 0 || land < 0) continue;
        const width = land - enter;
        if (width < MIN_WET) continue;
        const bx = c.x + ux * (land + 1);
        const bz = c.z + uz * (land + 1);
        const spot: Shortcut = { ax: c.x, az: c.z, bx, bz, x: (c.x + bx) / 2, z: (c.z + bz) / 2, ux, uz, wet: width };
        const key = `${Math.round(spot.x / BUCKET)},${Math.round(spot.z / BUCKET)}`;
        const known = buckets.get(key);
        if (!known || width < known.wet) buckets.set(key, spot);
      }
    }
  }
  return [...buckets.values()];
}
