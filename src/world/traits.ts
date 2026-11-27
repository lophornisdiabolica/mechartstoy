import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import type { Battlefield } from './battlefield';
import type { PropKind } from './biomes';
import * as D from '../core/dmath';

/**
 * Map traits: one or two special features laid over a map's style, each a
 * headline for the battle ("ridge line, with an oil field"). Each is placed
 * on contested ground (about as far from one side as from the other), near
 * the middle where the lanes run: its spot is picked before the towns and
 * outposts, which keep round it (see planTraits), and it's built once
 * everything else is, on its own random stream, so a map with no traits is
 * the same map as ever.
 *
 * A trait is mostly what it leaves standing: relics (see RELICS in
 * game/buildings.ts), nobody's buildings that stop shots and block the way
 * like any other, so they're cover for whoever gets there first and are
 * slowly shot to pieces; ground of its own; and scenery. What a trait does
 * during the battle is in game/traits.ts.
 *
 * - Old battlefield: craters, junk heaps and the hulks of tanks from an
 *   earlier fight, picked clean long ago (no salvage for the scrap sides).
 * - Fortified line: a broken line of old walls and pillboxes right across
 *   the middle, between the sides.
 * - Crashed hulk: the wreck of a giant machine, building-sized, at the end
 *   of the furrow it ploughed coming down. Huge cover, and the scrap round
 *   it never runs out, so the scrap sides (Hive, Lodestar) feed on it.
 * - Oil field: derricks over pools of crude. A shell bursting on a pool
 *   sets it alight, the fire running across it and burning everyone in it,
 *   and a derrick blows up when it's destroyed. A pool by a standing derrick
 *   fills back up.
 * - Geysers: vents that blow steam every half minute or so, thick enough
 *   to throw shots off for a few seconds, and to hide stealthy units.
 * - Ancient ruins: columns and broken temple walls on old paving. Soldiers
 *   in the ruins take half a burst that lands outside them (like a trench).
 * - Sacred grove: a ring of giant trees round a clearing, a few ways in.
 *   Dense forest, so vehicles go round it, and the giants take a lot of
 *   felling; at home for the woodland sides (Verdant), whose shots slip
 *   between the trunks.
 * - Citadel and landing field: outposts of their own (see game/outposts.ts),
 *   added to the map's outposts: a walled fortress as near the middle as it
 *   fits, and a big paved pad.
 * - Rail line: a railway across no-man's land, between the sides, on a
 *   graded bed, with a station (an outpost) a third of the way along from
 *   each end. Whoever holds a station gets an armoured train that runs up
 *   and down the line (see game/rail.ts).
 */
export type MapTrait = 'oldField' | 'fortLine' | 'hulk' | 'oil' | 'geysers' | 'ruins' | 'grove' | 'citadel' | 'landing' | 'rail';

export const MAP_TRAITS: Record<MapTrait, { label: string; blurb: string }> = {
  oldField: { label: 'Old battlefield', blurb: 'Craters, junk and the hulks of an earlier fight' },
  fortLine: { label: 'Fortified line', blurb: 'A broken line of old walls and pillboxes across the middle' },
  hulk: { label: 'Crashed hulk', blurb: 'The wreck of a giant machine: huge cover and endless scrap' },
  oil: { label: 'Oil field', blurb: 'Derricks over pools of crude that burn when hit' },
  geysers: { label: 'Geysers', blurb: 'Steam vents whose plumes throw shots off and hide stealthy units' },
  ruins: { label: 'Ancient ruins', blurb: 'Columns and broken walls: cover for infantry' },
  grove: { label: 'Sacred grove', blurb: 'A ring of giant trees round a clearing' },
  citadel: { label: 'Citadel', blurb: 'A walled fortress in the middle with a strong garrison: whoever cracks it builds faster' },
  landing: { label: 'Landing field', blurb: 'A big paved pad: aircraft and drops come faster for whoever holds it' },
  rail: { label: 'Rail line', blurb: 'A railway across no-man’s land with two stations: whoever holds one gets an armoured train on the line' },
};

export const MAP_TRAIT_IDS = Object.keys(MAP_TRAITS) as MapTrait[];

export function isMapTrait(v: string): v is MapTrait {
  return v in MAP_TRAITS;
}

/** The buildings traits leave standing (see game/buildings.ts). */
export type RelicId = 'oldHulk' | 'oldWall' | 'pillbox' | 'crashedHulk' | 'derrick' | 'column' | 'ruinWall';

/** One relic to put up when the battle starts: nobody's (see RELIC in game/components.ts). */
export interface Relic {
  building: RelicId;
  x: number;
  z: number;
  heading: number;
}

/** Where a trait was put. */
export interface TraitSite {
  kind: MapTrait;
  x: number;
  z: number;
  radius: number;
}

/** A geyser's vent: it blows for `length` seconds every `period`, starting `phase` seconds in. */
export interface Vent {
  x: number;
  z: number;
  period: number;
  length: number;
  phase: number;
}

/** Scenery a trait adds (see world/props.ts). */
export interface TraitProp {
  kind: PropKind;
  x: number;
  z: number;
  scale: number;
  rotation: number;
}

/**
 * A rail line's track: points a step apart along it, from one end to the
 * other (see railAt). Trains run on it, nothing else is held to it.
 */
export interface RailLine {
  points: { x: number; z: number }[];
  step: number;
}

/** What traits added to a map. */
export interface TraitLayout {
  sites: TraitSite[];
  relics: Relic[];
  vents: Vent[];
  props: TraitProp[];
  rail: RailLine | null;
}

