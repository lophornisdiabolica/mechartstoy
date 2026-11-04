import { BattlefieldConfig, DEFAULT_BATTLEFIELD, OUTPOST_KIND_IDS, OutpostKind, seatsFit } from '../world/battlefield';
import { BiomeId } from '../world/biomes';
import { BUILDING_DEFS, BuildingDef, BuildingId } from './buildings';
import { FACTIONS, FactionDef, MAX_FACTIONS } from './factions';
import { UNIT_DEFS, UnitCategory, UnitDef, UnitId } from './units';
import { defaultDoctrine, DoctrineId } from './doctrines';
import { defaultVariety, VarietySettings } from './variety';

/**
 * Everything a player can tune before a battle, in one plain object. The setup
 * screen edits it, the URL stores it, and the game derives its rules from it.
 * Multipliers are relative to the hand-tuned defaults in units.ts and
 * buildings.ts, so 1 always means "as designed".
 */
export type BattleMode = 'eternal' | 'conquest';
export type MapSize = 'small' | 'medium' | 'large';
/**
 * Where the bases go:
 * - ring: round the edge of the map, allies side by side;
 * - apart: round the edge, allies spread out between their enemies;
 * - lines: teams face each other from opposite ends of the map.
 */
export type BaseLayout = 'ring' | 'apart' | 'lines';
export type TownSize = 'small' | 'medium' | 'large';
/** When armies attack: once they're strong enough (see offensive.ts), or on the tide's clock (see tide.ts). */
export type AttackTiming = 'readiness' | 'tide';

export interface UnitTuning {
  hp: number;
  damage: number;
  speed: number;
  range: number;
}

/**
 * What makes a side's super-unit cap grow past its base (see caps.ts):
 * - none: it stays at the base all battle;
 * - tide: it grows with the tide ramp, up to 3× the base when the ramp tops out;
 * - outposts: each outpost held past the first adds one.
 */
export type SuperGrowth = 'none' | 'tide' | 'outposts';

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
  /** What kind of army it fields (see doctrines.ts). */
  doctrine: DoctrineId;
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
    /**
     * Width over depth, relative to the size's usual shape: above 1 is wider
     * and shallower, below 1 narrower and deeper, with about the same area.
     */
    shape: number;
    /** Ground, water, scenery and town style (see biomes.ts). Looks only. */
    biome: BiomeId;
    /** Where the bases go. */
    layout: BaseLayout;
    /** Civilian towns in no-man's land, and how big they are. */
    towns: number;
    townSize: TownSize;
    /** Join the bases' water with channels and bridge them (see waterways.ts). */
    waterways: boolean;
    /** Dense forest, 0 (none) to 1: patches of big trees that block shots and slow vehicles until they're knocked down (see woods.ts). */
    forest: number;
    /** Wrecked vehicles pile up into scrap that's hard going for tracks and hovers (see scrap.ts). */
    scrap: boolean;
    /** Capturable outposts in no-man's land: a number, or 'auto' for one per side. */
    outposts: number | 'auto';
    /** The kinds of outpost to deal out (see OUTPOST_KINDS in outposts.ts); empty means supply depots only. */
    outpostKinds: OutpostKind[];
    /**
     * Bases, towns and outposts placed by hand (on the setup screen's map), as
     * fractions of the map's half-width and half-depth (-1 to 1), or null to
     * place them automatically. Bases are listed by side. A list that doesn't
     * match the number of sides, towns or outposts is ignored.
     */
    placed: Placements;
  };
  armies: {
    /** Units each side can have alive per category (see caps.ts). Super is the base, before it grows. */
    caps: Record<UnitCategory, number>;
    /** What makes the super-unit cap grow during a battle. */
    superGrowth: SuperGrowth;
    /**
     * On maps with outposts, super units are only built while the side holds one. Off by
     * default: whoever reached readiness first took the outposts, and with them every Titan
     * (1v1 large went 7–1 to the first side). Worth revisiting with squad-level Commander AI.
     */
    superGate: boolean;
    /** Production speed multiplier. */
    production: number;
    /** Groups each side starts with. */
    startingArmy: number;
    /** When armies attack. */
    attackTiming: AttackTiming;
    /** How hard the tide swings production, 0 (steady) to 1. */
    tideStrength: number;
    /** Seconds for a full tide cycle (both sides attack once). */
    tidePeriod: number;
    /** Building health multiplier. */
    buildingHp: number;
    /** Share of squads sent down the flanks instead of the centre, 0 to 1. */
    flanking: number;
    /**
     * How much bigger armies sides on smaller teams get: production and unit cap are
     * multiplied by (largest team ÷ their team) to this power. 0 is off; 1 is in full
     * proportion (alone against three, 3×). The default, 0.85 (about 2.5×), was
     * roughly even in 1v3 Conquest with attacks on readiness, where a lone side
     * keeps its army together and picks the others off one at a time.
     */
    evenTeams: number;
    /** How fast the battle escalates, per mode (see RampSettings). */
    ramp: Record<BattleMode, RampSettings>;
    /** Multiplier on what holding an outpost gives (see outposts.ts); 0 makes them worth nothing but ground. */
    outpostBonus: number;
    /**
     * Share of the squads on an outpost's lane that hold it between attacks, 0 to 1. Off by
     * default: holding leaves bases thinner, which made Conquest battles about a minute shorter.
     */
    outpostHold: number;
  };
  units: Record<UnitId, UnitTuning>;
  /** Two or more sides, up to MAX_FACTIONS. */
  factions: FactionSettings[];
  /** What to re-roll between battles (see variety.ts). Not used by the battle itself. */
  variety: VarietySettings;
}

