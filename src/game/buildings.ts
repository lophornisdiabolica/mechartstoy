import { UnitId, WeaponDef } from './units';

/**
 * Building definitions. Like units, these are data: adding a building type is
 * an entry here plus a model registered under its `model` key.
 */
export interface ProductionEntry {
  unit: UnitId;
  weight: number;
  count: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  model: string;
  hp: number;
  /** Fraction of incoming damage ignored, 0..1. */
  armor: number;
  /** Footprint radius, used for collisions, targeting and rubble size. */
  radius: number;
  /** Units this building turns out on a timer. */
  production?: {
    table: ProductionEntry[];
    /** Seconds between batches (before rubber-banding). */
    interval: number;
  };
  /** Defensive weapon, aimed by a turret. */
  weapon?: WeaponDef;
  sight?: number;
  turretTurnRate?: number;
  /** Seconds from destruction until reconstruction starts. */
  rebuildDelay: number;
  /** Seconds the construction animation takes. */
  buildTime: number;
}

const towerCannon: WeaponDef = {
  name: 'Tower cannon',
  range: 15,
  minRange: 0,
  damage: 7,
  cooldown: 1.6,
  burst: 3,
  burstGap: 0.15,
  projectile: 'bullet',
  speed: 60,
  splash: 0.8,
  spread: 0.06,
  arc: false,
  muzzleHeight: 2.1,
};

export const BUILDING_DEFS = {
  hq: {
    id: 'hq',
    name: 'Command Centre',
    model: 'bld:hq',
    hp: 1800,
    armor: 0.5,
    radius: 3.2,
    production: { table: [{ unit: 'trooper', weight: 1, count: 4 }], interval: 30 },
    rebuildDelay: 45,
    buildTime: 12,
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    model: 'bld:barracks',
    hp: 650,
    armor: 0.3,
    radius: 2.4,
    production: { table: [{ unit: 'trooper', weight: 1, count: 5 }], interval: 15 },
    rebuildDelay: 35,
    buildTime: 8,
  },
  factory: {
    id: 'factory',
    name: 'Vehicle Factory',
    model: 'bld:factory',
    hp: 950,
    armor: 0.35,
    radius: 3,
    production: {
      table: [
        { unit: 'strider', weight: 3, count: 2 },
        { unit: 'tank', weight: 2.5, count: 1 },
        { unit: 'howitzer', weight: 1.6, count: 1 },
      ],
      interval: 18,
    },
    rebuildDelay: 40,
    buildTime: 10,
  },
  mechbay: {
    id: 'mechbay',
    name: 'Mech Bay',
    model: 'bld:mechbay',
    hp: 900,
    armor: 0.35,
    radius: 2.6,
    production: { table: [{ unit: 'titan', weight: 1, count: 1 }], interval: 35 },
    rebuildDelay: 50,
    buildTime: 12,
  },
  tower: {
    id: 'tower',
    name: 'Guard Tower',
    model: 'bld:tower',
    hp: 400,
    armor: 0.4,
    radius: 0.9,
    weapon: towerCannon,
    sight: 16,
    turretTurnRate: 2.5,
    rebuildDelay: 30,
    buildTime: 6,
  },
  house: {
    id: 'house',
    name: 'House',
    model: 'bld:house',
    hp: 160,
    armor: 0.1,
    radius: 1.2,
    rebuildDelay: 70,
    buildTime: 6,
  },
  block: {
    id: 'block',
    name: 'Habitat Block',
    model: 'bld:block',
    hp: 320,
    armor: 0.2,
    radius: 1.6,
    rebuildDelay: 80,
    buildTime: 8,
  },
  spire: {
    id: 'spire',
    name: 'Comms Spire',
    model: 'bld:spire',
    hp: 220,
    armor: 0.2,
    radius: 1,
    rebuildDelay: 80,
    buildTime: 8,
  },
  silo: {
    id: 'silo',
    name: 'Silo',
    model: 'bld:silo',
    hp: 200,
    armor: 0.15,
    radius: 1.1,
    rebuildDelay: 70,
    buildTime: 6,
  },
} satisfies Record<string, BuildingDef>;

export type BuildingId = keyof typeof BUILDING_DEFS;

/** Purely civic buildings used to fill out bases and towns. */
export const DECORATIVE_BUILDINGS: BuildingId[] = ['house', 'house', 'block', 'spire', 'silo'];
