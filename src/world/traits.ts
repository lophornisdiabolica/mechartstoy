import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/rng';
import type { Battlefield } from './battlefield';
import type { PropKind } from './biomes';
import * as D from '../core/dmath';
import { landReach } from './waterways';

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
 * - Tidal flats: sand bars across the water, in no-man's land, where it's
 *   narrow. Under the sea as the map is made; the tide goes out every few
 *   minutes and uncovers them, a way across on foot or tracks until it
 *   comes back in (see game/tides.ts). Boats can't cross them while they're
 *   dry. Needs water: a dry map gets none.
 */
export type MapTrait = 'oldField' | 'fortLine' | 'hulk' | 'oil' | 'geysers' | 'ruins' | 'grove' | 'citadel' | 'landing' | 'rail' | 'tidal' | 'dam' | 'frozen';

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
  frozen: { label: 'Frozen lake', blurb: 'A lake frozen over: a way across, until it gives way under heavy machines or melts under fire' },
  dam: { label: 'Dam', blurb: 'A dam holding the water back from a low valley: break it, or open its sluices, and the valley floods' },
  tidal: { label: 'Tidal flats', blurb: 'Sand bars across the water that the tide uncovers and drowns again: land bridges every few minutes' },
};

export const MAP_TRAIT_IDS = Object.keys(MAP_TRAITS) as MapTrait[];

export function isMapTrait(v: string): v is MapTrait {
  return v in MAP_TRAITS;
}

/** The buildings traits leave standing (see game/buildings.ts). */
export type RelicId = 'oldHulk' | 'oldWall' | 'pillbox' | 'crashedHulk' | 'derrick' | 'column' | 'ruinWall' | 'dam';

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
  flats: TidalFlat[];
  flood: FloodPlain | null;
  ice: IceSheet | null;
}

/**
 * A frozen lake (the Frozen lake trait): the map vertices under its ice,
 * with the lake bed's height under each (the ice is just above the sea).
 * It breaks and refreezes during the battle (see game/ice.ts).
 */
export interface IceSheet {
  verts: number[];
  bed: number[];
  /** The ice's height. */
  level: number;
}

/**
 * The low valley a dam holds the water back from (the Dam trait): the map
 * vertices that flood when it goes, nearest the dam first, how far each is
 * from it, and the height each sinks to (under the sea). The flood itself
 * is in game/flood.ts.
 */
export interface FloodPlain {
  /** The dam's middle. */
  x: number;
  z: number;
  /** Indices into Battlefield.heights, nearest the dam first. */
  verts: number[];
  dist: number[];
  to: number[];
  /** The reservoir the dam holds back, if it has one (see reservoir): drawn above the sea until the dam goes, then draining down to it. */
  pool?: Reservoir;
}

/**
 * A reservoir held up behind a dam (see FloodPlain.pool): a round lake of
 * this radius about (x, z), cut off on the dam's side where the dam's
 * water face is, `cut` from the middle toward (-ux, -uz). Its water stands
 * at `level` while the dam holds. Under it the bed is below the sea, so to
 * everything but the eye it's water like any other.
 */
export interface Reservoir {
  x: number;
  z: number;
  ux: number;
  uz: number;
  radius: number;
  cut: number;
  level: number;
}

/**
 * A sand bar across the water (the Tidal flats trait): the map vertices it
 * covers, with their heights at high tide (under water, as the map is made)
 * and at low tide (just dry). The tide moves them between the two (see
 * game/tides.ts).
 */
export interface TidalFlat {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Half its width. */
  half: number;
  /** Indices into Battlefield.heights. */
  verts: number[];
  high: number[];
  low: number[];
}

export function emptyTraits(): TraitLayout {
  return { sites: [], relics: [], vents: [], props: [], rail: null, flats: [], flood: null, ice: null };
}

/** Map area (in cells) sizes are per: a Medium map's. */
const PER_AREA = 84 * 64;
/** Spots tried for each trait. */
const TRIES = 90;
/** Tree size at and above which a tree is one of a grove's giants (see woods.ts). */
export const GIANT = 1.6;
/** Each trait's own random stream, by its place here (so adding a trait leaves the others' layouts alone). */
const STREAMS: MapTrait[] = ['hulk', 'grove', 'ruins', 'oil', 'oldField', 'geysers', 'fortLine', 'citadel', 'landing', 'rail', 'tidal', 'dam', 'frozen'];
/** Order traits are placed in: the outposts of their own, then the biggest first, the line across everything last. */
const ORDER: MapTrait[] = ['citadel', 'landing', 'rail', 'tidal', 'dam', 'frozen', 'hulk', 'grove', 'ruins', 'oil', 'oldField', 'geysers', 'fortLine'];

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
 * see railLine). Nor are the watery ones (tidal flats, dam, frozen lake),
 * which go where the map's water is. A citadel or landing field (an outpost of its own) plans
 * first, the citadel taking the very middle.
 */
