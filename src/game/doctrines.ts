import { BuildingId, ProductionEntry } from './buildings';
import { UnitCategory, UnitId } from './units';
import type { SimContext } from './context';
import type { BuildingDef } from './buildings';

/**
 * Doctrines: what kind of army a side fields. Every side picks one freely
 * (each faction slot has a default, see FACTIONS). A doctrine is data: which
 * units each production building turns out, how its unit caps lean, which
 * super unit its mech bay builds, and one signature building in its base.
 *
 * Every doctrine shares a core: rifle squads with an AT trooper (whose
 * missiles also bring down aircraft), the Scout Copter, a heavy unit that can
 * stand up to super units and buildings, the HQ and towers.
 */
export type DoctrineId = 'armour' | 'raiders' | 'legion' | 'bastion' | 'talon' | 'skyline' | 'tidewater' | 'firestorm';

export interface DoctrineDef {
  id: DoctrineId;
  name: string;
  /** One line for the setup screen. */
  blurb: string;
  /** Multipliers on the settings' unit caps (missing categories are 1). */
  caps: Partial<Record<UnitCategory, number>>;
  /** What each production building turns out, replacing its default table. */
  production: Partial<Record<BuildingId, { table: ProductionEntry[]; interval?: number }>>;
  /** Built in the base alongside the HQ, barracks, factory and mech bay. */
  signature: BuildingId;
  /** Built instead of a coastal signature building (see BuildingDef.coastal) when the base has no coast. */
  inland?: BuildingId;
  /** Guard towers on top of the usual three. */
  extraTowers?: number;
  /** Eternal-mode reinforcement waves for a side with no production left. */
  waves: ProductionEntry[];
}

const rifleSquad = (riflemen: number, weight = 1, at = 1): ProductionEntry => ({ unit: 'trooper', weight, count: riflemen, with: { unit: 'atTrooper', count: at } });

