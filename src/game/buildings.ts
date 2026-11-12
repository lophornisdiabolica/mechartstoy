import { UnitId, WeaponDef } from './units';

/**
 * Building definitions. Like units, these are data: adding a building type is
 * an entry here plus a model registered under its `model` key.
 */
export interface ProductionEntry {
  unit: UnitId;
  weight: number;
  count: number;
  /** Other units in the same squad, e.g. an AT soldier with the riflemen. */
  with?: { unit: UnitId; count: number };
  /** Built instead when there's no water at the door for this (naval) unit to launch into. */
  ifDry?: UnitId;
}

export interface BuildingDef {
  id: string;
  name: string;
  model: string;
  hp: number;
  /** Taken off every hit, like a unit's (see UnitDef.armor): rifles barely scratch a building. */
  armor: number;
  /** Footprint radius, used for collisions, targeting and rubble size. */
  radius: number;
  /** Height of the main body: shots below this that cross the footprint hit the building. */
  height: number;
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
  /**
   * Spotting radius: allied units can fire at enemies inside it that are past
   * their own sight but within their weapon's range (see targeting.ts).
   */
  spots?: number;
  /** Blows up when destroyed, hurting everything within the radius, friend or foe. */
  explodes?: { damage: number; radius: number };
  /** Built on a shore with its door facing open water (see layoutBase). */
  coastal?: boolean;
  /** Seconds from destruction until reconstruction starts. */
  rebuildDelay: number;
  /**
   * Built by engineers in battle (see commander/engineers.ts): it crumbles over this many
   * seconds, and isn't rebuilt when destroyed, so fortifications don't pile up for ever.
   */
  lasts?: number;
  /**
   * Put up by engineers in battle (see commander/engineers.ts): it leaves no
   * rubble and isn't rebuilt when destroyed (engineers may build another),
   * and it doesn't keep its side in a Conquest battle.
   */
  field?: boolean;
  /** Seconds the construction animation takes. */
  buildTime: number;
  /** Low enough for walkers to step over (see MoveRules.over): walls. */
  low?: boolean;
  /** Aircraft out of ammunition fly to the nearest of these of their side to rearm (see Ammo): airpads and forward helipads. */
  rearms?: boolean;
}

/**
 * Guard towers' armour-piercing round: against anything with heavy armour
 * (tanks, walkers, super units), the tower stops spraying its cannon and
 * fires one big slow shell that goes through half the armour. Trucks and
 * infantry still get the cannon.
 */
const towerShell: WeaponDef = {
  name: 'Tower AP shell',
  range: 15,
  minRange: 0,
  damage: 30,
  cooldown: 3,
  burst: 1,
  burstGap: 0,
  projectile: 'shell',
  speed: 55,
  splash: 0,
  spread: 0.03,
  arc: false,
  muzzleHeight: 2.1,
  targets: 'both',
  pierce: 0.5,
};

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
  targets: 'both',
  heavy: towerShell,
  heavyAt: 6,
};

/** The hilltop gun: a big, slow artillery piece that lobs shells over whatever's in the way. */
const bigGunShell: WeaponDef = {
  name: 'Heavy gun',
  range: 32,
  minRange: 8,
  damage: 55,
  cooldown: 7,
  burst: 1,
  burstGap: 0,
  projectile: 'artillery',
  speed: 17,
  splash: 3,
  spread: 0.08,
  arc: true,
  muzzleHeight: 1.6,
  targets: 'ground',
};

/** A shore battery's gun: flat, hard-hitting shots out over the water at boats (and anything else on the ground). */
const shoreShell: WeaponDef = {
  name: 'Shore gun',
  range: 24,
  minRange: 3,
  damage: 42,
  cooldown: 3.2,
  burst: 1,
  burstGap: 0,
  projectile: 'shell',
  speed: 40,
  splash: 1.2,
  spread: 0.04,
  arc: false,
  muzzleHeight: 1.4,
  targets: 'ground',
};

