import { Rng } from '../core/rng';
import { BIOME_IDS, BIOMES } from '../world/biomes';
import { DOCTRINE_IDS, DOCTRINES, DoctrineId } from './doctrines';
import { FACTIONS } from './factions';
import { generateIdentity, isGeneratedIdentity } from './identity';
import type { BattleSettings, FactionSettings, MapSize, TownSize } from './settings';
import { cloneSettings, defaultFaction, LIMITS, MAP_SIZES, MAX_FACTIONS } from './settings';

/**
 * Variety between battles: the setup screen picks which settings to re-roll,
 * and every battle after the first gets a fresh roll of those (on top of the
 * new seed), so the toy can be left running and keep changing. The first
 * battle always uses the settings as shown.
 */

/** The things that can be re-rolled. */
export type VarietyKey = 'size' | 'biome' | 'style' | 'sides' | 'doctrines';
export const VARIETY_KEYS: VarietyKey[] = ['size', 'biome', 'style', 'sides', 'doctrines'];

/** How re-rolled sides are split into teams: every side for itself, two even teams, two uneven teams (1v3, 2v4...), or any of those. */
export type VarietyTeams = 'ffa' | 'two' | 'uneven' | 'either';
export const VARIETY_TEAMS: VarietyTeams[] = ['ffa', 'two', 'uneven', 'either'];

/** Which re-rolled sides get generated names and colours. */
export type VarietyIdentities = 'repeats' | 'all';

export interface VarietySettings {
  /** Which settings to re-roll between battles. */
  roll: Record<VarietyKey, boolean>;
  /** Range for the number of sides, when they're re-rolled. */
  sidesMin: number;
  sidesMax: number;
  /** Teams for re-rolled sides: every side for itself, two even teams, two uneven teams, or any of those at random. */
  teams: VarietyTeams;
  /** The doctrines to draw from, when they're re-rolled. */
  doctrines: DoctrineId[];
  /** Whether a doctrine can come up for more than one side (each copy gets its own name and colour). */
  repeats: boolean;
  /** Which re-rolled sides get a generated name and colour: only repeats of a doctrine (the first keeps its canonical faction), or all of them. */
  identities: VarietyIdentities;
  /** Minutes before a battle that hasn't ended gives way to the next one; 0 never does. */
  after: number;
}

/** The choices the setup screen offers for `after`. */
export const VARIETY_AFTER = [0, 5, 10, 15, 20, 30, 45, 60];

export function defaultVariety(): VarietySettings {
  return {
    roll: { size: false, biome: false, style: false, sides: false, doctrines: false },
    sidesMin: 2,
    sidesMax: 4,
    teams: 'either',
    doctrines: [...DOCTRINE_IDS],
    repeats: true,
    identities: 'repeats',
    after: 0,
  };
}

/** Whether anything is re-rolled between battles. */
export function varietyOn(v: VarietySettings): boolean {
  return VARIETY_KEYS.some((k) => v.roll[k]);
}

/**
 * A map style: water, hills, dense forest and towns together, so a re-roll
 * gives a map with a character rather than five unrelated sliders.
 */
export interface MapStyle {
  id: string;
  label: string;
  water: number;
  hills: number;
  forest: number;
  towns: number;
  townSize: TownSize;
}

export const MAP_STYLES: MapStyle[] = [
  { id: 'standard', label: 'Standard', water: 0.5, hills: 1, forest: 0.2, towns: 1, townSize: 'medium' },
  { id: 'plains', label: 'Open plains', water: 0.15, hills: 0.45, forest: 0.05, towns: 1, townSize: 'small' },
  { id: 'lakeland', label: 'Lakeland', water: 0.8, hills: 0.8, forest: 0.2, towns: 1, townSize: 'medium' },
  { id: 'highlands', label: 'Highlands', water: 0.35, hills: 1.8, forest: 0.25, towns: 1, townSize: 'small' },
  { id: 'wildwood', label: 'Wild forest', water: 0.4, hills: 1, forest: 0.65, towns: 0, townSize: 'small' },
  { id: 'urban', label: 'Urban', water: 0.3, hills: 0.6, forest: 0.05, towns: 3, townSize: 'large' },
  { id: 'wetlands', label: 'Wetlands', water: 0.7, hills: 0.4, forest: 0.4, towns: 2, townSize: 'small' },
  { id: 'badlands', label: 'Badlands', water: 0, hills: 1.5, forest: 0, towns: 2, townSize: 'small' },
  { id: 'countryside', label: 'Countryside', water: 0.45, hills: 1.1, forest: 0.3, towns: 2, townSize: 'medium' },
];