export function emptyTraits(): TraitLayout {
  return { sites: [], relics: [], vents: [], props: [], rail: null };
}

/** Map area (in cells) sizes are per: a Medium map's. */
const PER_AREA = 84 * 64;
/** Spots tried for each trait. */
const TRIES = 90;
/** Tree size at and above which a tree is one of a grove's giants (see woods.ts). */
export const GIANT = 1.6;
/** Each trait's own random stream, by its place here (so adding a trait leaves the others' layouts alone). */
const STREAMS: MapTrait[] = ['hulk', 'grove', 'ruins', 'oil', 'oldField', 'geysers', 'fortLine', 'citadel', 'landing', 'rail'];
/** Order traits are placed in: the outposts of their own, then the biggest first, the line across everything last. */
const ORDER: MapTrait[] = ['citadel', 'landing', 'rail', 'hulk', 'grove', 'ruins', 'oil', 'oldField', 'geysers', 'fortLine'];

/** Room a trait plans round (the hill, say), given before anything else is placed. */
export interface Taken {
  x: number;
  z: number;
  r: number;
}

/**
 * Pick the traits' spots before the towns and outposts go down (see
 * generateBattlefield), so the traits get the middle of the map, where the
 * lanes run, and the towns and outposts keep round them. Not on maps with
 * a city: the city takes the middle, and the traits are placed last, round
 * it (see placeTraits). The fortified line and the rail line aren't
 * planned: they run across everything (the rail keeps off what's planned:
 * see railLine). A citadel or landing field (an outpost of its own) plans
 * first, the citadel taking the very middle.
 */
export function planTraits(field: Battlefield, traits: readonly MapTrait[], rng: Rng, taken: readonly Taken[]): TraitSite[] {
  const planned: TraitSite[] = [];
  const scale = traitScale(field);
  for (const kind of ORDER) {
    if (!traits.includes(kind) || kind === 'fortLine' || kind === 'rail') continue;
    const r = rng.fork(0x7400 + STREAMS.indexOf(kind));
    const at = kind === 'citadel' || kind === 'landing' ? heldSpot(field, planned, kind, r, taken) : spotFor(field, planned, kind, scale, r, taken);
    if (at) planned.push(at);
  }
  return planned;
}

/** Lay out the traits on a finished map (see generateBattlefield), at the spots planned for them, or wherever they fit now. */
export function placeTraits(field: Battlefield, traits: readonly MapTrait[], rng: Rng, flatten: (x: number, z: number, radius: number, height: number) => void, planned: readonly TraitSite[] = []): void {
  const out = field.traits;
  const scale = traitScale(field);
  for (const kind of ORDER) {
    if (!traits.includes(kind)) continue;
    const index = STREAMS.indexOf(kind);
    if (kind === 'fortLine') {
      fortLine(field, out, rng.fork(0x7400 + index));
      continue;
    }
    if (kind === 'citadel' || kind === 'landing') {
      held(field, out, kind, rng.fork(0x7400 + index), flatten, planned);
      continue;
    }
    if (kind === 'rail') {
      railLine(field, out, rng.fork(0x7400 + index), flatten, planned);
      continue;
    }
    const site = planned.find((p) => p.kind === kind) ?? spotFor(field, [...out.sites, ...planned], kind, scale, rng.fork(0x7400 + index), []);
    if (!site) continue;
    out.sites.push(site);
    BUILDERS[kind](field, out, site.x, site.z, site.radius, rng.fork(0x7480 + index), scale);
  }
}

function traitScale(field: Battlefield): number {
  return Math.max(0.8, Math.min(1.7, Math.sqrt((field.config.cols * field.config.rows) / PER_AREA)));
}

/** A spot for a trait, smaller if it doesn't fit at full size (a crowded map, or a second trait). */
function spotFor(field: Battlefield, sites: readonly TraitSite[], kind: Exclude<MapTrait, 'fortLine' | 'citadel' | 'landing' | 'rail'>, scale: number, rng: Rng, taken: readonly Taken[]): TraitSite | null {
  let radius = RADII[kind] * scale;
  let at = findSpot(field, sites, radius, rng, taken);
  if (!at) at = findSpot(field, sites, (radius *= 0.7), rng, taken);
  return at && { kind, x: at.x, z: at.z, radius };
}

const RADII: Record<Exclude<MapTrait, 'fortLine' | 'citadel' | 'landing' | 'rail'>, number> = { oldField: 17, hulk: 10, oil: 13, geysers: 18, ruins: 11, grove: 12.5 };

type Builder = (field: Battlefield, out: TraitLayout, x: number, z: number, radius: number, rng: Rng, scale: number) => void;

