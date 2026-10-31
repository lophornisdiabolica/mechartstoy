import { BattlefieldConfig, DEFAULT_BATTLEFIELD } from '../world/battlefield';
import { BUILDING_DEFS, BuildingDef, BuildingId } from './buildings';
import { FACTIONS, FactionDef } from './factions';
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

export interface FactionSettings {
  name: string;
  /** Main hull colour as 0xRRGGBB. */
  color: number;
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
  };
  units: Record<UnitId, UnitTuning>;
  factions: [FactionSettings, FactionSettings];
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
    armies: { unitCap: 60, production: 1, startingArmy: 4, tideStrength: 0.6, tidePeriod: 150, buildingHp: 1 },
    units: defaultUnitTuning(),
    factions: [
      { name: FACTIONS[0].name, color: FACTIONS[0].primary },
      { name: FACTIONS[1].name, color: FACTIONS[1].primary },
    ],
  };
}

export function cloneSettings(s: BattleSettings): BattleSettings {
  return structuredClone(s);
}

/** Terrain parameters for these settings. */
export function battlefieldConfig(s: BattleSettings): BattlefieldConfig {
  const size = MAP_SIZES[s.map.size];
  const maxHeight = DEFAULT_BATTLEFIELD.maxHeight * s.map.hills;
  // Water level scales with the hills so "some water" looks the same on any terrain.
  // The factor makes the defaults (water 0.5, hills 1) match the hand-tuned map.
  const seaLevel = maxHeight * s.map.water * ((DEFAULT_BATTLEFIELD.seaLevel / DEFAULT_BATTLEFIELD.maxHeight) * 2);
  return { ...DEFAULT_BATTLEFIELD, cols: size.cols, rows: size.rows, maxHeight, seaLevel, town: s.map.town };
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

/** Faction display definitions (names and colours) for these settings. */
export function factionDefs(s: BattleSettings): FactionDef[] {
  return FACTIONS.map((f, i) => ({ ...f, name: s.factions[i].name.trim() || f.name, primary: s.factions[i].color }));
}
