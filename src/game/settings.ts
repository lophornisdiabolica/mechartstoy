import { BattlefieldConfig, DEFAULT_BATTLEFIELD, seatsFit } from '../world/battlefield';
import { BUILDING_DEFS, BuildingDef, BuildingId } from './buildings';
import { FACTIONS, FactionDef, MAX_FACTIONS } from './factions';
import { UNIT_DEFS, UnitDef, UnitId } from './units';

/**
 * Everything a player can tune before a battle, in one plain object. The setup
 * screen edits it, the URL stores it, and the game derives its rules from it.
 * Multipliers are relative to the hand-tuned defaults in units.ts and
 * buildings.ts, so 1 always means "as designed".
 */
export type BattleMode = 'eternal' | 'conquest';
export type MapSize = 'small' | 'medium' | 'large';

export interface UnitTuning {
  hp: number;
  damage: number;
  speed: number;
  range: number;
}

/**
 * Escalation rates: each grows by this fraction every RAMP_INTERVAL seconds
 * (see tide.ts). 0 is off.
 */
export interface RampSettings {
  /** How much harder the tide swings production. */
  tide: number;
  /** How much harder hits on buildings land. */
  siege: number;
}

export interface FactionSettings {
  name: string;
  /** Main hull colour as 0xRRGGBB. */
  color: number;
  /** Sides with the same team are allies. Any number: every side on its own team is a free-for-all. */
  team: number;
}

export interface BattleSettings {
  /** Free text; hashed into the RNG seed. Empty means "pick a random one". */
  seed: string;
  /** Eternal: buildings rebuild and the war never ends. Conquest: last side with production standing wins. */
  mode: BattleMode;
  map: {
    size: MapSize;
    /** 0 (dry) to 1 (lots of lakes). */
    water: number;
    /** Terrain height multiplier, 0 (flat) to 2. */
    hills: number;
    town: boolean;
  };
  armies: {
    unitCap: number;
    /** Production speed multiplier. */
    production: number;
    /** Groups each side starts with. */
    startingArmy: number;
    /** How hard the tide swings production, 0 (steady) to 1. */
    tideStrength: number;
    /** Seconds for a full tide cycle (both sides attack once). */
    tidePeriod: number;
    /** Building health multiplier. */
    buildingHp: number;
    /** Share of squads sent down the flanks instead of the centre, 0 to 1. */
    flanking: number;
    /** Sides on smaller teams get bigger production and unit caps, so uneven teams (1v3) are a fair fight. */
    evenTeams: boolean;
    /** How fast the battle escalates, per mode (see RampSettings). */
    ramp: Record<BattleMode, RampSettings>;
  };
  units: Record<UnitId, UnitTuning>;
  /** Two or more sides, up to MAX_FACTIONS. */
  factions: FactionSettings[];
}

export const MAP_SIZES: Record<MapSize, { cols: number; rows: number; label: string }> = {
  small: { cols: 64, rows: 50, label: 'Small' },
  medium: { cols: 84, rows: 64, label: 'Medium' },
  large: { cols: 112, rows: 80, label: 'Large' },
};

export const UNIT_IDS = Object.keys(UNIT_DEFS) as UnitId[];

/** Ranges the UI offers; the URL parser clamps to them too. */
export const LIMITS = {
  water: { min: 0, max: 1 },
  hills: { min: 0, max: 2 },
  unitCap: { min: 10, max: 150 },
  production: { min: 0.25, max: 3 },
  startingArmy: { min: 0, max: 12 },
  tideStrength: { min: 0, max: 1 },
  tidePeriod: { min: 60, max: 400 },
  buildingHp: { min: 0.25, max: 4 },
  flanking: { min: 0, max: 1 },
  ramp: { min: 0, max: 1 },
  unitStat: { min: 0.25, max: 3 },
} as const;

function defaultUnitTuning(): Record<UnitId, UnitTuning> {
  return Object.fromEntries(UNIT_IDS.map((id) => [id, { hp: 1, damage: 1, speed: 1, range: 1 }])) as Record<UnitId, UnitTuning>;
}

export function defaultSettings(): BattleSettings {
  return {
    seed: '',
    mode: 'eternal',
    map: { size: 'medium', water: 0.5, hills: 1, town: true },
    armies: { unitCap: 60, production: 1, startingArmy: 4, tideStrength: 0.6, tidePeriod: 150, buildingHp: 1, flanking: 0.5, evenTeams: true, ramp: { conquest: { tide: 0.5, siege: 0.5 }, eternal: { tide: 0, siege: 0 } } },
    units: defaultUnitTuning(),
    factions: [defaultFaction(0), defaultFaction(1)],
  };
}