const BUILDERS: Record<Exclude<MapTrait, 'fortLine' | 'citadel' | 'landing' | 'rail'>, Builder> = {
  oldField(field, out, x, z, radius, rng, scale) {
    // Craters first, so the hulks and junk sit in them.
    for (let n = Math.round(8 * scale); n > 0; n--) {
      const p = within(rng, x, z, radius);
      const r = rng.range(1.8, 3.6);
      if (free(field, out, p.x, p.z, r * 1.6)) dent(field, p.x, p.z, r, r * rng.range(0.25, 0.4));
    }
    const hulks: { x: number; z: number }[] = [];
    for (let n = 0, tries = 0; n < Math.round(6 * scale) && tries < 60; tries++) {
      const p = within(rng, x, z, radius);
      if (!free(field, out, p.x, p.z, 2) || hulks.some((h) => D.hypot(h.x - p.x, h.z - p.z) < 4)) continue;
      hulks.push(p);
      out.relics.push({ building: 'oldHulk', x: p.x, z: p.z, heading: rng.range(-Math.PI, Math.PI) });
      field.paint(p.x, p.z, 1.8, 'scrap', (g) => g === 'plain');
      n++;
    }
    scatter(field, out, rng, x, z, radius, Math.round(14 * scale), 'junk', 0.6, 1.1);
  },

  hulk(field, out, x, z, radius, rng) {
    const heading = rng.range(-Math.PI, Math.PI);
    // The furrow it ploughed coming down, behind it, with the earth thrown up either side.
    const ux = -D.cos(-heading);
    const uz = -D.sin(-heading);
    const length = radius * 1.7;
    const heights = field.heights;
    eachVertex(field, x, z, length + 4, (k, vx, vz) => {
      const along = (vx - x) * ux + (vz - z) * uz;
      if (along < 2 || along > length || nearRail(field, vx, vz, RAIL_CLEAR)) return;
      const off = Math.abs((vx - x) * -uz + (vz - z) * ux);
      const fade = 1 - along / length;
      const half = 1.6 + 1.2 * fade;
      if (off < half) heights[k] -= 1.1 * fade * (1 - (off / half) * (off / half));
      else if (off < half * 2) heights[k] += 0.45 * fade * (1 - (off - half) / half);
    });
    // Half buried where it stopped (not on a rail line, should one run through).
    level(field, x, z, 5.5, field.heightAt(x, z) - 0.4, 0.8);
    if (!nearRail(field, x, z, RELIC_RADIUS.crashedHulk + 2)) out.relics.push({ building: 'crashedHulk', x, z, heading });
    field.paint(x, z, radius * 0.75, 'scrap', (g, cx, cz) => g === 'plain' && !field.isWater(cx, cz));
    scatter(field, out, rng, x, z, radius, 12, 'junk', 0.7, 1.3);
  },

  oil(field, out, x, z, radius, rng, scale) {
    const derricks: { x: number; z: number }[] = [];
    for (let tries = 0; derricks.length < Math.round(3.5 * scale) && tries < 60; tries++) {
      const p = within(rng, x, z, radius * 0.8);
      if (!free(field, out, p.x, p.z, 2.5) || derricks.some((d) => D.hypot(d.x - p.x, d.z - p.z) < 6)) continue;
      derricks.push(p);
      out.relics.push({ building: 'derrick', x: p.x, z: p.z, heading: rng.range(-Math.PI, Math.PI) });
    }
    if (derricks.length === 0) return;
    // A pool beside each derrick, and one or two more of their own.
    const pools = derricks.map((d) => {
      const a = rng.range(-Math.PI, Math.PI);
      const dist = rng.range(3, 4);
      return { x: d.x + D.cos(a) * dist, z: d.z + D.sin(a) * dist };
    });
    for (let n = rng.int(1, 2); n > 0; n--) pools.push(within(rng, x, z, radius * 0.9));
    for (const p of pools) {
      const r = rng.range(2.2, 3.4);
      // Two overlapping blobs, so it isn't a plain disc.
      const a = rng.range(-Math.PI, Math.PI);
      for (const [cx, cz, cr] of [
        [p.x, p.z, r],
        [p.x + D.cos(a) * r * 0.7, p.z + D.sin(a) * r * 0.7, r * 0.7],
      ]) {
        field.paint(cx, cz, cr, 'oil', (g, px, pz) => g === 'plain' && dry(field, px, pz) && !relicNear(out, px, pz, 0.6));
      }
    }
    scatter(field, out, rng, x, z, radius, 6, 'junk', 0.5, 0.8);
  },

  geysers(field, out, x, z, radius, rng, scale) {
    const vents: Vent[] = [];
    for (let tries = 0; vents.length < Math.round(5 * scale) && tries < 80; tries++) {
      const p = within(rng, x, z, radius);
      if (!free(field, out, p.x, p.z, 2) || vents.some((v) => D.hypot(v.x - p.x, v.z - p.z) < 7)) continue;
      const period = rng.range(22, 40);
      vents.push({ x: p.x, z: p.z, period, length: rng.range(5, 8), phase: rng.range(0, period) });
      out.props.push({ kind: 'vent', x: p.x, z: p.z, scale: rng.range(0.85, 1.2), rotation: rng.range(0, Math.PI * 2) });
    }
    out.vents.push(...vents);
  },

  ruins(field, out, x, z, radius, rng) {
    level(field, x, z, radius, field.heightAt(x, z), 0.65);
    const noise = createNoise2D(() => rng.next());
    field.paint(x, z, radius, 'paving', (g, cx, cz) => g === 'plain' && dry(field, cx, cz) && noise(cx / 5, cz / 5) > -0.35 - 0.6 * (1 - D.hypot(cx - x, cz - z) / radius));
    // A temple: two rows of columns, some fallen, and what's left of its back wall.
    const h = rng.range(-Math.PI, Math.PI);
    const ax = D.cos(h);
    const az = D.sin(h);
    const at = (along: number, across: number) => ({ x: x + ax * along - az * across, z: z + az * along + ax * across });
    const facing = -h;
    for (const across of [-2.8, 2.8]) {
      for (let along = -5; along <= 5.01; along += 2.5) {
        const p = at(along, across);
        if (!free(field, out, p.x, p.z, 0.8)) continue;
        if (rng.chance(0.3)) out.props.push({ kind: 'fallenColumn', x: p.x, z: p.z, scale: rng.range(0.9, 1.1), rotation: rng.range(0, Math.PI * 2) });
        else out.relics.push({ building: 'column', x: p.x, z: p.z, heading: facing });
      }
    }
    for (const across of [-1.3, 1.3]) {
      const p = at(-6.6, across);
      if (rng.chance(0.8) && free(field, out, p.x, p.z, 1.4)) out.relics.push({ building: 'ruinWall', x: p.x, z: p.z, heading: facing });
    }
    // Broken walls and the odd column about the rest of it.
    for (let n = 0, tries = 0; n < 5 && tries < 40; tries++) {
      const p = within(rng, x, z, radius * 0.9);
      if (D.hypot(p.x - x, p.z - z) < 7.5 || !free(field, out, p.x, p.z, 1.5)) continue;
      out.relics.push({ building: rng.chance(0.6) ? 'ruinWall' : 'column', x: p.x, z: p.z, heading: rng.range(-Math.PI, Math.PI) });
      n++;
    }
    scatter(field, out, rng, x, z, radius, 8, 'rock', 0.4, 0.8);
  },

  grove(field, out, x, z, radius, rng) {
    const ring = radius * 0.75;
    const band = 1.9;
    const noise = createNoise2D(() => rng.next());
    // A few ways in.
    const count = rng.int(2, 3);
    const turn = rng.range(-Math.PI, Math.PI);
    const gaps = Array.from({ length: count }, (_, n) => turn + (n / count) * Math.PI * 2 + rng.range(-0.4, 0.4));
    const { cols, rows, cellSize } = field.config;
    const [i0, j0] = field.cellAt(x - radius - 2, z - radius - 2);
    const [i1, j1] = field.cellAt(x + radius + 2, z + radius + 2);
    const cells: number[] = [];
    for (let j = j0; j <= Math.min(j1, rows - 1); j++) {
      for (let i = i0; i <= Math.min(i1, cols - 1); i++) {
        const cx = field.bounds.minX + (i + 0.5) * cellSize;
        const cz = field.bounds.minZ + (j + 0.5) * cellSize;
        const d = D.hypot(cx - x, cz - z) + 1.2 * noise(cx / 6, cz / 6);
        if (Math.abs(d - ring) > band) continue;
        const a = D.atan2(cz - z, cx - x);
        if (gaps.some((g) => Math.abs(D.atan2(D.sin(a - g), D.cos(a - g))) < 2.4 / ring)) continue;
        if (!dry(field, cx, cz) || field.slopeAt(cx, cz) > 0.6 || field.roadCell[j * cols + i] || field.nearBridge(cx, cz, 3) || nearRail(field, cx, cz, RAIL_CLEAR)) continue;
        if (relicNear(out, cx, cz, 1.5)) continue;
        cells.push(j * cols + i);
        if (rng.chance(0.85)) field.woods.add(cx + rng.range(-0.3, 0.3) * cellSize, cz + rng.range(-0.3, 0.3) * cellSize, rng.range(GIANT + 0.2, GIANT + 0.9));
      }
    }
    field.setGround(cells, 'thicket');
    // Standing stones in the clearing.
    const stones = rng.int(4, 6);
    for (let n = 0; n < stones; n++) {
      const a = (n / stones) * Math.PI * 2;
      out.props.push({ kind: 'rock', x: x + D.cos(a) * 2.6, z: z + D.sin(a) * 2.6, scale: rng.range(0.9, 1.2), rotation: rng.range(0, Math.PI * 2) });
    }
  },
};

