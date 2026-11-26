import { Rng } from '../core/rng';
import { BIOME_IDS } from '../world/biomes';
import type { AttackTiming, BaseLayout, BattleMode, BattleSettings, CityMode, MapSize, SuperGrowth, TownSize } from './settings';
import { LIMITS, rampMode, ROLLED_MAP_SIZES, TOWN_SIZES } from './settings';
import type { VarietyKey } from './variety';

/**
 * The settings that can be locked or rolled one by one between battles (see
 * VarietySettings.locks and .dice): each with what it is (a number in a
 * range, one of a few choices, or on/off) and which re-roll preset, if any,
 * already rolls it (Map size rolls size and shape, Map style rolls water,
 * hills, forest and the towns, Biome the biome).
 *
 * A lock keeps a setting as it's set even when its preset rolls the rest;
 * a die rolls it every battle, on its own (a number anywhere between its low
 * and high, a choice from all of them, on or off at even odds), whether a
 * preset covers it or not. So "a map style, but always large and wet" is
 * Map style and Map size on, with Size and Water locked; and "the usual map,
 * but any amount of water" is no preset, with a die on Water.
 */

export type RollableKind = { kind: 'range'; limit: keyof typeof LIMITS; step: number } | { kind: 'choice'; values: readonly (string | number)[] } | { kind: 'flag' };

export type Rollable = {
  /** Short and URL-safe: how the link names it. */
  id: string;
  label: string;
  /** The re-roll preset that already rolls it, if any. */
  preset?: VarietyKey;
  get(s: BattleSettings): number | string | boolean;
  set(s: BattleSettings, v: number | string | boolean): void;
} & RollableKind;

const range = (id: string, label: string, limit: keyof typeof LIMITS, step: number, get: (s: BattleSettings) => number, set: (s: BattleSettings, v: number) => void, preset?: VarietyKey): Rollable => ({
  id,
  label,
  preset,
  kind: 'range',
  limit,
  step,
  get,
  set: (s, v) => set(s, v as number),
});

const choice = <T extends string | number>(id: string, label: string, values: readonly T[], get: (s: BattleSettings) => T, set: (s: BattleSettings, v: T) => void, preset?: VarietyKey): Rollable => ({
  id,
  label,
  preset,
  kind: 'choice',
  values,
  get,
  set: (s, v) => set(s, v as T),
});

const flag = (id: string, label: string, get: (s: BattleSettings) => boolean, set: (s: BattleSettings, v: boolean) => void): Rollable => ({
  id,
  label,
  kind: 'flag',
  get,
  set: (s, v) => set(s, v as boolean),
});

let list: Rollable[] | null = null;

/**
 * Every rollable setting, in the setup screen's order. Built on first use
 * (settings.ts and this module import each other).
 */
export function rollables(): Rollable[] {
  return (list ??= build());
}

let byId: Map<string, Rollable> | null = null;
export function rollable(id: string): Rollable | undefined {
  return (byId ??= new Map(rollables().map((r) => [r.id, r]))).get(id);
}