export const BUILDING_DEFS = {
  hq: {
    id: 'hq',
    name: 'Command Centre',
    model: 'bld:hq',
    hp: 1800,
    armor: 10,
    radius: 3.2,
    height: 4.5,
    production: { table: [{ unit: 'trooper', weight: 1, count: 3, with: { unit: 'atTrooper', count: 1 } }], interval: 30 },
    rebuildDelay: 45,
    buildTime: 12,
  },
  barracks: {
    id: 'barracks',
    name: 'Barracks',
    model: 'bld:barracks',
    hp: 650,
    armor: 6,
    radius: 2.4,
    height: 2.4,
    production: { table: [{ unit: 'trooper', weight: 1, count: 4, with: { unit: 'atTrooper', count: 1 } }], interval: 15 },
    rebuildDelay: 35,
    buildTime: 8,
  },
  factory: {
    id: 'factory',
    name: 'Vehicle Factory',
    model: 'bld:factory',
    hp: 950,
    armor: 8,
    radius: 3,
    height: 4,
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
    armor: 8,
    radius: 2.6,
    height: 4,
    // Slow on purpose: super units are rare (see caps.ts).
    production: { table: [{ unit: 'titan', weight: 1, count: 1 }], interval: 60 },
    rebuildDelay: 50,
    buildTime: 12,
  },
  // Doctrine signature buildings (see doctrines.ts): one goes in each base, by its side's doctrine.
  tankDepot: {
    id: 'tankDepot',
    name: 'Tank Depot',
    model: 'bld:tankDepot',
    hp: 900,
    armor: 8,
    radius: 2.8,
    height: 3.2,
    production: { table: [{ unit: 'lancer', weight: 1, count: 1 }], interval: 40 },
    rebuildDelay: 45,
    buildTime: 12,
  },
  airpad: {
    id: 'airpad',
    name: 'Airpad',
    model: 'bld:airpad',
    hp: 750,
    armor: 6,
    radius: 2.8,
    height: 1.6,
    production: { table: [{ unit: 'scout', weight: 1, count: 1 }], interval: 24 },
    rearms: true,
    rebuildDelay: 40,
    buildTime: 10,
  },
  motorPool: {
    id: 'motorPool',
    name: 'Motor Pool',
    model: 'bld:motorPool',
    hp: 700,
    armor: 6,
    radius: 2.6,
    height: 2.2,
    production: { table: [{ unit: 'mgTruck', weight: 1, count: 2 }], interval: 16 },
    rebuildDelay: 35,
    buildTime: 8,
  },
  barracksBlock: {
    id: 'barracksBlock',
    name: 'Barracks Block',
    model: 'bld:barracksBlock',
    hp: 800,
    armor: 7,
    radius: 2.8,
    height: 3.4,
    production: { table: [{ unit: 'trooper', weight: 1, count: 6, with: { unit: 'atTrooper', count: 1 } }], interval: 18 },
    rebuildDelay: 40,
    buildTime: 10,
  },
  // Bastion: a tall mast that spots for the artillery.
  sensorMast: {
    id: 'sensorMast',
    name: 'Sensor Mast',
    model: 'bld:sensorMast',
    hp: 500,
    armor: 7,
    radius: 1.4,
    height: 6,
    spots: 30,
    rebuildDelay: 40,
    buildTime: 10,
  },
  // Talon: heavy walkers.
  mechForge: {
    id: 'mechForge',
    name: 'Mech Forge',
    model: 'bld:mechForge',
    hp: 900,
    armor: 8,
    radius: 2.8,
    height: 4,
    production: { table: [{ unit: 'warhound', weight: 1, count: 1 }], interval: 45 },
    rebuildDelay: 45,
    buildTime: 12,
  },
  // Tidewater: boats from a dock on the coast, or hovers from a pad when the base has no coast.
  dock: {
    id: 'dock',
    name: 'Dock',
    model: 'bld:dock',
    hp: 750,
    armor: 6,
    radius: 2.6,
    height: 2.4,
    production: { table: [{ unit: 'missileBoat', weight: 1, count: 2 }], interval: 28 },
    coastal: true,
    rebuildDelay: 40,
    buildTime: 10,
  },
  hoverPad: {
    id: 'hoverPad',
    name: 'Hover Pad',
    model: 'bld:hoverPad',
    hp: 700,
    armor: 6,
    radius: 2.6,
    height: 1.4,
    production: { table: [{ unit: 'skimmer', weight: 1, count: 2 }], interval: 30 },
    rebuildDelay: 40,
    buildTime: 10,
  },
  // Firestorm: fuel for the flamers, and a big bang when it goes.
  fuelDepot: {
    id: 'fuelDepot',
    name: 'Fuel Depot',
    model: 'bld:fuelDepot',
    hp: 650,
    armor: 6,
    radius: 2.6,
    height: 2.6,
    production: { table: [{ unit: 'scorchBuggy', weight: 1, count: 2 }], interval: 30 },
    explodes: { damage: 80, radius: 6 },
    rebuildDelay: 40,
    buildTime: 10,
  },
  tower: {
    id: 'tower',
    name: 'Guard Tower',
    model: 'bld:tower',
    hp: 400,
    armor: 8,
    radius: 0.9,
    height: 2.2,
    weapon: towerCannon,
    sight: 16,
    turretTurnRate: 2.5,
    rebuildDelay: 30,
    buildTime: 6,
  },
  // A guard tower engineers put up behind their walls (see commander/engineers.ts); it crumbles like the walls.
  fieldTower: {
    id: 'fieldTower',
    name: 'Field Tower',
    model: 'bld:tower',
    hp: 400,
    armor: 8,
    radius: 0.9,
    height: 2.2,
    weapon: towerCannon,
    sight: 16,
    turretTurnRate: 2.5,
    lasts: 900,
    field: true,
    rebuildDelay: 0,
    buildTime: 10,
  },
  wall: {
    id: 'wall',
    name: 'Wall',
    model: 'bld:wall',
    hp: 700,
    armor: 10,
    radius: 1.2,
    height: 1.2,
    low: true,
    lasts: 600,
    field: true,
    rebuildDelay: 0,
    buildTime: 8,
  },
  // Bastion's engineers: a lattice mast with dishes that spots for the guns at the front, like a small sensor mast.
  commsArray: {
    id: 'commsArray',
    name: 'Comms Array',
    model: 'bld:commsArray',
    hp: 380,
    armor: 6,
    radius: 1.1,
    height: 5,
    spots: 22,
    lasts: 900,
    field: true,
    rebuildDelay: 0,
    buildTime: 12,
  },
  // Land armies' engineers: a gun on the shore where enemy boats are shelling the side (see commander/engineers.ts); it crumbles like the walls.
  shoreBattery: {
    id: 'shoreBattery',
    name: 'Shore Battery',
    model: 'bld:bigGun',
    hp: 650,
    armor: 12,
    radius: 1.6,
    height: 1.6,
    weapon: shoreShell,
    sight: 26,
    turretTurnRate: 1.2,
    lasts: 900,
    field: true,
    rebuildDelay: 0,
    buildTime: 12,
  },
  // Skyline's engineers: a pad at an outpost its side holds, where aircraft rearm without flying all the way home.
  helipad: {
    id: 'helipad',
    name: 'Forward Helipad',
    model: 'bld:helipad',
    hp: 450,
    armor: 6,
    radius: 1.7,
    height: 0.4,
    rearms: true,
    field: true,
    rebuildDelay: 0,
    buildTime: 10,
  },
  outpost: {
    id: 'outpost',
    name: 'Outpost',
    model: 'bld:outpost',
    // The post itself can't be destroyed, only captured (see outposts.ts).
    hp: 1,
    armor: 0,
    radius: 1.4,
    height: 1.5,
    rebuildDelay: 0,
    buildTime: 1,
  },
  bunker: {
    id: 'bunker',
    name: 'Garrison Bunker',
    model: 'bld:bunker',
    hp: 600,
    armor: 8,
    radius: 1.8,
    height: 1.1,
    rebuildDelay: 40,
    buildTime: 8,
  },
  // Outpost kinds' own buildings (see OUTPOST_KINDS in outposts.ts).
  airstrip: {
    id: 'airstrip',
    name: 'Airstrip',
    model: 'bld:airstrip',
    hp: 600,
    armor: 6,
    radius: 2.4,
    height: 1.6,
    rebuildDelay: 40,
    buildTime: 8,
  },
  bigGun: {
    id: 'bigGun',
    name: 'Hilltop Gun',
    model: 'bld:bigGun',
    hp: 900,
    armor: 10,
    radius: 1.6,
    height: 1.6,
    weapon: bigGunShell,
    sight: 22,
    turretTurnRate: 0.7,
    rebuildDelay: 50,
    buildTime: 10,
  },
  relayMast: {
    id: 'relayMast',
    name: 'Comms Relay',
    model: 'bld:relayMast',
    hp: 450,
    armor: 6,
    radius: 1.3,
    height: 6,
    spots: 24,
    rebuildDelay: 40,
    buildTime: 8,
  },
  fuelTanks: {
    id: 'fuelTanks',
    name: 'Fuel Tanks',
    model: 'bld:fuelTanks',
    hp: 400,
    armor: 5,
    radius: 1.8,
    height: 2.2,
    explodes: { damage: 70, radius: 6 },
    rebuildDelay: 45,
    buildTime: 8,
  },
  ruinedFactory: {
    id: 'ruinedFactory',
    name: 'Ruined Factory',
    model: 'bld:ruinedFactory',
    hp: 700,
    armor: 7,
    radius: 2.4,
    height: 2.4,
    rebuildDelay: 45,
    buildTime: 10,
  },
  house: {
    id: 'house',
    name: 'House',
    model: 'bld:house',
    hp: 160,
    armor: 2,
    radius: 1.2,
    height: 1.5,
    rebuildDelay: 70,
    buildTime: 6,
  },
  block: {
    id: 'block',
    name: 'Habitat Block',
    model: 'bld:block',
    hp: 320,
    armor: 4,
    radius: 1.6,
    height: 2.8,
    rebuildDelay: 80,
    buildTime: 8,
  },
  spire: {
    id: 'spire',
    name: 'Comms Spire',
    model: 'bld:spire',
    hp: 220,
    armor: 4,
    radius: 1,
    height: 5,
    rebuildDelay: 80,
    buildTime: 8,
  },
  silo: {
    id: 'silo',
    name: 'Silo',
    model: 'bld:silo',
    hp: 200,
    armor: 3,
    radius: 1.1,
    height: 3,
    rebuildDelay: 70,
    buildTime: 6,
  },
  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    model: 'bld:warehouse',
    hp: 380,
    armor: 4,
    radius: 1.9,
    height: 1.9,
    rebuildDelay: 80,
    buildTime: 8,
  },
} satisfies Record<string, BuildingDef>;

export type BuildingId = keyof typeof BUILDING_DEFS;

/** Purely civic buildings used to fill out bases and towns. */
export const DECORATIVE_BUILDINGS: BuildingId[] = ['house', 'house', 'block', 'spire', 'silo'];