/**
 * Outpost kinds dealt out by default: all but the comms relay, whose bonus
 * (attacks set out sooner) belongs to the readiness rule that Commander AI
 * is going to replace.
 */
export const DEFAULT_OUTPOST_KINDS: OutpostKind[] = OUTPOST_KIND_IDS.filter((k) => k !== 'relay');

/** Town radius per size. */
export const TOWN_SIZES: Record<TownSize, { radius: number; label: string }> = {
  small: { radius: 8, label: 'Small' },
  medium: { radius: 11, label: 'Medium' },
  large: { radius: 15, label: 'Large' },
};

/** Water from which waterways also dig an inlet to bases that have no water (see WaterwayOptions.everyBase). */
export const INLETS_FROM = 0.6;

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
  shape: { min: 0.6, max: 1.8 },
  towns: { min: 0, max: 4 },
  infantryCap: { min: 5, max: 120 },
  vehicleCap: { min: 0, max: 60 },
  airCap: { min: 0, max: 40 },
  superCap: { min: 0, max: 6 },
  production: { min: 0.25, max: 3 },
  startingArmy: { min: 0, max: 12 },
  tideStrength: { min: 0, max: 1 },
  tidePeriod: { min: 60, max: 400 },
  buildingHp: { min: 0.25, max: 4 },
  flanking: { min: 0, max: 1 },
  evenTeams: { min: 0, max: 1.5 },
  ramp: { min: 0, max: 1 },
  outposts: { min: 0, max: 12 },
  forest: { min: 0, max: 1 },
  outpostBonus: { min: 0, max: 3 },
  outpostHold: { min: 0, max: 1 },
  unitStat: { min: 0.25, max: 3 },
} as const;

function defaultUnitTuning(): Record<UnitId, UnitTuning> {
  return Object.fromEntries(UNIT_IDS.map((id) => [id, { hp: 1, damage: 1, speed: 1, range: 1 }])) as Record<UnitId, UnitTuning>;
}

export function defaultSettings(): BattleSettings {
  return {
    seed: '',
    mode: 'eternal',
    map: { size: 'medium', water: 0.5, hills: 1, shape: 1, biome: 'temperate', layout: 'ring', towns: 1, townSize: 'medium', waterways: true, forest: 0.2, scrap: true, outposts: 'auto', outpostKinds: [...DEFAULT_OUTPOST_KINDS], placed: { bases: null, towns: null, outposts: null } },
    armies: {
      caps: { infantry: 45, vehicle: 15, air: 4, super: 1 },
      superGrowth: 'tide',
      superGate: false,
      production: 1,
      startingArmy: 4,
      attackTiming: 'readiness',
      tideStrength: 0.6,
      tidePeriod: 150,
      buildingHp: 1,
      flanking: 0.5,
      evenTeams: 0.85,
      ramp: { conquest: { tide: 0.5, siege: 0.5 }, eternal: { tide: 0, siege: 0 } },
      outpostBonus: 1,
      outpostHold: 0,
    },
    units: defaultUnitTuning(),
    factions: [defaultFaction(0), defaultFaction(1)],
    variety: defaultVariety(),
  };
}

/** The default name, colour and doctrine for the side in slot `i`, on its own team. */
export function defaultFaction(i: number): FactionSettings {
  return { name: FACTIONS[i].name, color: FACTIONS[i].primary, team: i, doctrine: defaultDoctrine(i) };
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
 * of their lowest member), so allies are neighbours. With the 'apart'
 * layout, teams take turns instead, so allies are spread round the map.
 */