export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  armour: {
    id: 'armour',
    name: 'Armour',
    blurb: 'Heavy tanks. Fewer infantry, more vehicles, flak tanks against infantry and aircraft, and the Lancer heavy tank from its tank depot. Super unit: the Titan.',
    caps: { infantry: 0.8, vehicle: 1.4 },
    production: {
      factory: {
        table: [
          { unit: 'tank', weight: 3, count: 1 },
          { unit: 'strider', weight: 2, count: 2 },
          { unit: 'flakTank', weight: 2, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      tankDepot: { table: [{ unit: 'lancer', weight: 1, count: 1 }], interval: 45 },
      mechbay: { table: [{ unit: 'titan', weight: 1, count: 1 }] },
    },
    signature: 'tankDepot',
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 3, count: 1 }, { unit: 'strider', weight: 2, count: 2 }, { unit: 'lancer', weight: 1, count: 1 }],
  },
  raiders: {
    id: 'raiders',
    name: 'Raiders',
    blurb: 'Fast trucks. Machine-gun trucks and scout buggies in numbers, rocket trucks for the heavy work, and a motor pool. Super unit: the Land-train.',
    caps: { infantry: 0.8, vehicle: 1.8 },
    production: {
      factory: {
        table: [
          { unit: 'mgTruck', weight: 3, count: 2 },
          { unit: 'rocketTruck', weight: 3, count: 1 },
          { unit: 'buggy', weight: 1.5, count: 2 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
        interval: 14,
      },
      motorPool: {
        table: [
          { unit: 'mgTruck', weight: 2, count: 2 },
          { unit: 'buggy', weight: 2, count: 3 },
        ],
      },
      mechbay: { table: [{ unit: 'landTrain', weight: 1, count: 1 }] },
    },
    signature: 'motorPool',
    waves: [rifleSquad(4, 3), { unit: 'mgTruck', weight: 3, count: 2 }, { unit: 'buggy', weight: 2, count: 2 }, { unit: 'rocketTruck', weight: 1.5, count: 1 }],
  },
  legion: {
    id: 'legion',
    name: 'Legion',
    blurb: 'Infantry masses. Bigger squads, mortar teams, squad carriers and light tanks, with a barracks block. Super unit: the Siege Crawler, which drops off squads as it goes.',
    caps: { infantry: 1.7, vehicle: 0.8 },
    production: {
      // Big squads with two AT troopers each: the Legion's answer to armour is many rockets.
      barracks: { table: [rifleSquad(4, 3, 2), { unit: 'mortar', weight: 1, count: 2 }], interval: 12 },
      barracksBlock: { table: [rifleSquad(5, 2, 2), { unit: 'mortar', weight: 1, count: 3 }], interval: 14 },
      factory: {
        table: [
          { unit: 'carrier', weight: 2, count: 1 },
          { unit: 'lightTank', weight: 2, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'siegeCrawler', weight: 1, count: 1 }] },
    },
    signature: 'barracksBlock',
    waves: [rifleSquad(5, 5), { unit: 'mortar', weight: 1.5, count: 2 }, { unit: 'carrier', weight: 1.5, count: 1 }, { unit: 'lightTank', weight: 1.5, count: 1 }],
  },
  skyline: {
    id: 'skyline',
    name: 'Skyline',
    blurb: 'Aircraft. Gunships, bombers and scout copters from its airpad, flak walkers on the ground, a bigger air cap and fewer of everything else. Super unit: the Airship Carrier, which launches drones.',
    caps: { infantry: 0.8, vehicle: 0.8, air: 2.5 },
    production: {
      factory: {
        table: [
          { unit: 'tank', weight: 2, count: 1 },
          { unit: 'flakWalker', weight: 2, count: 1 },
        ],
      },
      airpad: {
        table: [
          { unit: 'gunship', weight: 2, count: 1 },
          { unit: 'bomber', weight: 1.2, count: 1 },
          { unit: 'scout', weight: 1.5, count: 2 },
        ],
        interval: 22,
      },
      mechbay: { table: [{ unit: 'airship', weight: 1, count: 1 }] },
    },
    signature: 'airpad',
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 2, count: 1 }, { unit: 'gunship', weight: 2, count: 1 }, { unit: 'scout', weight: 1.5, count: 2 }],
  },
  bastion: {
    id: 'bastion',
    name: 'Bastion',
    blurb: 'Artillery and fortresses. Howitzers and railgun batteries that outrange everything else, a sensor mast that spots for them, and extra guard towers. Super unit: the Fortress Walker, which spots for the guns round it.',
    caps: { vehicle: 1.1 },
    production: {
      factory: {
        table: [
          { unit: 'howitzer', weight: 2.4, count: 1 },
          { unit: 'tank', weight: 2, count: 1 },
          { unit: 'railgun', weight: 1.5, count: 1 },
          { unit: 'flakTank', weight: 1.2, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'fortress', weight: 1, count: 1 }] },
    },
    signature: 'sensorMast',
    extraTowers: 2,
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 2, count: 1 }, { unit: 'howitzer', weight: 2, count: 1 }, { unit: 'railgun', weight: 1, count: 1 }],
  },
  talon: {
    id: 'talon',
    name: 'Talon',
    blurb: 'Walkers. Packs of striders, spider walkers that take any slope, and Warhound heavy walkers from its mech forge. Super unit: the Juggernaut.',
    caps: { infantry: 0.8, vehicle: 1.05 },
    production: {
      factory: {
        table: [
          { unit: 'strider', weight: 3, count: 3 },
          { unit: 'spider', weight: 3, count: 2 },
          { unit: 'warhound', weight: 0.7, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechForge: {
        table: [
          { unit: 'warhound', weight: 2, count: 1 },
          { unit: 'spider', weight: 1, count: 3 },
        ],
      },
      mechbay: { table: [{ unit: 'juggernaut', weight: 1, count: 1 }] },
    },
    signature: 'mechForge',
    waves: [rifleSquad(4, 3), { unit: 'strider', weight: 3, count: 3 }, { unit: 'spider', weight: 2, count: 2 }, { unit: 'warhound', weight: 1, count: 1 }],
  },
  tidewater: {
    id: 'tidewater',
    name: 'Tidewater',
    blurb: 'Hovers and boats. Skimmer hover tanks and amphibious transports, missile boats from a dock on the coast (a hover pad if its base has none). Weaker on dry maps. Super unit: the Hover Fortress.',
    caps: { infantry: 0.8, vehicle: 1.35 },
    production: {
      factory: {
        table: [
          { unit: 'skimmer', weight: 3, count: 2 },
          { unit: 'tank', weight: 2.5, count: 1 },
          { unit: 'amphib', weight: 1.5, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      // Boats launch from the dock's door into the water; a dock with no water at its door builds skimmers.
      dock: {
        table: [
          { unit: 'missileBoat', weight: 2, count: 2, ifDry: 'skimmer' },
          { unit: 'skimmer', weight: 1, count: 2 },
        ],
        interval: 28,
      },
      hoverPad: { table: [{ unit: 'skimmer', weight: 1, count: 2 }], interval: 30 },
      mechbay: { table: [{ unit: 'hoverFortress', weight: 1, count: 1 }] },
    },
    signature: 'dock',
    inland: 'hoverPad',
    waves: [rifleSquad(4, 4), { unit: 'skimmer', weight: 3, count: 2 }, { unit: 'tank', weight: 1.5, count: 1 }, { unit: 'amphib', weight: 1, count: 1 }],
  },
  firestorm: {
    id: 'firestorm',
    name: 'Firestorm',
    blurb: 'Flamethrowers. Flame troopers in the squads, scorch buggies from its fuel depot (which blows up when destroyed), cinder walkers and light tanks. Best in towns. Super unit: the Inferno Walker.',
    caps: { infantry: 1.25, vehicle: 1.2 },
    production: {
      barracks: {
        table: [
          rifleSquad(4, 2),
          { unit: 'flameTrooper', weight: 2, count: 3, with: { unit: 'atTrooper', count: 1 } },
        ],
      },
      factory: {
        table: [
          { unit: 'cinderWalker', weight: 2.5, count: 1 },
          { unit: 'lightTank', weight: 2, count: 1 },
          { unit: 'scorchBuggy', weight: 1, count: 2 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      fuelDepot: { table: [{ unit: 'scorchBuggy', weight: 1, count: 2 }], interval: 30 },
      mechbay: { table: [{ unit: 'inferno', weight: 1, count: 1 }] },
    },
    signature: 'fuelDepot',
    waves: [rifleSquad(4, 3), { unit: 'flameTrooper', weight: 2, count: 3, with: { unit: 'atTrooper', count: 1 } }, { unit: 'cinderWalker', weight: 1.5, count: 1 }, { unit: 'scorchBuggy', weight: 1.5, count: 2 }],
  },
};

/** Doctrines in the order the setup screen lists them; the order of the design notes, and of the faction slots. */
export const DOCTRINE_IDS: DoctrineId[] = ['armour', 'raiders', 'legion', 'bastion', 'talon', 'skyline', 'tidewater', 'firestorm'];

/**
 * Each faction slot's default doctrine, in faction order (see FACTIONS):
 * Cobalt Armour, Crimson Raiders, Ashen Legion, Gilded Bastion, Violet
 * Talon, Ivory Skyline, Teal Tidewater, Ember Firestorm.
 */
export function defaultDoctrine(i: number): DoctrineId {
  return DOCTRINE_IDS[i % DOCTRINE_IDS.length];
}

export function isDoctrine(v: unknown): v is DoctrineId {
  return typeof v === 'string' && v in DOCTRINES;
}

/** The units a doctrine can field, for checks and the stats table. */
export function doctrineUnits(d: DoctrineDef): UnitId[] {
  const out = new Set<UnitId>();
  for (const p of Object.values(d.production)) for (const e of p!.table) {
    out.add(e.unit);
    if (e.with) out.add(e.with.unit);
    if (e.ifDry) out.add(e.ifDry);
  }
  return [...out];
}

/** A side's doctrine (the civilian town and garrisons have none, and get armour's defaults). */
export function doctrineOf(ctx: SimContext, faction: number): DoctrineDef {
  return DOCTRINES[ctx.settings.factions[faction]?.doctrine ?? 'armour'];
}

/** What a production building turns out for a side: its doctrine's table, or the building's own. */
export function productionFor(ctx: SimContext, def: BuildingDef, faction: number): { table: ProductionEntry[]; interval: number } | undefined {
  if (!def.production) return undefined;
  const override = faction >= 0 ? doctrineOf(ctx, faction).production[def.id as BuildingId] : undefined;
  return { table: override?.table ?? def.production.table, interval: override?.interval ?? def.production.interval };
}