/**
 * Fortified line: a broken line of old walls and pillboxes across the map,
 * square across the way between the first base and the base furthest from
 * it, wavering a little. Runs of four to seven walls, gaps between them wide
 * enough for a tank, a pillbox every thirty-odd paces; gaps wherever the line
 * meets water, a road, a bridge, a town or another trait.
 */
function fortLine(field: Battlefield, out: TraitLayout, rng: Rng): void {
  const bases = field.baseSites;
  const a = bases[0];
  let b = bases[1];
  for (const s of bases) if (D.hypot(s.x - a.x, s.z - a.z) > D.hypot(b.x - a.x, b.z - a.z)) b = s;
  const len = D.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = (b.x - a.x) / len;
  const nz = (b.z - a.z) / len;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const sway = rng.range(1.5, 3.5);
  const wave = rng.range(14, 22);
  const phase = rng.range(0, Math.PI * 2);
  const offset = (s: number) => sway * D.sin(s / wave + phase);
  const point = (s: number) => ({ x: mx - nz * s + nx * offset(s), z: mz + nx * s + nz * offset(s) });
  const reach = Math.max(field.width, field.depth);
  const STEP = 2.6;
  let run = rng.int(4, 7);
  let gap = 0;
  let sinceBox = 0;
  let boxEvery = rng.range(12, 24);
  let built = 0;
  for (let s = -reach; s <= reach; s += STEP) {
    const p = point(s);
    if (!field.contains(p.x, p.z, 3)) continue;
    sinceBox += STEP;
    if (gap > 0) {
      gap--;
      continue;
    }
    // The way the line runs here, for the walls to lie along it.
    const q = point(s + 0.5);
    const tx = q.x - p.x;
    const tz = q.z - p.z;
    const heading = -D.atan2(tx, -tz);
    const pillbox = sinceBox >= boxEvery;
    const r = pillbox ? 2 : 1.5;
    // Walls stand end to end (closer than relics usually may).
    if (!free(field, out, p.x, p.z, r, -1.4) || out.sites.some((t) => D.hypot(t.x - p.x, t.z - p.z) < t.radius + 2)) {
      run = rng.int(4, 7);
      continue;
    }
    if (pillbox) {
      out.relics.push({ building: 'pillbox', x: p.x, z: p.z, heading });
      sinceBox = 0;
      boxEvery = rng.range(26, 38);
    } else {
      out.relics.push({ building: 'oldWall', x: p.x, z: p.z, heading });
    }
    built++;
    if (--run <= 0) {
      run = rng.int(4, 7);
      gap = 2;
    }
  }
  if (built > 0) out.sites.push({ kind: 'fortLine', x: mx, z: mz, radius: 0 });
}