export function planTraits(field: Battlefield, traits: readonly MapTrait[], rng: Rng, taken: readonly Taken[]): TraitSite[] {
  const planned: TraitSite[] = [];
  const scale = traitScale(field);
  for (const kind of ORDER) {
    if (!traits.includes(kind) || kind === 'fortLine' || kind === 'rail' || kind === 'tidal' || kind === 'dam' || kind === 'frozen') continue;
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
    if (kind === 'tidal') {
      tidalFlats(field, out, rng.fork(0x7400 + index), scale);
      continue;
    }
    if (kind === 'dam') {
      damFlood(field, out, rng.fork(0x7400 + index), flatten);
      continue;
    }
    if (kind === 'frozen') {
      frozenLake(field, out, rng.fork(0x7400 + index));
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
function spotFor(field: Battlefield, sites: readonly TraitSite[], kind: SpotTrait, scale: number, rng: Rng, taken: readonly Taken[]): TraitSite | null {
  let radius = RADII[kind] * scale;
  let at = findSpot(field, sites, radius, rng, taken);
  if (!at) at = findSpot(field, sites, (radius *= 0.7), rng, taken);
  return at && { kind, x: at.x, z: at.z, radius };
}

/** The traits laid out round a spot of their own (the rest find their own way across the map: see placeTraits). */
type SpotTrait = Exclude<MapTrait, 'fortLine' | 'citadel' | 'landing' | 'rail' | 'tidal' | 'dam' | 'frozen'>;

const RADII: Record<SpotTrait, number> = { oldField: 17, hulk: 10, oil: 13, geysers: 18, ruins: 11, grove: 12.5 };

type Builder = (field: Battlefield, out: TraitLayout, x: number, z: number, radius: number, rng: Rng, scale: number) => void;

const BUILDERS: Record<Exclude<MapTrait, 'fortLine' | 'citadel' | 'landing' | 'rail' | 'tidal' | 'dam' | 'frozen'>, Builder> = {
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
const RELIC_RADIUS: Record<RelicId, number> = { oldHulk: 1.3, oldWall: 1.3, pillbox: 1.6, crashedHulk: 5, derrick: 1.2, column: 0.5, ruinWall: 1.3, dam: 1.6 };

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

/** Tidal flats: how long a crossing can be, how wide a bar is, and how far apart two are. */
const FLAT_MAX = 46;
const FLAT_MIN = 6;
const FLAT_HALF = 3.2;
const FLAT_APART = 24;
/** A bar's crest above the sea at low tide, and the water over its middle at high tide (deeper than a walker wades). */
const FLAT_CREST = 0.3;
const FLAT_DEPTH = 1.1;
/** Ground this far above the sea is the shore a bar runs between. */
const FLAT_SHORE = 0.2;
/** How far up the shore at each end a bar reaches. */
const FLAT_LANDING = 2;

type FlatLine = { ax: number; az: number; bx: number; bz: number; score: number };
type Point = { x: number; z: number };

/**
 * Lay sand bars across narrow water in no-man's land (one, or two on a big
 * map), on the way between the bases. The first takes the place of the map
 * bridge most on that way, if the bases can still reach each other by land
 * (or other bridges) without it: so the tide, not the bridge, decides when
 * that crossing is open. The rest go where the water's narrow, contested
 * and between the bases.
 */
function tidalFlats(field: Battlefield, out: TraitLayout, rng: Rng, scale: number): void {
  if (field.baseSites.length < 2) return;
  const want = scale > 1.3 ? 2 : 1;
  const step = 0.5;
  const shoreAt = (x: number, z: number, dx: number, dz: number): number => {
    for (let t = step; t <= FLAT_MAX; t += step) {
      const px = x + dx * t;
      const pz = z + dz * t;
      if (!field.contains(px, pz, 4)) return -1;
      if (field.heightAt(px, pz) >= field.seaLevel + FLAT_SHORE) return t;
    }
    return -1;
  };
  // A crossing from water at x, z along an angle, shore to shore, landing a little way up each: null where there's none to lay a bar on.
  const crossing = (x: number, z: number, dx: number, dz: number): { a: Point; b: Point; length: number } | null => {
    const fore = shoreAt(x, z, dx, dz);
    const back = shoreAt(x, z, -dx, -dz);
    if (fore < 0 || back < 0) return null;
    const length = fore + back;
    if (length < FLAT_MIN || length > FLAT_MAX) return null;
    // Landing a little way up the shore, on gentle ground, not a cliff or a speck of rock.
    const a = { x: x - dx * (back + FLAT_LANDING), z: z - dz * (back + FLAT_LANDING) };
    const b = { x: x + dx * (fore + FLAT_LANDING), z: z + dz * (fore + FLAT_LANDING) };
    if ([a, b].some((p) => !field.contains(p.x, p.z, 4) || field.heightAt(p.x, p.z) < field.seaLevel + FLAT_SHORE || field.slopeAt(p.x, p.z) > 0.9 || field.sheerAt(p.x, p.z))) return null;
    return { a, b, length };
  };
  // How far off the way between the two nearest bases a point is, and how uneven its distances to them (0 for right in the middle of the way).
  const offWay = (x: number, z: number): number => {
    const near = [...field.baseSites].sort((p, q) => D.hypot(p.x - x, p.z - z) - D.hypot(q.x - x, q.z - z));
    const [p, q] = near;
    return Math.abs(D.hypot(p.x - x, p.z - z) - D.hypot(q.x - x, q.z - z)) + FLAT_OFF_WAY * segmentDistance(x, z, p.x, p.z, q.x, q.z);
  };
  const laneBar = laneBridgeBar(field, crossing, offWay);
  if (laneBar) layFlat(field, out, laneBar);
  if (out.flats.length >= want) return;

  const found: FlatLine[] = [];
  const hw = field.width / 2 - 6;
  const hd = field.depth / 2 - 6;
  for (let n = 0; n < 800; n++) {
    const x = rng.range(-hw, hw);
    const z = rng.range(-hd, hd);
    const angle = rng.range(0, Math.PI);
    if (!field.isWater(x, z) || field.deckAt(x, z) !== null) continue;
    const across = crossing(x, z, D.cos(angle), D.sin(angle));
    if (!across) continue;
    const { a, b, length } = across;
    // Clear of the bridges (a bar by a bridge is no use), bases, outposts and other bars.
    let clear = true;
    for (let t = 0; t <= 1 && clear; t += 0.1) {
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      if (field.nearBridge(px, pz, FLAT_HALF + 6)) clear = false;
      if (field.baseSites.some((s) => D.hypot(s.x - px, s.z - pz) < s.radius + 4)) clear = false;
      if (field.outpostSites.some((o) => D.hypot(o.x - px, o.z - pz) < o.radius + FLAT_HALF)) clear = false;
    }
    if (!clear) continue;
    // On the way between the bases, contested, and short.
    found.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, score: offWay((a.x + b.x) / 2, (a.z + b.z) / 2) + length * 0.4 + rng.range(0, 6) });
  }
  // Worth crossing: the way round by land is a long one, or there's none (not just across a pond). The longer the better.
  found.sort((p, q) => p.score - q.score);
  const worth: FlatLine[] = [];
  for (const c of found.slice(0, FLAT_CHECKED)) {
    const length = D.hypot(c.bx - c.ax, c.bz - c.az);
    const detour = landWalk(field, c.ax, c.az, c.bx, c.bz) / length;
    if (detour >= FLAT_DETOUR) worth.push({ ...c, score: c.score - Math.min(detour, 8) * 6 });
  }
  worth.sort((p, q) => p.score - q.score);
  for (const c of worth) {
    if (out.flats.length >= want) break;
    const mx = (c.ax + c.bx) / 2;
    const mz = (c.az + c.bz) / 2;
    if (out.flats.some((f) => D.hypot((f.ax + f.bx) / 2 - mx, (f.az + f.bz) / 2 - mz) < FLAT_APART)) continue;
    layFlat(field, out, c);
  }
}

/** How much being off the line between the two nearest bases counts against a bar's spot, against being nearer one than the other. */
const FLAT_OFF_WAY = 0.6;

/**
 * The map bridge most on the way between the bases that a bar can take the
 * place of (see tidalFlats), taken off the map, and the bar's line: null if
 * there's none, or none whose loss would leave a base, or a town that could
 * be reached, cut off. A bridge hopping several waters (an archipelago's)
 * stays.
 */
function laneBridgeBar(field: Battlefield, crossing: (x: number, z: number, dx: number, dz: number) => { a: Point; b: Point; length: number } | null, offWay: (x: number, z: number) => number): FlatLine | null {
  const options: { k: number; line: FlatLine }[] = [];
  field.bridges.forEach((b, k) => {
    if (b.gone || b.builtBy !== undefined) return;
    const len = D.hypot(b.bx - b.ax, b.bz - b.az);
    const mx = (b.ax + b.bx) / 2;
    const mz = (b.az + b.bz) / 2;
    if (!field.isWater(mx, mz)) return;
    const across = crossing(mx, mz, (b.bx - b.ax) / len, (b.bz - b.az) / len);
    if (!across) return;
    // The bar covers the whole of the water the bridge did, not one of several.
    const { a, b: e } = across;
    const span = D.hypot(e.x - a.x, e.z - a.z);
    for (let t = 0; t <= 1; t += 0.5 / len) {
      const px = b.ax + (b.bx - b.ax) * t;
      const pz = b.az + (b.bz - b.az) * t;
      const along = ((px - a.x) * (e.x - a.x) + (pz - a.z) * (e.z - a.z)) / span;
      if (field.isWater(px, pz) && (along < 0 || along > span)) return;
    }
    if (field.baseSites.some((s) => segmentDistance(s.x, s.z, a.x, a.z, e.x, e.z) < s.radius + 4)) return;
    options.push({ k, line: { ax: a.x, az: a.z, bx: e.x, bz: e.z, score: offWay(mx, mz) } });
  });
  options.sort((p, q) => p.line.score - q.line.score);
  const home = field.baseSites[0];
  const places = [...field.baseSites.slice(1), ...field.townSites];
  for (const { k, line } of options) {
    const reached = places.map((p) => landWalk(field, home.x, home.z, p.x, p.z) < Infinity);
    field.removeBridge(k);
    if (places.every((p, n) => !reached[n] || landWalk(field, home.x, home.z, p.x, p.z) < Infinity)) {
      field.dropBridge(k);
      return line;
    }
    field.restoreBridge(k);
  }
  return null;
}

/** Lay a sand bar along a line, made at high tide (under the sea). */
function layFlat(field: Battlefield, out: TraitLayout, c: FlatLine): void {
  const sea = field.seaLevel;
  const mx = (c.ax + c.bx) / 2;
  const mz = (c.az + c.bz) / 2;
  const flat: TidalFlat = { ax: c.ax, az: c.az, bx: c.bx, bz: c.bz, half: FLAT_HALF, verts: [], high: [], low: [] };
  const length = D.hypot(c.bx - c.ax, c.bz - c.az);
  const reach = length / 2 + FLAT_HALF + 1;
  eachVertex(field, mx, mz, reach, (k, vx, vz) => {
    const off = segmentDistance(vx, vz, c.ax, c.az, c.bx, c.bz);
    const h = field.heights[k];
    if (off > FLAT_HALF || h >= sea + FLAT_CREST) return;
    const w = 1 - (off / FLAT_HALF) * (off / FLAT_HALF);
    flat.verts.push(k);
    flat.low.push(Math.max(h, sea + 0.05 + (FLAT_CREST - 0.05) * w));
    // (The shore at either end, where the crossing was measured to, is left as it is at high tide.)
    const along = ((vx - c.ax) * (c.bx - c.ax) + (vz - c.az) * (c.bz - c.az)) / length;
    const shore = h >= sea + FLAT_SHORE || along < FLAT_LANDING || along > length - FLAT_LANDING;
    flat.high.push(shore ? h : Math.min(h, sea - 0.25 - (FLAT_DEPTH - 0.25) * w));
  });
  if (flat.verts.length === 0) return;
  // The map's made at high tide.
  flat.verts.forEach((k, n) => (field.heights[k] = flat.high[n]));
  for (let t = 0; t <= 1; t += 0.5 / reach) field.paint(c.ax + (c.bx - c.ax) * t, c.az + (c.bz - c.az) * t, FLAT_HALF, 'flats', (g) => g === 'plain');
  out.flats.push(flat);
  out.sites.push({ kind: 'tidal', x: mx, z: mz, radius: 0 });
}

/** Frozen lake: the least and most of a lake to freeze (in map vertices), and the ice's height above the sea. */
const ICE_LEAST = 40;
const ICE_MOST = 4000;
export const ICE_ABOVE = 0.06;

/** Freeze a lake in no-man's land over: the most contested lake that doesn't reach the map's edge. */
function frozenLake(field: Battlefield, out: TraitLayout, rng: Rng): void {
  if (field.baseSites.length < 2) return;
  const { cols, rows } = field.config;
  const stride = cols + 1;
  const heights = field.heights;
  const sea = field.seaLevel;
  const seen = new Uint8Array(stride * (rows + 1));
  let best: { verts: number[]; score: number } | null = null;
  for (let k0 = 0; k0 < heights.length; k0++) {
    if (seen[k0] || heights[k0] >= sea) continue;
    const verts: number[] = [];
    const queue = [k0];
    seen[k0] = 1;
    let edge = false;
    while (queue.length > 0) {
      const k = queue.pop()!;
      verts.push(k);
      const i = k % stride;
      const j = (k - i) / stride;
      if (i === 0 || j === 0 || i === cols || j === rows) edge = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni > cols || nj > rows) continue;
        const m = nj * stride + ni;
        if (seen[m] || heights[m] >= sea) continue;
        seen[m] = 1;
        queue.push(m);
      }
    }
    if (edge || verts.length < ICE_LEAST || verts.length > ICE_MOST) continue;
    let cx = 0;
    let cz = 0;
    for (const k of verts) {
      cx += field.vertexX(k % stride);
      cz += field.vertexZ(Math.floor(k / stride));
    }
    cx /= verts.length;
    cz /= verts.length;
    const d = field.baseSites.map((b) => D.hypot(b.x - cx, b.z - cz)).sort((p, q) => p - q);
    const score = Math.abs(d[0] - d[1]) - Math.min(verts.length, 600) * 0.02 + rng.range(0, 4);
    if (!best || score < best.score) best = { verts, score };
  }
  if (!best) return;
  const level = sea + ICE_ABOVE;
  const sheet: IceSheet = { verts: best.verts, bed: best.verts.map((k) => heights[k]), level };
  for (const k of best.verts) heights[k] = level;
  // The ice's own ground on every cell it covers.
  const cells = new Set<number>();
  for (const k of best.verts) {
    const i = k % stride;
    const j = (k - i) / stride;
    for (const [ci, cj] of [[i, j], [i - 1, j], [i, j - 1], [i - 1, j - 1]]) if (ci >= 0 && cj >= 0 && ci < cols && cj < rows) cells.add(cj * cols + ci);
  }
  field.setGround([...cells], 'ice');
  offIce(field, new Set(best.verts));
  out.ice = sheet;
  let cx = 0;
  let cz = 0;
  for (const k of best.verts) {
    cx += field.vertexX(k % stride);
    cz += field.vertexZ(Math.floor(k / stride));
  }
  out.sites.push({ kind: 'frozen', x: cx / best.verts.length, z: cz / best.verts.length, radius: 0 });
}