const build = (): Rollable[] => [
  choice<BattleMode>('mode', 'Mode', ['eternal', 'conquest', 'hill'], (s) => s.mode, (s, v) => (s.mode = v)),
  range('hold', 'Hold to win', 'hillHold', 15, (s) => s.armies.hillHold, (s, v) => (s.armies.hillHold = v)),
  // Map
  choice<MapSize>('size', 'Size', ROLLED_MAP_SIZES, (s) => s.map.size, (s, v) => (s.map.size = v), 'size'),
  range('shape', 'Shape', 'shape', 0.05, (s) => s.map.shape, (s, v) => (s.map.shape = v), 'size'),
  choice('biome', 'Biome', BIOME_IDS, (s) => s.map.biome, (s, v) => (s.map.biome = v), 'biome'),
  choice<BaseLayout>(
    'layout',
    'Bases',
    ['ring', 'apart', 'lines'],
    (s) => s.map.layout,
    (s, v) => {
      if (s.map.layout !== v) s.map.placed.bases = null;
      s.map.layout = v;
    },
  ),
  range('water', 'Water', 'water', 0.05, (s) => s.map.water, (s, v) => (s.map.water = v), 'style'),
  flag('ways', 'Waterways', (s) => s.map.waterways, (s, v) => (s.map.waterways = v)),
  range('forest', 'Dense forest', 'forest', 0.05, (s) => s.map.forest, (s, v) => (s.map.forest = v), 'style'),
  flag('scrap', 'Scrap', (s) => s.map.scrap, (s, v) => (s.map.scrap = v)),
  range('junk', 'Wreckage', 'wreckage', 0.1, (s) => s.map.wreckage, (s, v) => (s.map.wreckage = v)),
  range('junklife', 'Wreckage lasts', 'wreckageLife', 0.25, (s) => s.map.wreckageLife, (s, v) => (s.map.wreckageLife = v)),
  flag('crater', 'Craters', (s) => s.map.craters, (s, v) => (s.map.craters = v)),
  range('hills', 'Hills', 'hills', 0.05, (s) => s.map.hills, (s, v) => (s.map.hills = v), 'style'),
  range('mtn', 'Mountains', 'mountains', 0.05, (s) => s.map.mountains, (s, v) => (s.map.mountains = v), 'style'),
  range('cliff', 'Cliffs', 'cliffs', 0.05, (s) => s.map.cliffs, (s, v) => (s.map.cliffs = v), 'style'),
  choice(
    'towns',
    'Towns',
    Array.from({ length: LIMITS.towns.max + 1 }, (_, i) => i),
    (s) => s.map.towns,
    (s, v) => {
      if (s.map.towns !== v) s.map.placed.towns = null;
      s.map.towns = v;
    },
    'style',
  ),
  choice<TownSize>('tsize', 'Town size', Object.keys(TOWN_SIZES) as TownSize[], (s) => s.map.townSize, (s, v) => (s.map.townSize = v), 'style'),
  choice<CityMode>('city', 'City', ['off', 'district', 'sprawl'], (s) => s.map.city, (s, v) => (s.map.city = v), 'style'),
  flag('folk', 'Townsfolk', (s) => s.map.townLife, (s, v) => (s.map.townLife = v)),
  // Armies
  range('icap', 'Infantry cap', 'infantryCap', 5, (s) => s.armies.caps.infantry, (s, v) => (s.armies.caps.infantry = v)),
  range('vcap', 'Vehicle cap', 'vehicleCap', 1, (s) => s.armies.caps.vehicle, (s, v) => (s.armies.caps.vehicle = v)),
  range('acap', 'Aircraft cap', 'airCap', 1, (s) => s.armies.caps.air, (s, v) => (s.armies.caps.air = v)),
  range('scap', 'Super units', 'superCap', 1, (s) => s.armies.caps.super, (s, v) => (s.armies.caps.super = v)),
  choice<SuperGrowth>('grow', 'Super cap grows', ['none', 'tide', 'outposts'], (s) => s.armies.superGrowth, (s, v) => (s.armies.superGrowth = v)),
  flag('gate', 'Super units need an outpost', (s) => s.armies.superGate, (s, v) => (s.armies.superGate = v)),
  range('prod', 'Production', 'production', 0.05, (s) => s.armies.production, (s, v) => (s.armies.production = v)),
  range('army', 'Starting army', 'startingArmy', 1, (s) => s.armies.startingArmy, (s, v) => (s.armies.startingArmy = v)),
  range('bhp', 'Building HP', 'buildingHp', 0.05, (s) => s.armies.buildingHp, (s, v) => (s.armies.buildingHp = v)),
  choice<AttackTiming>('timing', 'Attacks', ['readiness', 'tide'], (s) => s.armies.attackTiming, (s, v) => (s.armies.attackTiming = v)),
  range('tide', 'Tide swing', 'tideStrength', 0.05, (s) => s.armies.tideStrength, (s, v) => (s.armies.tideStrength = v)),
  range('tidelen', 'Tide length', 'tidePeriod', 10, (s) => s.armies.tidePeriod, (s, v) => (s.armies.tidePeriod = v)),
  range('flank', 'Flanking', 'flanking', 0.05, (s) => s.armies.flanking, (s, v) => (s.armies.flanking = v)),
  range('advice', 'Build advice', 'advice', 0.05, (s) => s.armies.advice, (s, v) => (s.armies.advice = v)),
  range('eng', 'Engineers', 'engineers', 1, (s) => s.armies.engineers, (s, v) => (s.armies.engineers = v)),
  flag('avoid', 'Squads avoid danger', (s) => s.armies.avoidance, (s, v) => (s.armies.avoidance = v)),
  flag('hunt', 'Gun hunts', (s) => s.armies.hunts, (s, v) => (s.armies.hunts = v)),
  flag('span', 'Bridge shortcuts', (s) => s.armies.shortcuts, (s, v) => (s.armies.shortcuts = v)),
  // The ramps of whichever mode the battle is in.
  range('rtide', 'Tide ramp', 'ramp', 0.05, (s) => s.armies.ramp[rampMode(s.mode)].tide, (s, v) => (s.armies.ramp[rampMode(s.mode)].tide = v)),
  range('rsiege', 'Siege ramp', 'ramp', 0.05, (s) => s.armies.ramp[rampMode(s.mode)].siege, (s, v) => (s.armies.ramp[rampMode(s.mode)].siege = v)),
  // Outposts
  choice<number | 'auto'>(
    'outposts',
    'Outposts',
    ['auto', ...Array.from({ length: LIMITS.outposts.max + 1 }, (_, i) => i)],
    (s) => s.map.outposts,
    (s, v) => {
      if (s.map.outposts !== v) s.map.placed.outposts = null;
      s.map.outposts = v;
    },
  ),
  range('obonus', 'Outpost bonus', 'outpostBonus', 0.05, (s) => s.armies.outpostBonus, (s, v) => (s.armies.outpostBonus = v)),
  range('ohold', 'Outpost holding', 'outpostHold', 0.05, (s) => s.armies.outpostHold, (s, v) => (s.armies.outpostHold = v)),
  range('tforce', 'Task forces', 'taskForces', 0.05, (s) => s.armies.taskForces, (s, v) => (s.armies.taskForces = v)),
  range('boost', 'Team boost', 'evenTeams', 0.05, (s) => s.armies.evenTeams, (s, v) => (s.armies.evenTeams = v)),
];