/** Outpost radius (see OUTPOST_RADIUS in battlefield.ts) for the citadel and the landing field: they're bigger than the usual. */
export const HELD_RADIUS: Record<'citadel' | 'landing', number> = { citadel: 9.5, landing: 9 };

/**
 * A citadel or landing field: an outpost of its own, levelled like any other.
 * The citadel goes as near the middle as it fits (the most contested
 * ground); the landing field anywhere contested. The landing field's pad is
 * paved.
 */
function held(field: Battlefield, out: TraitLayout, kind: 'citadel' | 'landing', rng: Rng, flatten: (x: number, z: number, radius: number, height: number) => void, planned: readonly TraitSite[]): void {
  const radius = HELD_RADIUS[kind];
  // Where it planned to go (the outposts kept clear), or clear of the outposts already there and the other traits' ground.
  const at = planned.find((p) => p.kind === kind) ?? heldSpot(field, [...out.sites, ...planned], kind, rng, []);
  if (!at) return;
  const height = Math.max(field.seaLevel + 1, field.heightAt(at.x, at.z));
  flatten(at.x, at.z, radius, height);
  field.outpostSites.push({ index: field.outpostSites.length, kind, x: at.x, z: at.z, radius, height });
  out.sites.push({ kind, x: at.x, z: at.z, radius: radius + 2 });
  if (kind === 'landing') field.paint(at.x, at.z, radius * 0.9, 'apron', (g, cx, cz) => g === 'plain' && !field.isWater(cx, cz));
}

/** A spot for a citadel or landing field (its site's radius takes in its walls or apron). */
function heldSpot(field: Battlefield, sites: readonly TraitSite[], kind: 'citadel' | 'landing', rng: Rng, taken: readonly Taken[]): TraitSite | null {
  const radius = HELD_RADIUS[kind];
  const at = findSpot(field, sites, radius + 3, rng, taken, kind === 'citadel' ? 1.2 : 0.25, true);
  return at && { kind, x: at.x, z: at.z, radius: radius + 2 };
}

/** Outpost radius for a rail station, and how far from the track its middle stands (its towers clear the trains). */
export const STATION_RADIUS = 10;
const STATION_OFFSET = 8.5;
/** Track spacing, and how wide the graded bed is. */
const RAIL_STEP = 1;
const RAIL_BED = 1.6;

/**
 * A rail line: tries gently curving lines across the map, square to the
 * line between the first two bases and near the middle, and keeps the one
 * with the longest dry, clear run (at least most of the way across) over
 * the gentlest ground. Then a station a third of the way in from each end,
 * set back from the track, and the bed graded to an easy slope under the
 * track, laid with ballast. It would rather go round the ground other
 * traits planned (see planTraits), and they keep their relics, pools and
 * digging off it where it doesn't (see free).
 */