/** How far clear of the ice (past a road's own half-width) what's left of a road over it stops. */
const ICE_ROAD_CLEAR = 0.4;
/** How far apart along a road it's checked for ice. */
const ICE_ROAD_STEP = 0.5;

/**
 * Cut the roads off a lake that's frozen over (a city's alleys and streets
 * run over its water, out of sight under it, and the ice would bring them up
 * into view): each road keeps its stretches clear of the ice, as roads of
 * their own, and loses the rest. A bridge over the lake comes down later as
 * standing over dry ground (see battlefield.ts dropDryBridges), its road cut
 * here with the rest.
 */
function offIce(field: Battlefield, ice: Set<number>): void {
  const stride = field.config.cols + 1;
  const cs = field.config.cellSize;
  const onIce = (x: number, z: number, r: number) => {
    const i0 = Math.floor((x - r - field.bounds.minX) / cs);
    const i1 = Math.ceil((x + r - field.bounds.minX) / cs);
    const j0 = Math.floor((z - r - field.bounds.minZ) / cs);
    const j1 = Math.ceil((z + r - field.bounds.minZ) / cs);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (i < 0 || j < 0 || i >= stride || !ice.has(j * stride + i)) continue;
        if (D.hypot(field.vertexX(i) - x, field.vertexZ(j) - z) <= r) return true;
      }
    }
    return false;
  };
  const gone: number[] = [];
  const count = field.roads.length;
  for (let k = 0; k < count; k++) {
    const road = field.roads[k];
    const runs: { points: { x: number; z: number }[]; widths: number[] }[] = [];
    let run: { points: { x: number; z: number }[]; widths: number[] } | null = null;
    let cut = false;
    // Along the road in short steps (a city's alley is one straight stretch, which can cross a corner of the lake between its ends).
    const visit = (x: number, z: number, w: number, corner: boolean) => {
      if (onIce(x, z, w / 2 + ICE_ROAD_CLEAR)) {
        // The run ends at the last clear step before the ice.
        if (run && last && !last.corner) {
          run.points.push({ x: last.x, z: last.z });
          run.widths.push(last.w);
        }
        run = null;
        cut = true;
        last = null;
        return;
      }
      if (!run) {
        run = { points: [], widths: [] };
        runs.push(run);
        if (!corner) {
          run.points.push({ x, z });
          run.widths.push(w);
        }
      }
      if (corner) {
        run.points.push({ x, z });
        run.widths.push(w);
      }
      last = { x, z, w, corner };
    };
    let last: { x: number; z: number; w: number; corner: boolean } | null = null;
    road.points.forEach((p, q) => {
      const w = road.widths?.[q] ?? road.width;
      if (q > 0) {
        const o = road.points[q - 1];
        const ow = road.widths?.[q - 1] ?? road.width;
        const n = Math.ceil(D.hypot(p.x - o.x, p.z - o.z) / ICE_ROAD_STEP);
        for (let t = 1; t < n; t++) visit(o.x + ((p.x - o.x) * t) / n, o.z + ((p.z - o.z) * t) / n, ow + ((w - ow) * t) / n, false);
      }
      visit(p.x, p.z, w, true);
    });
    if (!cut) continue;
    const kept = runs.filter((r) => r.points.length >= 2);
    const as = (r: { points: { x: number; z: number }[]; widths: number[] }) => (road.widths ? { ...road, points: r.points, widths: r.widths } : { ...road, points: r.points });
    if (kept.length === 0) gone.push(k);
    else field.roads[k] = as(kept[0]);
    for (const r of kept.slice(1)) field.roads.push(as(r));
  }
  // Roads left with nothing taken out of the list, and the junctions on them with them.
  for (const k of gone.reverse()) {
    field.roads.splice(k, 1);
    for (let n = field.junctions.length - 1; n >= 0; n--) {
      const j = field.junctions[n];
      if (j.roads.includes(k)) field.junctions.splice(n, 1);
      else j.roads = j.roads.map((r) => (r > k ? r - 1 : r));
    }
  }
}