/** The default name and colour for the side in slot `i`, on its own team. */
export function defaultFaction(i: number): FactionSettings {
  return { name: FACTIONS[i].name, color: FACTIONS[i].primary, team: i };
}

export { MAX_FACTIONS };

/**
 * Renumber teams 0, 1, 2... in order of first appearance, keeping who is
 * allied with whom. Keeps team numbers within the number of sides after a
 * side is removed.
 */
export function compactTeams(s: BattleSettings): void {
  const order = [...new Set(s.factions.map((f) => f.team))];
  for (const f of s.factions) f.team = order.indexOf(f.team);
}

export function cloneSettings(s: BattleSettings): BattleSettings {
  return structuredClone(s);
}

/** The escalation rates for the settings' mode. */
export function rampFor(s: BattleSettings): RampSettings {
  return s.armies.ramp[s.mode];
}

/**
 * "Team 1", "Team 2"... per side, numbered in order of each team's first
 * side, or empty strings when every side is on its own (a free-for-all
 * needs no labels).
 */
export function teamLabels(s: BattleSettings): string[] {
  const order = [...new Set(s.factions.map((f) => f.team))];
  if (order.length === s.factions.length) return s.factions.map(() => '');
  return s.factions.map((f) => `Team ${order.indexOf(f.team) + 1}`);
}

/**
 * Base seats in order round the map: sides grouped by team (teams in order
 * of their lowest member), so allies are neighbours.
 */
export function seating(s: BattleSettings): number[] {
  const firstOf = new Map<number, number>();
  s.factions.forEach((f, i) => firstOf.has(f.team) || firstOf.set(f.team, i));
  return s.factions.map((_, i) => i).sort((a, b) => firstOf.get(s.factions[a].team)! - firstOf.get(s.factions[b].team)! || a - b);
}

/** Terrain parameters for these settings. */
export function battlefieldConfig(s: BattleSettings): BattlefieldConfig {
  const size = MAP_SIZES[s.map.size];
  const maxHeight = DEFAULT_BATTLEFIELD.maxHeight * s.map.hills;
  // Water level scales with the hills so "some water" looks the same on any terrain.
  // The factor makes the defaults (water 0.5, hills 1) match the hand-tuned map.
  const seaLevel = maxHeight * s.map.water * ((DEFAULT_BATTLEFIELD.seaLevel / DEFAULT_BATTLEFIELD.maxHeight) * 2);
  // More sides need more room: grow the map (keeping its shape) until every base fits with space between.
  const { cellSize, baseRadius } = DEFAULT_BATTLEFIELD;
  const n = s.factions.length;
  let scale = 1;
  while (scale < 3 && !seatsFit(n, Math.round(size.cols * scale) * cellSize, Math.round(size.rows * scale) * cellSize, baseRadius)) scale += 0.05;
  return {
    ...DEFAULT_BATTLEFIELD,
    cols: Math.round(size.cols * scale),
    rows: Math.round(size.rows * scale),
    maxHeight,
    seaLevel,
    town: s.map.town,
    seats: seating(s),
  };
}

/** Unit definitions with the per-unit multipliers applied. */
export function tunedUnits(s: BattleSettings): Record<UnitId, UnitDef> {
  const out = {} as Record<UnitId, UnitDef>;
  for (const id of UNIT_IDS) {
    const base: UnitDef = UNIT_DEFS[id];
    const t = s.units[id];
    out[id] = {
      ...base,
      hp: Math.round(base.hp * t.hp),
      speed: base.speed * t.speed,
      // Units have to see far enough to use their range.
      sight: base.sight * Math.max(1, t.range),
      weapon: {
        ...base.weapon,
        damage: base.weapon.damage * t.damage,
        range: base.weapon.range * t.range,
        minRange: base.weapon.minRange * t.range,
      },
    };
  }
  return out;
}

/** Building definitions with the building health multiplier applied. */
export function tunedBuildings(s: BattleSettings): Record<BuildingId, BuildingDef> {
  const out = {} as Record<BuildingId, BuildingDef>;
  for (const id of Object.keys(BUILDING_DEFS) as BuildingId[]) {
    const base: BuildingDef = BUILDING_DEFS[id];
    out[id] = { ...base, hp: Math.round(base.hp * s.armies.buildingHp) };
  }
  return out;
}

/** Faction display definitions (names and colours) for these settings, one per side. */
export function factionDefs(s: BattleSettings): FactionDef[] {
  return s.factions.map((f, i) => ({ ...FACTIONS[i], name: f.name.trim() || FACTIONS[i].name, primary: f.color }));
}