function railLine(field: Battlefield, out: TraitLayout, rng: Rng, flatten: (x: number, z: number, radius: number, height: number) => void, planned: readonly TraitSite[]): void {
  if (field.baseSites.length < 2) return;
  const [a, b] = field.baseSites;
  const axis = D.atan2(b.z - a.z, b.x - a.x);
  const cx = (a.x + b.x) * 0.25;
  const cz = (a.z + b.z) * 0.25;
  const reach = D.hypot(field.width, field.depth) * 0.5;
  const need = Math.min(field.width, field.depth) * 0.5;
  let best: { x: number; z: number }[] | null = null;
  let bestScore = Infinity;
  for (let n = 0; n < 100; n++) {
    // Square across the bases' line at first, then any way across.
    const angle = axis + Math.PI / 2 + rng.range(-0.45, 0.45) * (n < 60 ? 1 : 3);
    const off = rng.range(-0.3, 0.3) * Math.min(field.width, field.depth);
    const ox = cx + D.cos(axis) * off;
    const oz = cz + D.sin(axis) * off;
    const bend = rng.range(-1, 1) * reach * 0.12;
    const dx = D.cos(angle);
    const dz = D.sin(angle);
    let run: { x: number; z: number }[] = [];
    let longest: { x: number; z: number }[] = [];
    for (let t = -reach; t <= reach; t += RAIL_STEP) {
      const sway = bend * D.sin((Math.PI * (t + reach)) / (2 * reach));
      const x = ox + dx * t - dz * sway;
      const z = oz + dz * t + dx * sway;
      if (field.contains(x, z, 3) && trackFree(field, out, x, z)) run.push({ x, z });
      else {
        if (run.length > longest.length) longest = run;
        run = [];
      }
    }
    if (run.length > longest.length) longest = run;
    const length = longest.length * RAIL_STEP;
    if (length < need) continue;
    let rough = 0;
    for (let k = 1; k < longest.length; k++) rough += Math.abs(field.heightAt(longest[k].x, longest[k].z) - field.heightAt(longest[k - 1].x, longest[k - 1].z));
    // Contested: the run's middle about as far from either base.
    const mid = longest[Math.floor(longest.length / 2)];
    const contest = Math.abs(D.hypot(mid.x - a.x, mid.z - a.z) - D.hypot(mid.x - b.x, mid.z - b.z));
    // Through another trait's planned ground only if there's no good way round.
    const through = longest.filter((p) => planned.some((t) => t.kind !== 'citadel' && t.kind !== 'landing' && D.hypot(t.x - p.x, t.z - p.z) < t.radius * 0.6 + 2.5)).length;
    const score = rough + contest - length * 0.25 + through * 1.5 + rng.range(0, 2);
    if (score < bestScore) {
      bestScore = score;
      best = longest;
    }
  }
  if (!best) return;
  const points = best.slice(2, -2);
  // An outpost the track runs past becomes a station (two at most); then a new station a third of the
  // way in from each end that has none, on whichever side of the track has room.
  const passed = field.outpostSites
    .filter((o) => o.kind !== 'hill')
    .map((o) => ({ o, d: Math.min(...points.map((p) => D.hypot(p.x - o.x, p.z - o.z))) }))
    .filter((p) => p.d < STATION_RADIUS)
    .sort((p, q) => p.d - q.d)
    .slice(0, 2);
  for (const { o } of passed) o.kind = 'station';
  const stations: { x: number; z: number }[] = passed.map(({ o }) => ({ x: o.x, z: o.z }));
  const added = stations.length;
  for (const f of [0.3, 0.7]) {
    if (stations.length >= 2) break;
    // Not where a station already stands.
    const at0 = points[Math.round(f * (points.length - 1))];
    if (stations.some((st) => D.hypot(st.x - at0.x, st.z - at0.z) < STATION_RADIUS * 3)) continue;
    let at: { x: number; z: number } | null = null;
    for (const nudge of [0, 0.06, -0.06, 0.12, -0.12]) {
      const k = Math.round((f + nudge) * (points.length - 1));
      const p = points[k];
      const q = points[Math.min(points.length - 1, k + 1)];
      const o = points[Math.max(0, k - 1)];
      const len = D.hypot(q.x - o.x, q.z - o.z) || 1;
      for (const side of rng.next() < 0.5 ? [1, -1] : [-1, 1]) {
        const x = p.x - ((q.z - o.z) / len) * STATION_OFFSET * side;
        const z = p.z + ((q.x - o.x) / len) * STATION_OFFSET * side;
        if (stationFits(field, out, [...stations], points, x, z) && !planned.some((t) => D.hypot(t.x - x, t.z - z) < t.radius * 0.6 + STATION_RADIUS)) {
          at = { x, z };
          break;
        }
      }
      if (at) break;
    }
    if (at) stations.push(at);
  }
  if (stations.length === 0) return;
  for (const st of stations.slice(added)) {
    const height = Math.max(field.seaLevel + 1, field.heightAt(st.x, st.z));
    flatten(st.x, st.z, STATION_RADIUS, height);
    field.outpostSites.push({ index: field.outpostSites.length, kind: 'station', x: st.x, z: st.z, radius: STATION_RADIUS, height });
    out.sites.push({ kind: 'rail', x: st.x, z: st.z, radius: STATION_RADIUS + 1 });
  }
  // Grade the bed: the ground along the track, smoothed out, so the trains run on an easy slope.
  let profile = points.map((p) => Math.max(field.seaLevel + 0.6, field.heightAt(p.x, p.z)));
  for (let pass = 0; pass < 3; pass++) {
    profile = profile.map((_, k) => {
      let sum = 0;
      let n = 0;
      for (let q = Math.max(0, k - 6); q <= Math.min(profile.length - 1, k + 6); q++) {
        sum += profile[q];
        n++;
      }
      return sum / n;
    });
  }
  const nearest = new Map<number, { d: number; h: number }>();
  points.forEach((p, k) => {
    eachVertex(field, p.x, p.z, RAIL_BED + 1.5, (v, vx, vz) => {
      const d = D.hypot(vx - p.x, vz - p.z);
      const was = nearest.get(v);
      if (d <= RAIL_BED + 1.5 && (!was || d < was.d)) nearest.set(v, { d, h: profile[k] });
    });
  });
  const heights = field.heights;
  for (const [v, { d, h }] of nearest) {
    const t = d <= RAIL_BED ? 1 : 1 - (d - RAIL_BED) / 1.5;
    heights[v] += (h - heights[v]) * t;
  }
  for (const p of points) field.paint(p.x, p.z, 1.3, 'ballast', (g) => g === 'plain' || g === 'scrap' || g === 'felled' || g === 'thicket');
  // Bits of track as trait sites, so the woods, the scenery and other traits keep off it.
  for (let k = 0; k < points.length; k += 4) out.sites.push({ kind: 'rail', x: points[k].x, z: points[k].z, radius: 2.5 });
  out.rail = { points, step: RAIL_STEP };
}

/** Whether track can go here: dry, gentle, open ground clear of the bases, towns, outposts and bridges. */
function trackFree(field: Battlefield, out: TraitLayout, x: number, z: number): boolean {
  if (!dry(field, x, z) || field.sheerAt(x, z) || field.slopeAt(x, z) > 0.9) return false;
  if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius * 1.35 + 3)) return false;
  // It can run through a town (its houses keep off the track: see nearRail), not a city.
  if (field.inCity(x, z, 2)) return false;
  // It can run past an outpost's side, clear of its towers: that outpost becomes a station (see railLine).
  if (field.outpostSites.some((o) => D.hypot(o.x - x, o.z - z) < (o.kind === 'hill' ? o.radius + 3 : STATION_OFFSET - 1))) return false;
  if (field.nearBridge(x, z, 3)) return false;
  return !out.sites.some((t) => t.radius > 0 && D.hypot(t.x - x, t.z - z) < t.radius);
}