/** Dam: the highest ground (above the sea) that floods, the most and least of the valley (in map vertices), and the dam's length. */
const FLOOD_TOP = 1.1;
const FLOOD_MOST = 1600;
const FLOOD_LEAST = 90;
const DAM_SEGMENTS = 3;
const DAM_STEP = 3.1;
/** How far out into the water from the shore the dam stands. */
const DAM_OFFSHORE = 2.2;
/** The sluice house outpost: its radius, and how far from the dam it goes. */
export const SLUICE_RADIUS = 6;
const SLUICE_REACH = 24;

/** A low valley by the water, a dam holding the water back from it, and the sluice house that controls the dam. */
function damFlood(field: Battlefield, out: TraitLayout, rng: Rng, flatten: (x: number, z: number, radius: number, height: number) => void): void {
  if (field.baseSites.length < 2) return;
  const { cols, rows } = field.config;
  const stride = cols + 1;
  const heights = field.heights;
  const sea = field.seaLevel;
  const top = sea + FLOOD_TOP;
  const low = (k: number) => heights[k] >= sea && heights[k] < top;
  const wetBy = (k: number) => {
    const i = k % stride;
    const j = (k - i) / stride;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => i + di >= 0 && j + dj >= 0 && i + di <= cols && j + dj <= rows && heights[(j + dj) * stride + i + di] < sea);
  };
  const tried = new Uint8Array(stride * (rows + 1));
  const valleys: { region: number[]; shore: number; cx: number; cz: number; score: number }[] = [];
  for (let n = 0; n < 160; n++) {
    const start = rng.int(1, rows - 1) * stride + rng.int(1, cols - 1);
    if (tried[start] || !low(start)) continue;
    // The low ground joined to it.
    const region: number[] = [];
    const queue = [start];
    tried[start] = 1;
    while (queue.length > 0) {
      const k = queue.pop()!;
      region.push(k);
      const i = k % stride;
      const j = (k - i) / stride;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni > cols || nj > rows) continue;
        const m = nj * stride + ni;
        if (tried[m] || !low(m)) continue;
        tried[m] = 1;
        queue.push(m);
      }
    }
    if (region.length > FLOOD_MOST || region.length < FLOOD_LEAST) continue;
    let cx = 0;
    let cz = 0;
    let fit = true;
    for (const k of region) {
      const x = field.vertexX(k % stride);
      const z = field.vertexZ(Math.floor(k / stride));
      cx += x;
      cz += z;
      if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius + 6)) fit = false;
      else if (field.outpostSites.some((o) => D.hypot(o.x - x, o.z - z) < o.radius + 1)) fit = false;
      else if (field.inCity(x, z, 1) || field.townSites.some((t) => field.inTown(t, x, z))) fit = false;
      if (!fit) break;
    }
    if (!fit) continue;
    cx /= region.length;
    cz /= region.length;
    // The dam where the water's nearest the middle of the valley (it needs water by it).
    let shore = -1;
    let near = Infinity;
    for (const k of region) {
      if (!wetBy(k)) continue;
      const d = D.hypot(field.vertexX(k % stride) - cx, field.vertexZ(Math.floor(k / stride)) - cz);
      if (d < near) {
        near = d;
        shore = k;
      }
    }
    if (shore < 0) continue;
    const dists = field.baseSites.map((b) => D.hypot(b.x - cx, b.z - cz)).sort((p, q) => p - q);
    const score = Math.abs(dists[0] - dists[1]) - Math.min(region.length, 900) * 0.02 + rng.range(0, 6);
    valleys.push({ region, shore, cx, cz, score });
  }
  if (valleys.length === 0) return;
  valleys.sort((p, q) => p.score - q.score);
  // Best, a reservoir up the valley's head, held back by the dam across its mouth, the valley running from the
  // dam down to the sea. Failing that, the dam stands just off the valley's shore, holding the sea back.
  // The best few valleys tried in turn, each with the full-size reservoir and then a smaller one; the first that fits is used.
  let best = valleys[0];
  let pooled: ReturnType<typeof reservoir> = null;
  for (const valley of valleys.slice(0, POOL_VALLEYS)) {
    for (const radius of POOL_RADII) {
      pooled = reservoir(field, valley.region, valley.shore, rng.fork(radius), radius);
      if (pooled) break;
    }
    if (pooled) {
      best = valley;
      break;
    }
  }
  let sx = field.vertexX(best.shore % stride);
  let sz = field.vertexZ(Math.floor(best.shore / stride));
  let plain = best.region;
  if (pooled) {
    sx = pooled.x;
    sz = pooled.z;
    plain = pooled.verts;
    const along = D.atan2(pooled.pool.uz, pooled.pool.ux) + Math.PI / 2;
    const dx = D.cos(along);
    const dz = D.sin(along);
    for (let n = 0; n < DAM_SEGMENTS; n++) {
      const o = (n - (DAM_SEGMENTS - 1) / 2) * DAM_STEP;
      // Its sluice gates (the model's -x side) toward the reservoir, as the shore dam's are toward the sea.
      out.relics.push({ building: 'dam', x: sx + dx * o, z: sz + dz * o, heading: -D.atan2(dx, -dz) });
    }
  } else {
    // Along the shore, standing in the water just off it (so it doesn't wall the valley's edge off): square to the way from the valley's middle to the water.
    const toWater = D.atan2(sz - best.cz, sx - best.cx);
    const along = toWater + Math.PI / 2;
    const dx = D.cos(along);
    const dz = D.sin(along);
    const wx = sx + D.cos(toWater) * DAM_OFFSHORE;
    const wz = sz + D.sin(toWater) * DAM_OFFSHORE;
    for (let n = 0; n < DAM_SEGMENTS; n++) {
      const o = (n - (DAM_SEGMENTS - 1) / 2) * DAM_STEP;
      out.relics.push({ building: 'dam', x: wx + dx * o, z: wz + dz * o, heading: -D.atan2(dx, -dz) });
    }
  }
  // The valley floods nearest the dam first, the lowest ground deepest.
  const order = plain
    .map((k) => ({ k, d: D.hypot(field.vertexX(k % stride) - sx, field.vertexZ(Math.floor(k / stride)) - sz) }))
    .sort((p, q) => p.d - q.d || p.k - q.k);
  out.flood = {
    x: sx,
    z: sz,
    verts: order.map((v) => v.k),
    dist: order.map((v) => v.d),
    to: order.map((v) => sea - 0.4 - 0.8 * Math.min(1, (top - heights[v.k]) / FLOOD_TOP)),
    ...(pooled ? { pool: pooled.pool } : {}),
  };
  out.sites.push({ kind: 'dam', x: sx, z: sz, radius: 0 });
  // The sluice house: on dry ground above the valley, by the dam (and clear of the reservoir's banks, which its levelling would breach).
  const inPlain = new Set(plain);
  const pool = pooled?.pool;
  let spot: { x: number; z: number } | null = null;
  for (let r = SLUICE_RADIUS + 3; r <= SLUICE_REACH && !spot; r += 1.5) {
    for (let a = 0; a < 24 && !spot; a++) {
      const x = sx + D.cos((a / 24) * Math.PI * 2) * r;
      const z = sz + D.sin((a / 24) * Math.PI * 2) * r;
      if (!field.contains(x, z, SLUICE_RADIUS + 2) || field.heightAt(x, z) < sea + 0.5) continue;
      let ok = true;
      for (let b = 0; b < 8 && ok; b++) {
        const px = x + D.cos((b / 8) * Math.PI * 2) * SLUICE_RADIUS;
        const pz = z + D.sin((b / 8) * Math.PI * 2) * SLUICE_RADIUS;
        const vi = Math.round((px - field.bounds.minX) / field.config.cellSize);
        const vj = Math.round((pz - field.bounds.minZ) / field.config.cellSize);
        if (field.heightAt(px, pz) < sea + 0.3 || inPlain.has(vj * stride + vi) || field.slopeAt(px, pz) > 0.9 || field.sheerAt(px, pz)) ok = false;
      }
      if (!ok || field.nearBridge(x, z, SLUICE_RADIUS + 2)) continue;
      if (pool && D.hypot(pool.x - x, pool.z - z) < pool.radius * POOL_REACH + SLUICE_RADIUS + 1) continue;
      // None of the valley under it: its levelling would be flooded.
      if (plain.some((k) => D.hypot(field.vertexX(k % stride) - x, field.vertexZ(Math.floor(k / stride)) - z) < SLUICE_RADIUS * 1.3 + 1.5)) continue;
      if (field.outpostSites.some((o) => D.hypot(o.x - x, o.z - z) < o.radius + SLUICE_RADIUS + 4)) continue;
      if (field.baseSites.some((b) => D.hypot(b.x - x, b.z - z) < b.radius + SLUICE_RADIUS + 4)) continue;
      if (field.townSites.some((t) => D.hypot(t.x - x, t.z - z) < t.radius + SLUICE_RADIUS)) continue;
      spot = { x, z };
    }
  }
  if (spot) {
    const height = Math.max(sea + 0.6, field.heightAt(spot.x, spot.z));
    field.outpostSites.push({ index: field.outpostSites.length, kind: 'sluice', x: spot.x, z: spot.z, radius: SLUICE_RADIUS, height });
    flatten(spot.x, spot.z, SLUICE_RADIUS, height);
  }
}