const clamp = (v: number, limit: keyof typeof LIMITS) => Math.max(LIMITS[limit].min, Math.min(LIMITS[limit].max, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The result of a roll: the settings for the next battle, and a short description of what was rolled. */
export interface Roll {
  settings: BattleSettings;
  /** E.g. "Lakeland · Desert · Large · 3 sides", or empty when nothing was rolled. */
  label: string;
}

/**
 * Re-roll what `base.variety` asks for. Everything else is left as it is, as
 * are hand placements that still fit (re-rolled sides drop the placed bases,
 * a re-rolled style the placed towns).
 */
export function rollBattle(base: BattleSettings, rng: Rng): Roll {
  const s = cloneSettings(base);
  const v = s.variety;
  const label: string[] = [];

  if (v.roll.style) {
    const style = rng.pick(MAP_STYLES);
    // A little jitter, so the same style doesn't always come out identical.
    s.map.water = round2(clamp(style.water + (style.water > 0 ? rng.range(-0.05, 0.05) : 0), 'water'));
    s.map.hills = round2(clamp(style.hills + rng.range(-0.1, 0.1), 'hills'));
    s.map.forest = round2(clamp(style.forest + (style.forest > 0 ? rng.range(-0.05, 0.05) : 0), 'forest'));
    s.map.towns = style.towns;
    s.map.townSize = style.townSize;
    s.map.placed.towns = null;
    label.push(style.label);
  }
  if (v.roll.biome) {
    s.map.biome = rng.pick(BIOME_IDS);
    label.push(BIOMES[s.map.biome].label);
  }
  if (v.roll.size) {
    s.map.size = rng.pick(Object.keys(MAP_SIZES) as MapSize[]);
    // Half the time the usual shape; otherwise somewhat wider or deeper.
    s.map.shape = rng.chance(0.5) ? 1 : round2(clamp(rng.chance(0.5) ? rng.range(1.15, 1.6) : 1 / rng.range(1.15, 1.5), 'shape'));
    label.push(MAP_SIZES[s.map.size].label);
  }
  if (v.roll.sides) {
    const lo = Math.max(2, Math.min(v.sidesMin, v.sidesMax, MAX_FACTIONS));
    const hi = Math.min(MAX_FACTIONS, Math.max(v.sidesMin, v.sidesMax, lo));
    const n = rng.int(lo, hi);
    // Keep the sides already set up, in order; add default ones past them.
    s.factions = Array.from({ length: n }, (_, i) => (base.factions[i] ? { ...base.factions[i] } : defaultFaction(i)));
    const split = v.teams === 'either' ? rng.pick<Exclude<VarietyTeams, 'either'>>(['ffa', 'two', 'uneven']) : v.teams;
    if (split === 'uneven' && n >= 3) {
      // Uneven: a smaller team (1v2, 1v3, 2v4...) of sides picked at random.
      const few = rng.int(1, Math.ceil(n / 2) - 1);
      const small = new Set(shuffle(s.factions.map((_, i) => i), rng).slice(0, few));
      s.factions.forEach((f, i) => (f.team = small.has(i) ? 0 : 1));
      label.push(`${n} sides, ${few}v${n - few}`);
    } else {
      const two = split !== 'ffa';
      // Two teams: deal the sides out alternately, so neither team gets all the strong doctrines by slot.
      s.factions.forEach((f, i) => (f.team = two ? i % 2 : i));
      label.push(`${n} sides${two && n > 2 ? ', two teams' : ''}`);
    }
    s.map.placed.bases = null;
    if (s.map.outposts === 'auto') s.map.placed.outposts = null;
  }
  if (v.roll.doctrines) {
    const pool = v.doctrines.length > 0 ? v.doctrines : DOCTRINE_IDS;
    // With repeats, any doctrine for any side; without, each once while the pool lasts, then again from a fresh shuffle.
    let bag: DoctrineId[] = [];
    const draw = () => {
      if (v.repeats) return rng.pick(pool);
      if (bag.length === 0) bag = shuffle([...pool], rng);
      return bag.pop()!;
    };
    const picks = s.factions.map(() => draw());
    s.factions.forEach((f, i) => (f.doctrine = picks[i]));
    if (!v.roll.sides) label.push(s.factions.map((f) => DOCTRINES[f.doctrine].name).join(' v '));
  }
  if (v.roll.sides || v.roll.doctrines) assignIdentities(s, rng.fork(0x1d3e));
  return { settings: s, label: label.join(' · ') };
}

/**
 * Names and colours for re-rolled sides. A side still wearing a standard or
 * generated identity takes its doctrine's canonical faction (Cobalt Accord for
 * Armour...) if no other side wears it, else a generated one (see identity.ts);
 * with `identities: 'all'`, every such side gets a generated one. Sides named
 * or coloured by hand keep theirs.
 */
function assignIdentities(s: BattleSettings, rng: Rng): void {
  const all = s.variety.identities === 'all';
  const plain = s.factions.map((f, i) => isPlainIdentity(f, i));
  const done: FactionSettings[] = s.factions.filter((_, i) => !plain[i]);
  s.factions.forEach((f, i) => {
    if (!plain[i]) return;
    const home = FACTIONS[DOCTRINE_IDS.indexOf(f.doctrine)];
    if (!all && home && !done.some((d) => d.color === home.primary || d.name.trim() === home.name)) {
      f.name = home.name;
      f.color = home.primary;
    } else {
      Object.assign(f, generateIdentity(f.doctrine, { colors: done.map((d) => d.color), names: done.map((d) => d.name), biome: s.map.biome }, rng));
    }
    done.push(f);
  });
}

/** A side still wearing a standard name and colour (its slot's, another slot's from an earlier roll, or a generated one). */
function isPlainIdentity(f: FactionSettings, i: number): boolean {
  const slot = FACTIONS.find((d) => d.primary === f.color);
  return (slot !== undefined && slot.name === f.name.trim()) || isGeneratedIdentity(f.name, f.color) || (f.name.trim() === '' && f.color === FACTIONS[i].primary);
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