/** Whether a station (an outpost) fits here: mostly open, dry ground clear of everything, the track only on its near side. */
function stationFits(field: Battlefield, out: TraitLayout, stations: { x: number; z: number }[], track: { x: number; z: number }[], x: number, z: number): boolean {
  if (!field.contains(x, z, STATION_RADIUS + 2) || !dry(field, x, z)) return false;
  if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius * 1.35 + STATION_RADIUS + 4)) return false;
  if (field.outpostSites.some((o) => D.hypot(o.x - x, o.z - z) < o.radius + STATION_RADIUS + 4)) return false;
  if (stations.some((s) => D.hypot(s.x - x, s.z - z) < STATION_RADIUS * 3)) return false;
  if (field.townSites.some((t) => D.hypot(t.x - x, t.z - z) < t.radius + STATION_RADIUS)) return false;
  if (field.inCity(x, z, STATION_RADIUS)) return false;
  if (out.sites.some((t) => t.radius > 0 && D.hypot(t.x - x, t.z - z) < t.radius + STATION_RADIUS)) return false;
  // The track bends away: nothing of it closer than the near side.
  if (track.some((p) => D.hypot(p.x - x, p.z - z) < STATION_OFFSET - 1)) return false;
  let open = 0;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const px = x + D.cos(a) * STATION_RADIUS * 0.8;
    const pz = z + D.sin(a) * STATION_RADIUS * 0.8;
    if (dry(field, px, pz) && !field.sheerAt(px, pz) && field.slopeAt(px, pz) < 0.8) open++;
  }
  return open >= 13;
}

/** Where a point `s` along a rail line is, and which way the track runs there (a heading, as Transform keeps it). */
export function railAt(rail: RailLine, s: number): { x: number; z: number; heading: number } {
  const pts = rail.points;
  const f = Math.max(0, Math.min(pts.length - 1.001, s / rail.step));
  const k = Math.floor(f);
  const t = f - k;
  const p = pts[k];
  const q = pts[k + 1];
  return { x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, heading: D.atan2(-(q.z - p.z), q.x - p.x) };
}

/** Whether a rail line's track runs within `r` of a point (nothing's built on it). */
export function nearRail(field: Battlefield, x: number, z: number, r: number): boolean {
  const rail = field.traits.rail;
  return rail !== null && rail.points.some((p) => D.sq(p.x - x) + D.sq(p.z - z) < r * r);
}

/** The rail line's length. */
export function railLength(rail: RailLine): number {
  return (rail.points.length - 1) * rail.step;
}

/** How far along the line the track comes nearest a point, and how near. */
export function railNearest(rail: RailLine, x: number, z: number, every = 1): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let k = 0; k < rail.points.length; k += every) {
    const d = D.hypot(rail.points[k].x - x, rail.points[k].z - z);
    if (d < best.d) best = { s: k * rail.step, d };
  }
  return best;
}

/** A spot for a trait of this radius: on contested ground, as near the middle as it can be, mostly dry and clear. */
function findSpot(field: Battlefield, sites: readonly TraitSite[], radius: number, rng: Rng, taken: readonly Taken[], middle = 0.15, apart = false): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestScore = Infinity;
  const hw = field.width / 2 - radius - 3;
  const hd = field.depth / 2 - radius - 3;
  if (hw <= 0 || hd <= 0) return null;
  for (let n = 0; n < TRIES; n++) {
    const x = rng.range(-hw, hw);
    const z = rng.range(-hd, hd);
    // A trait can spread toward a base or a town; its relics and ground keep clear of them (see free).
    if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius * 1.35 + radius * 0.5 + 4)) continue;
    // (A rail line's bits of track only keep the trait off the track itself.)
    if (sites.some((t) => t.radius > 0 && D.hypot(t.x - x, t.z - z) < (t.kind === 'rail' ? t.radius + radius * 0.6 : t.radius + radius + 4))) continue;
    if (taken.some((t) => D.hypot(t.x - x, t.z - z) < t.r + radius)) continue;
    // An outpost of its own (a citadel, a landing field) keeps well clear of the others; anything else can sit by one.
    if (field.outpostSites.some((o) => D.hypot(o.x - x, o.z - z) < o.radius + (apart ? radius + 4 : radius * 0.6))) continue;
    if (!field.config.citySprawl && field.townSites.some((t) => D.hypot(t.x - x, t.z - z) < t.radius + radius * 0.6)) continue;
    // Mostly open, dry, gentle ground.
    let open = 0;
    let total = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const f of [0.35, 0.8]) {
        const px = x + D.cos(a) * radius * f;
        const pz = z + D.sin(a) * radius * f;
        total++;
        if (dry(field, px, pz) && !field.sheerAt(px, pz) && field.slopeAt(px, pz) < 0.7 && !field.inCity(px, pz, 2) && !field.townSites.some((t) => field.inTown(t, px, pz))) open++;
      }
    }
    if (open < total * 0.7) continue;
    // Contested: about as far from one side as from the next, and on the way between them, where the lanes run.
    const near = field.baseSites.map((b) => ({ b, d: D.hypot(b.x - x, b.z - z) })).sort((p, q) => p.d - q.d);
    const score = Math.abs(near[0].d - near[1].d) + 0.6 * offLine(x, z, near[0].b, near[1].b) + middle * D.hypot(x, z) + rng.range(0, 4);
    if (score < bestScore) {
      bestScore = score;
      best = { x, z };
    }
  }
  return best;
}