/**
 * A dam's reservoir: its radius; how far its water stands above the sea (as
 * near the top of its banks as the ground round it allows, up to a little
 * below the dam's top); how far its banks stand above that; and how far out
 * its banks reach (in radii).
 */
const POOL_RADII = [8, 6];
/** How many of the likeliest valleys are tried for a reservoir before the dam goes offshore. */
const POOL_VALLEYS = 5;
const POOL_RISE = 1.6;
const POOL_RISE_MOST = 2.3;
const POOL_BANK = 0.3;
const POOL_REACH = 1.6;
/** How much of the reservoir's round the dam cuts off (its water face this far in from the edge). */
const POOL_CUT = 1.2;
/** Half the dam's thickness (see bld:dam), and how far down the valley from it the ground is lowered to the valley floor. */
const DAM_HALF = 0.7;
const SPILLWAY = 8;
/** Candidate dam spots tried, and of those the best few laid out (each checked for cutting anything off). */
const POOL_TRIES = 48;
const POOL_LAYOUTS = 4;

/**
 * Lay out a reservoir up at the head of a valley: a round lake dug into the
 * higher ground beyond the valley's edge, its banks built up where they're
 * too low to hold it, and the dam across its mouth, with a spillway down
 * from the dam to the valley floor. The valley's end furthest from the sea
 * is best, so the flood runs the length of it. Returns the dam's middle,
 * the reservoir, and the valley's vertices (now with the spillway, less any
 * ground the banks raised); or null (and the map as it was) if there's no
 * room, or the reservoir would cut a base, outpost or town off.
 */