export function seating(s: BattleSettings): number[] {
  const firstOf = new Map<number, number>();
  s.factions.forEach((f, i) => firstOf.has(f.team) || firstOf.set(f.team, i));
  const grouped = s.factions.map((_, i) => i).sort((a, b) => firstOf.get(s.factions[a].team)! - firstOf.get(s.factions[b].team)! || a - b);
  if (s.map.layout !== 'apart') return grouped;
  // Deal teams round the table: first of each team, then second of each, and so on.
  const teams = [...firstOf.keys()].map((t) => grouped.filter((i) => s.factions[i].team === t));
  const out: number[] = [];
  for (let k = 0; out.length < grouped.length; k++) for (const team of teams) if (team[k] !== undefined) out.push(team[k]);
  return out;
}

/**
 * Base places for the 'lines' layout, per seat: teams alternate between the
 * west and east ends (the first team west), and each end's bases spread
 * evenly from north to south. Null for the other layouts.
 */
export function basePlaces(s: BattleSettings, seats: number[]): { x: number; z: number }[] | null {
  if (s.map.layout !== 'lines') return null;
  const teams = [...new Set(seats.map((f) => s.factions[f].team))];
  const west = seats.filter((f) => teams.indexOf(s.factions[f].team) % 2 === 0);
  const east = seats.filter((f) => teams.indexOf(s.factions[f].team) % 2 === 1);
  const along = (k: number, n: number) => (n === 1 ? 0 : -0.6 + (1.2 * k) / (n - 1));
  return seats.map((f) => {
    const side = west.includes(f) ? west : east;
    return { x: side === west ? -0.72 : 0.72, z: along(side.indexOf(f), side.length) };
  });
}

/** A spot on the map as fractions of its half-width and half-depth: -1 to 1 from one edge to the other. */
export interface MapSpot {
  x: number;
  z: number;
}

export interface Placements {
  bases: MapSpot[] | null;
  towns: MapSpot[] | null;
  outposts: MapSpot[] | null;
}

/** The hand placements that apply to these settings (lists of the right length), the rest null. */
export function placementsInUse(s: BattleSettings): Placements {
  const { bases, towns, outposts } = s.map.placed;
  return {
    bases: bases && bases.length === s.factions.length ? bases : null,
    towns: towns && towns.length === s.map.towns ? towns : null,
    outposts: outposts && outposts.length === outpostCount(s) ? outposts : null,
  };
}

/** How many outposts to place: 'auto' is one per side. */
export function outpostCount(s: BattleSettings): number {
  return s.map.outposts === 'auto' ? s.factions.length : s.map.outposts;
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
  // The shape stretches one way and squeezes the other, keeping the area.
  const stretch = Math.sqrt(s.map.shape);
  const cols = size.cols * stretch;
  const rows = size.rows / stretch;
  const seats = seating(s);
  const placed = placementsInUse(s);
  const places = placed.bases ? seats.map((f) => placed.bases![f]) : basePlaces(s, seats);
  // Bases on a line need room along the map's depth instead.
  const fits = (scale: number) => {
    const width = Math.round(cols * scale) * cellSize;
    const depth = Math.round(rows * scale) * cellSize;
    if (!places) return seatsFit(n, width, depth, baseRadius);
    // Placed by hand: every pair of bases has room between them.
    if (placed.bases) return places.every((a, i) => places.every((b, j) => j <= i || Math.hypot(((a.x - b.x) * width) / 2, ((a.z - b.z) * depth) / 2) >= baseRadius * 2 + 4));
    const perSide = Math.max(...[-1, 1].map((sign) => places.filter((p) => Math.sign(p.x) === sign).length));
    return perSide <= 1 || (1.2 * depth) / 2 / (perSide - 1) >= baseRadius * 2 + 8;
  };
  let scale = 1;
  while (scale < 3 && !fits(scale)) scale += 0.05;
  return {
    ...DEFAULT_BATTLEFIELD,
    cols: Math.round(cols * scale),
    rows: Math.round(rows * scale),
    maxHeight,
    seaLevel,
    seats,
    places,
    outposts: outpostCount(s),
    outpostKinds: s.map.outpostKinds.length > 0 ? s.map.outpostKinds : ['supply'],
    biome: s.map.biome,
    waterways: !s.map.waterways ? 'off' : s.map.water >= INLETS_FROM ? 'everyBase' : 'joined',
    forest: s.map.forest,
    towns: s.map.towns,
    townRadius: TOWN_SIZES[s.map.townSize].radius,
    townPlaces: placed.towns,
    outpostPlaces: placed.outposts,
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
  // The trim colour goes with the hull colour when it's one of the standard ones
  // (a side can wear another slot's colours after a re-roll), else with the slot.
  return s.factions.map((f, i) => ({
    ...FACTIONS[i],
    name: f.name.trim() || FACTIONS[i].name,
    primary: f.color,
    secondary: (FACTIONS.find((d) => d.primary === f.color) ?? FACTIONS[i]).secondary,
  }));
}