/** A die's range for a number: its low and high (defaulting to the whole slider). */
export function diceRange(r: Rollable, dice: Record<string, [number, number] | true>): [number, number] {
  if (r.kind !== 'range') return [0, 0];
  const { min, max } = LIMITS[r.limit];
  const d = dice[r.id];
  if (!Array.isArray(d)) return [min, max];
  const lo = Math.max(min, Math.min(max, d[0]));
  const hi = Math.max(min, Math.min(max, d[1]));
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/**
 * After the presets have rolled: put locked settings back as they were in
 * `base`, and roll the ones with a die. Every die draws, in the list's
 * order, from its own stream, so adding one doesn't change the others' rolls.
 */
export function applyLocksAndDice(s: BattleSettings, base: BattleSettings, rng: Rng): string[] {
  const v = base.variety;
  const locks = new Set(v.locks ?? []);
  const dice = v.dice ?? {};
  const rolled: string[] = [];
  for (const r of rollables()) {
    if (dice[r.id] !== undefined) {
      const own = rng.fork(hashId(r.id));
      if (r.kind === 'range') {
        const [lo, hi] = diceRange(r, dice);
        const steps = Math.round((hi - lo) / r.step);
        const value = Math.round((lo + own.int(0, Math.max(0, steps)) * r.step) * 100) / 100;
        r.set(s, Math.min(hi, value));
      } else if (r.kind === 'choice') r.set(s, own.pick(r.values));
      else r.set(s, own.chance(0.5));
      rolled.push(r.id);
    } else if (locks.has(r.id)) r.set(s, r.get(base));
  }
  return rolled;
}

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