function reservoir(field: Battlefield, region: number[], shore: number, rng: Rng, radius: number): { x: number; z: number; pool: Reservoir; verts: number[] } | null {
  const { cols, rows } = field.config;
  const stride = cols + 1;
  const heights = field.heights;
  const sea = field.seaLevel;
  const top = sea + FLOOD_TOP;
  const vx = (k: number) => field.vertexX(k % stride);
  const vz = (k: number) => field.vertexZ(Math.floor(k / stride));
  const R = radius;
  const cut = R - POOL_CUT;
  const span = (DAM_SEGMENTS * DAM_STEP) / 2;
  const reach = R * POOL_REACH;
  const sx = vx(shore);
  const sz = vz(shore);
  const nearRoad = (x: number, z: number, margin: number) =>
    field.roads.some((r) =>
      r.points.some((p, q) => {
        if (q === 0) return false;
        const o = r.points[q - 1];
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const t = Math.max(0, Math.min(1, ((x - o.x) * dx + (z - o.z) * dz) / Math.max(1e-6, dx * dx + dz * dz)));
        return D.hypot(x - o.x - dx * t, z - o.z - dz * t) < margin + r.width / 2;
      }),
    );
  // The valley's edge: its vertices beside higher ground.
  const edge = region.filter((k) => {
    const i = k % stride;
    const j = (k - i) / stride;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => i + di >= 0 && j + dj >= 0 && i + di <= cols && j + dj <= rows && heights[(j + dj) * stride + i + di] >= top);
  });
  if (edge.length === 0) return null;
  const options: { score: number; dx: number; dz: number; cx: number; cz: number; ux: number; uz: number; level: number }[] = [];
  for (let n = 0; n < POOL_TRIES; n++) {
    const k = edge[rng.int(0, edge.length - 1)];
    const x = vx(k);
    const z = vz(k);
    // Up out of the valley: away from the valley ground round it.
    let mx = 0;
    let mz = 0;
    let count = 0;
    for (const m of region) {
      const d = D.hypot(vx(m) - x, vz(m) - z);
      if (d > 6) continue;
      mx += vx(m);
      mz += vz(m);
      count++;
    }
    const ax = x - mx / count;
    const az = z - mz / count;
    const len = D.hypot(ax, az);
    if (len < 0.3) continue;
    const ux = ax / len;
    const uz = az / len;
    const dx = x + ux;
    const dz = z + uz;
    const cx = dx + ux * (DAM_HALF + cut);
    const cz = dz + uz * (DAM_HALF + cut);
    if (!field.contains(cx, cz, reach + 2)) continue;
    const clear = (px: number, pz: number, room: number) =>
      !field.baseSites.some((b) => D.hypot(b.x - px, b.z - pz) < b.radius + room) &&
      !field.outpostSites.some((o) => D.hypot(o.x - px, o.z - pz) < o.radius + room) &&
      !field.townSites.some((t) => D.hypot(t.x - px, t.z - pz) < t.radius + room) &&
      !field.inCity(px, pz, room) &&
      !field.nearBridge(px, pz, room) &&
      !nearRoad(px, pz, room);
    if (!clear(cx, cz, reach + 3) || !clear(dx, dz, span + 2)) continue;
    // High ground to dig into, not more of the valley.
    let low = 0;
    let wet = 0;
    const rims: number[] = [];
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const ca = D.cos(ang);
      const sa = D.sin(ang);
      for (const f of [0.3, 0.7]) if (field.heightAt(cx + ca * R * f, cz + sa * R * f) < sea + 0.4) low++;
      const h = field.heightAt(cx + ca * R * 1.15, cz + sa * R * 1.15);
      if (h < sea) wet++;
      // The banks round it, but for the dam's side.
      if (ca * ux + sa * uz > -0.6) rims.push(h);
    }
    if (low > 6 || wet > 0) continue;
    // The water up near the top of the lowest bank (the rest is built up to hold it).
    rims.sort((p, q) => p - q);
    const level = Math.max(sea + POOL_RISE, Math.min(sea + POOL_RISE_MOST, rims[1] - POOL_BANK));
    const built = rims.reduce((sum, h) => sum + Math.max(0, level + POOL_BANK - h), 0) / rims.length;
    // Not dug deep into a hill, its water far down a pit.
    const sunk = rims.reduce((sum, h) => sum + Math.max(0, h - level - 1.5), 0) / rims.length;
    // The far end of the valley from the sea, so the flood runs its length, and banks that mostly stand already.
    const score = -D.hypot(x - sx, z - sz) + built * 6 + sunk * 8;
    options.push({ score, dx, dz, cx, cz, ux, uz, level });
  }
  options.sort((p, q) => p.score - q.score);
  for (const o of options.slice(0, POOL_LAYOUTS)) {
    const before = heights.slice();
    const bank = o.level + POOL_BANK;
    const vx0 = -o.uz;
    const vz0 = o.ux;
    const channel: number[] = [];
    const i0 = Math.max(0, Math.floor((Math.min(o.cx, o.dx) - reach - SPILLWAY - field.bounds.minX) / field.config.cellSize));
    const i1 = Math.min(cols, Math.ceil((Math.max(o.cx, o.dx) + reach + SPILLWAY - field.bounds.minX) / field.config.cellSize));
    const j0 = Math.max(0, Math.floor((Math.min(o.cz, o.dz) - reach - SPILLWAY - field.bounds.minZ) / field.config.cellSize));
    const j1 = Math.min(rows, Math.ceil((Math.max(o.cz, o.dz) + reach + SPILLWAY - field.bounds.minZ) / field.config.cellSize));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * stride + i;
        const x = field.vertexX(i);
        const z = field.vertexZ(j);
        // The spillway: from the dam's water face down the valley, as wide as the dam, at the valley floor.
        const s = (x - o.dx) * o.ux + (z - o.dz) * o.uz;
        if (Math.abs((x - o.dx) * vx0 + (z - o.dz) * vz0) <= span && s <= DAM_HALF && s >= -SPILLWAY) {
          heights[k] = Math.min(heights[k], sea + 0.55);
          channel.push(k);
          continue;
        }
        const e = D.hypot(x - o.cx, z - o.cz) / R;
        const h = heights[k];
        // The bed, under the sea (so it's water), deepest in the middle.
        if (e < 1) heights[k] = Math.min(h, sea - 0.25 - (1 - e * e));
        // The banks, built up to hold the water where the ground's too low, easing back down outside.
        else if (e < 1.3) heights[k] = Math.max(h, bank);
        else if (e < POOL_REACH && h < bank) {
          const t = (e - 1.3) / (POOL_REACH - 1.3);
          heights[k] = bank + (h - bank) * t * t * (3 - 2 * t);
        }
      }
    }
    // Nothing cut off by it: every base, outpost and town still in reach by land.
    const reachable = landReach(field);
    const at = (x: number, z: number) => Math.max(0, Math.min(rows, Math.round((z - field.bounds.minZ) / field.config.cellSize))) * stride + Math.max(0, Math.min(cols, Math.round((x - field.bounds.minX) / field.config.cellSize)));
    if (![...field.baseSites, ...field.outpostSites, ...field.townSites].every((p) => reachable[at(p.x, p.z)])) {
      heights.set(before);
      continue;
    }
    const verts = [...new Set([...region, ...channel])].filter((k) => heights[k] >= sea && heights[k] < top);
    // Most of the valley still there to flood (the banks haven't built over it).
    if (verts.length < Math.max(FLOOD_LEAST, region.length * 0.8)) {
      heights.set(before);
      continue;
    }
    return { x: o.dx, z: o.dz, pool: { x: o.cx, z: o.cz, ux: o.ux, uz: o.uz, radius: R, cut, level: o.level }, verts };
  }
  return null;
}