/** How far a point is from the straight way between two bases. */
function offLine(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const len = D.hypot(b.x - a.x, b.z - a.z) || 1;
  return Math.abs((x - a.x) * -(b.z - a.z) + (z - a.z) * (b.x - a.x)) / len;
}

/** Whether a relic of this radius can stand at a point: dry, gentle ground clear of bases, towns, outposts, roads, bridges and other relics. */
function free(field: Battlefield, out: TraitLayout, x: number, z: number, r: number, gap = 0.4): boolean {
  if (!field.contains(x, z, r + 1) || !dry(field, x, z) || field.slopeAt(x, z) > 0.6 || field.sheerAt(x, z)) return false;
  for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!dry(field, x + dx, z + dz)) return false;
  if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius * 1.35 + r + 4)) return false;
  if (field.townSites.some((t) => field.inTown(t, x, z) || (!t.city && D.hypot(t.x - x, t.z - z) < t.radius + r + 1.5))) return false;
  if (field.inCity(x, z, r + 1)) return false;
  if (field.outpostSites.some((o) => D.hypot(o.x - x, o.z - z) < o.radius + r + 2)) return false;
  if (field.nearBridge(x, z, r + 2) || nearRail(field, x, z, r + 2)) return false;
  const [i, j] = field.cellAt(x, z);
  if (field.roadCell[j * field.config.cols + i] || field.groundAt(x, z).id === 'road') return false;
  for (const [dx, dz] of [[r + 1, 0], [-r - 1, 0], [0, r + 1], [0, -r - 1]]) {
    const [ii, jj] = field.cellAt(x + dx, z + dz);
    if (field.roadCell[jj * field.config.cols + ii]) return false;
  }
  return !relicNear(out, x, z, r, gap);
}

function relicNear(out: TraitLayout, x: number, z: number, r: number, gap = 0.4): boolean {
  return out.relics.some((q) => D.hypot(q.x - x, q.z - z) < r + RELIC_RADIUS[q.building] + gap);
}

/** Relics' footprints (BuildingDef.radius), for spacing them at generation. */
const RELIC_RADIUS: Record<RelicId, number> = { oldHulk: 1.3, oldWall: 1.3, pillbox: 1.6, crashedHulk: 5, derrick: 1.2, column: 0.5, ruinWall: 1.3 };

function dry(field: Battlefield, x: number, z: number): boolean {
  return field.heightAt(x, z) > field.seaLevel + 0.4 && field.deckAt(x, z) === null;
}

/** A random point within `radius` of a centre, spread evenly over the disc. */
function within(rng: Rng, x: number, z: number, radius: number): { x: number; z: number } {
  const a = rng.range(-Math.PI, Math.PI);
  const d = radius * Math.sqrt(rng.next());
  return { x: x + D.cos(a) * d, z: z + D.sin(a) * d };
}

function scatter(field: Battlefield, out: TraitLayout, rng: Rng, x: number, z: number, radius: number, count: number, kind: PropKind, min: number, max: number): void {
  for (let n = 0; n < count; n++) {
    const p = within(rng, x, z, radius);
    if (!dry(field, p.x, p.z) || relicNear(out, p.x, p.z, 0.4) || field.groundAt(p.x, p.z).id === 'road' || nearRail(field, p.x, p.z, 1.5)) continue;
    out.props.push({ kind, x: p.x, z: p.z, scale: rng.range(min, max), rotation: rng.range(0, Math.PI * 2) });
  }
}

/** How far from a rail line's track traits leave the ground (its graded bed) alone. */
const RAIL_CLEAR = 2.5;

/** Each map vertex within `reach` of a point (a square round it). */
function eachVertex(field: Battlefield, x: number, z: number, reach: number, visit: (k: number, vx: number, vz: number) => void): void {
  const { cols, rows, cellSize } = field.config;
  const i0 = Math.max(0, Math.floor((x - reach - field.bounds.minX) / cellSize));
  const i1 = Math.min(cols, Math.ceil((x + reach - field.bounds.minX) / cellSize));
  const j0 = Math.max(0, Math.floor((z - reach - field.bounds.minZ) / cellSize));
  const j1 = Math.min(rows, Math.ceil((z + reach - field.bounds.minZ) / cellSize));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) visit(j * (cols + 1) + i, field.vertexX(i), field.vertexZ(j));
}

/** A shallow crater with a low rim. */
function dent(field: Battlefield, x: number, z: number, radius: number, depth: number): void {
  const heights = field.heights;
  eachVertex(field, x, z, radius * 1.6, (k, vx, vz) => {
    if (nearRail(field, vx, vz, RAIL_CLEAR)) return;
    const t = D.hypot(vx - x, vz - z) / radius;
    if (t < 1) heights[k] -= depth * (1 - t * t);
    else if (t < 1.6) heights[k] += depth * 0.35 * (1 - (t - 1) / 0.6);
  });
}

/** Ease the ground within `radius` of a point toward `height`, by up to `strength` in the middle. */
function level(field: Battlefield, x: number, z: number, radius: number, height: number, strength: number): void {
  const heights = field.heights;
  const floor = field.seaLevel + 0.5;
  eachVertex(field, x, z, radius * 1.3, (k, vx, vz) => {
    const d = D.hypot(vx - x, vz - z);
    const t = strength * (1 - smoothstep(radius * 0.7, radius * 1.3, d));
    if (t <= 0 || heights[k] < floor || nearRail(field, vx, vz, RAIL_CLEAR)) return;
    heights[k] += (Math.max(floor, height) - heights[k]) * t;
  });
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