/** How much further the way round by land (in steps across map cells, not as the crow flies) must be than a bar, for the bar to be worth laying; and how many crossings are measured. */
const FLAT_DETOUR = 2;
const FLAT_CHECKED = 150;

/** How far it is to walk on dry land (or bridges) from one point to another, in map cells' widths; Infinity if there's no way. */
function landWalk(field: Battlefield, ax: number, az: number, bx: number, bz: number): number {
  const { cols, rows, cellSize } = field.config;
  const [ai, aj] = field.cellAt(ax, az);
  const [bi, bj] = field.cellAt(bx, bz);
  const goal = bj * cols + bi;
  const seen = new Int32Array(cols * rows).fill(-1);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = aj * cols + ai;
  seen[aj * cols + ai] = 0;
  while (head < tail) {
    const k = queue[head++];
    if (k === goal) return seen[k] * cellSize;
    const i = k % cols;
    const j = (k - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (seen[n] >= 0) continue;
      const x = field.bounds.minX + (ni + 0.5) * cellSize;
      const z = field.bounds.minZ + (nj + 0.5) * cellSize;
      if (n !== goal && field.heightAt(x, z) < field.seaLevel && field.deckAt(x, z) === null) continue;
      if (field.sheerAt(x, z)) continue;
      seen[n] = seen[k] + 1;
      queue[tail++] = n;
    }
  }
  return Infinity;
}

/** Distance from a point to the segment a-b. */
function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
  return D.hypot(x - ax - dx * t, z - az - dz * t);
}

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

