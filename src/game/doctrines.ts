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
export type DoctrineId = 'armour' | 'raiders' | 'legion' | 'bastion' | 'talon' | 'skyline' | 'tidewater' | 'firestorm' | 'aegis' | 'rime' | 'sabre' | 'cipher' | 'bastionSpider';

export interface DoctrineDef {
  id: DoctrineId;
  name: string;
  /** One line for the setup screen. */
  blurb: string;
  /** Multipliers on the settings' unit caps (missing categories are 1). */
  caps: Partial<Record<UnitCategory, number>>;
  /**
   * What each production building turns out, replacing its default table.
   * A `flagship` is a super unit the building also builds, on its own slow
   * timer (Tidewater's Dreadnought at the dock). A naval one doesn't take the
   * super cap from the mech bay's: it has a berth of its own (see caps.ts).
   */
  production: Partial<Record<BuildingId, { table: ProductionEntry[]; interval?: number; flagship?: { unit: UnitId; interval: number } }>>;
  /** Built in the base alongside the HQ, barracks, factory and mech bay. */
  signature: BuildingId;
  /** Built instead of a coastal signature building (see BuildingDef.coastal) when the base has no coast. */
  inland?: BuildingId;
  /** Guard towers on top of the usual three. */
  extraTowers?: number;
  /** Eternal-mode reinforcement waves for a side with no production left. */
  waves: ProductionEntry[];
  /**
   * Units that spot for this doctrine's long-range guns, and how far round
   * them (see UnitDef.spots, which works for every doctrine).
   */
  spotters?: Partial<Record<UnitId, number>>;
  /**
   * A variant to try out, off by default: it's in the side's doctrine list
   * under "Test", but never in the variety pool, the sims' doctrine sweeps or
   * a faction's default. It wears the colours of the doctrine it varies.
   */
  testOf?: DoctrineId;
}

const rifleSquad = (riflemen: number, weight = 1, at = 1): ProductionEntry => ({ unit: 'trooper', weight, count: riflemen, with: { unit: 'atTrooper', count: at } });

const CANONICAL: Record<Exclude<DoctrineId, 'bastionSpider'>, DoctrineDef> = {
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
          { unit: 'buggy', weight: 1, count: 2 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
        interval: 14,
      },
      motorPool: {
        table: [
          { unit: 'mgTruck', weight: 2, count: 2 },
          { unit: 'rocketTruck', weight: 0.5, count: 1 },
          { unit: 'buggy', weight: 1.5, count: 2 },
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
    blurb: 'Infantry masses. Bigger squads, mortar teams, squad carriers and light tanks, with a barracks block. Its engineers dig trenches behind earth berms for the squads to hold. Super unit: the Siege Crawler, which drops off squads as it goes.',
    caps: { infantry: 1.9, vehicle: 0.8 },
    production: {
      // Big squads with two AT troopers each: the Legion's answer to armour is many rockets.
      barracks: { table: [rifleSquad(4, 3, 2), { unit: 'mortar', weight: 1.6, count: 2 }], interval: 10.5 },
      barracksBlock: { table: [rifleSquad(5, 2, 2), { unit: 'mortar', weight: 1.6, count: 3 }], interval: 12 },
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
    blurb: 'Aircraft. Gunships, bombers, strike jets and scout copters from its airpad, which they fly back to to rearm, flak walkers on the ground, a bigger air cap and fewer of everything else. Super unit: the Airship Carrier, which launches drones.',
    caps: { infantry: 0.8, vehicle: 1.1, air: 2.5 },
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
          { unit: 'jet', weight: 1.2, count: 2 },
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
    blurb: 'Artillery and fortresses. Howitzers and railgun batteries that outrange everything else, a sensor mast that spots for them, comms arrays its engineers put up at the front, and extra guard towers. Super unit: the Fortress Walker, which spots for the guns round it.',
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
        // Bastion has no second production building, so its factory works faster.
        interval: 16,
      },
      mechbay: { table: [{ unit: 'fortress', weight: 1, count: 1 }] },
    },
    signature: 'sensorMast',
    extraTowers: 2,
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 2, count: 1 }, { unit: 'howitzer', weight: 2, count: 1 }, { unit: 'railgun', weight: 1, count: 1 }],
    // Its scout copters fly ahead and call in the guns, like a little flying sensor mast.
    spotters: { scout: 14 },
  },
  talon: {
    id: 'talon',
    name: 'Talon',
    blurb: 'Walkers. Packs of striders, spider walkers that take any slope, and Warhound heavy walkers from its mech forge. Super unit: the Juggernaut.',
    caps: { infantry: 0.8, vehicle: 0.95 },
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
    blurb: 'Hovers and boats. Tanks with some Skimmer hover tanks and amphibious transports, and missile boats from a dock on the coast (a hover pad if its base has none). Its engineers add the missing hover pad or dock and dig canals that carry the boats further inland. Weaker on dry maps. Super units: the Hover Fortress from its mech bay, and the Dreadnought battleship from its dock.',
    caps: { infantry: 0.8, vehicle: 1.3 },
    production: {
      factory: {
        table: [
          { unit: 'tank', weight: 3.5, count: 1 },
          { unit: 'amphib', weight: 1, count: 1 },
          { unit: 'skimmer', weight: 1.5, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
        // Its vehicles come one at a time rather than in pairs of skimmers, so the factory works faster.
        interval: 12,
      },
      // Boats launch from the dock's door into the water, and only boats: skimmers come from a hover pad,
      // which engineers put up in a base that has a dock (see commander/engineers.ts).
      // The dock also lays down a Dreadnought now and then: a second super unit, beside the Hover Fortress.
      dock: { table: [{ unit: 'missileBoat', weight: 1, count: 2 }], interval: 22, flagship: { unit: 'dreadnought', interval: 80 } },
      hoverPad: { table: [{ unit: 'skimmer', weight: 1, count: 1 }, { unit: 'amphib', weight: 0.5, count: 1 }], interval: 26 },
      mechbay: { table: [{ unit: 'hoverFortress', weight: 1, count: 1 }] },
    },
    signature: 'dock',
    inland: 'hoverPad',
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 2, count: 1 }, { unit: 'amphib', weight: 1.5, count: 1 }, { unit: 'skimmer', weight: 1.5, count: 1 }],
  },
  firestorm: {
    id: 'firestorm',
    name: 'Firestorm',
    blurb: 'Flamethrowers. Flame troopers in the squads, scorch buggies from its fuel depot (which blows up when destroyed), cinder walkers and light tanks. Best in towns. Super unit: the Inferno Walker.',
    caps: { infantry: 1.15, vehicle: 1 },
    production: {
      barracks: {
        table: [
          rifleSquad(4, 2),
          { unit: 'flameTrooper', weight: 2, count: 3, with: { unit: 'atTrooper', count: 1 } },
        ],
      },
      factory: {
        table: [
          { unit: 'cinderWalker', weight: 2, count: 1 },
          { unit: 'lightTank', weight: 2.5, count: 1 },
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
  aegis: {
    id: 'aegis',
    name: 'Aegis',
    blurb: 'Energy domes. Dome trucks throw a shield over the tanks they follow, lance walkers bore through armour and drain enemy domes, and its shield works keeps a big dome over the base. Shots from inside go out, but shells lobbed over the top and flame fall straight through. Super unit: the Citadel, a walker under a dome of its own.',
    caps: { infantry: 0.9, vehicle: 1.2 },
    production: {
      factory: {
        table: [
          { unit: 'tank', weight: 3, count: 1 },
          { unit: 'lanceWalker', weight: 2, count: 1 },
          { unit: 'domeTruck', weight: 1.3, count: 1 },
          { unit: 'flakTank', weight: 1, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'citadel', weight: 1, count: 1 }] },
    },
    signature: 'shieldWorks',
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 2, count: 1 }, { unit: 'lanceWalker', weight: 2, count: 1 }, { unit: 'domeTruck', weight: 1, count: 1 }],
  },
  rime: {
    id: 'rime',
    name: 'Rime',
    blurb: 'Frost. Cryo troopers and freezer trucks lay frost that slows its enemies right down (water freezes too, so boats crawl), and shard tanks shatter whatever stands on it. Fire melts the frost. Its cryo plant keeps the ground round the base frozen. Super unit: the Glacier, a walker that freezes the ground it walks on.',
    caps: { infantry: 0.9, vehicle: 1.35 },
    production: {
      barracks: {
        table: [
          rifleSquad(4, 2),
          { unit: 'cryoTrooper', weight: 2, count: 3, with: { unit: 'atTrooper', count: 1 } },
        ],
      },
      factory: {
        table: [
          { unit: 'shardTank', weight: 3, count: 1 },
          { unit: 'freezerTruck', weight: 1.8, count: 1 },
          { unit: 'tank', weight: 1.2, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'glacier', weight: 1, count: 1 }] },
    },
    signature: 'cryoPlant',
    waves: [rifleSquad(4, 3), { unit: 'cryoTrooper', weight: 2, count: 3, with: { unit: 'atTrooper', count: 1 } }, { unit: 'shardTank', weight: 2, count: 1 }, { unit: 'freezerTruck', weight: 1.5, count: 1 }],
  },
  sabre: {
    id: 'sabre',
    name: 'Sabre',
    blurb: 'Blade mechs. Packs of little duelists (two to a vehicle slot) in place of most of its infantry, and Reavers, heavy tanks whose turret is a great axe arm, all fighting hand to hand, with a gun each for what they can\'t reach. They charge what they can see and close to contact. Its duel hall turns out more duelists. Super unit: the Colossus, which hammers everything round it flying.',
    caps: { infantry: 0.55, vehicle: 1.25 },
    production: {
      barracks: { table: [rifleSquad(3, 1)], interval: 20 },
      factory: {
        table: [
          { unit: 'duelist', weight: 3, count: 3 },
          { unit: 'reaver', weight: 2, count: 1 },
          { unit: 'flakTank', weight: 1, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'colossus', weight: 1, count: 1 }] },
    },
    signature: 'duelHall',
    waves: [rifleSquad(3, 2), { unit: 'duelist', weight: 3, count: 3 }, { unit: 'reaver', weight: 1.5, count: 1 }],
  },
  cipher: {
    id: 'cipher',
    name: 'Cipher',
    blurb: 'Hacking. Hack vans lock on to an enemy vehicle and turn it to Cipher\'s side for a few seconds: it stops dead and fights whatever is round it, its old friends included, then comes back to itself and can\'t be turned again for a while. Drone operators in its squads, and the Overmind, send up drones that hunt infantry, and jammer walkers send out pulses that slow the enemy guns they reach. Its uplink mast turns out more and jams what comes at the base. Infantry and super units can\'t be hacked. Super unit: the Overmind, a walker with a hack array and a rack of drones on its back.',
    caps: { infantry: 1, vehicle: 1.1, air: 2.5 },
    production: {
      barracks: { table: [rifleSquad(4, 3), { unit: 'droneOperator', weight: 1.5, count: 2 }] },
      factory: {
        table: [
          { unit: 'tank', weight: 3, count: 1 },
          { unit: 'hackVan', weight: 1.5, count: 1 },
          { unit: 'jammer', weight: 1.2, count: 1 },
          { unit: 'flakTank', weight: 0.8, count: 1 },
          { unit: 'scout', weight: 0.8, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'overmind', weight: 1, count: 1 }] },
    },
    signature: 'uplinkMast',
    waves: [rifleSquad(4, 4), { unit: 'tank', weight: 2, count: 1 }, { unit: 'droneOperator', weight: 1, count: 2 }, { unit: 'hackVan', weight: 1, count: 1 }, { unit: 'jammer', weight: 1, count: 1 }],
  },
};

/**
 * Bastion with a Siege Spider in its mech bay instead of the Fortress Walker:
 * a giant eight-legged howitzer that out-ranges everything and climbs over
 * buildings, but hangs back with the guns instead of soaking up fire at the front.
 */
export const DOCTRINES: Record<DoctrineId, DoctrineDef> = { ...CANONICAL, bastionSpider: {
  ...CANONICAL.bastion,
  id: 'bastionSpider',
  name: 'Bastion (spider test)',
  blurb: 'Bastion with a different super unit, to try out: the Siege Spider, a giant eight-legged howitzer that spots for itself and climbs over buildings, instead of the Fortress Walker.',
  production: { ...CANONICAL.bastion.production, mechbay: { table: [{ unit: 'siegeSpider', weight: 1, count: 1 }] } },
  testOf: 'bastion',
} };

/** Doctrines in the order the setup screen lists them; the order of the design notes, and of the faction slots. */
export const DOCTRINE_IDS: DoctrineId[] = ['armour', 'raiders', 'legion', 'bastion', 'talon', 'skyline', 'tidewater', 'firestorm', 'aegis', 'rime', 'sabre', 'cipher'];

/** Variants to try out (see DoctrineDef.testOf): pickable per side, but nowhere by default. */
export const TEST_DOCTRINE_IDS: DoctrineId[] = ['bastionSpider'];

/** Every doctrine, test variants last: for reports that list whatever was played. */
export const ALL_DOCTRINE_IDS: DoctrineId[] = [...DOCTRINE_IDS, ...TEST_DOCTRINE_IDS];

/** The doctrine a test variant varies (itself for the rest), whose faction colours and name it wears. */
export function canonicalDoctrine(id: DoctrineId): DoctrineId {
  return DOCTRINES[id].testOf ?? id;
}

/**
 * Each faction slot's default doctrine, in faction order (see FACTIONS):
 * Cobalt Armour, Crimson Raiders, Ashen Legion, Gilded Bastion, Violet
 * Talon, Ivory Skyline, Teal Tidewater, Ember Firestorm (and, past the
 * eight faction slots a battle has, Verdant Aegis, Celeste Rime and Onyx Sabre, who wear
 * their own colours when re-rolled or picked).
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
  for (const p of Object.values(d.production)) if (p!.flagship) out.add(p!.flagship.unit);
  return [...out];
}

/** A side's doctrine (the civilian town and garrisons have none, and get armour's defaults). */
export function doctrineOf(ctx: SimContext, faction: number): DoctrineDef {
  return DOCTRINES[ctx.settings.factions[faction]?.doctrine ?? 'armour'];
}

/** What a production building turns out for a side: its doctrine's table, or the building's own. */
export function productionFor(ctx: SimContext, def: BuildingDef, faction: number): { table: ProductionEntry[]; interval: number; flagship?: { unit: UnitId; interval: number } } | undefined {
  if (!def.production) return undefined;
  const override = faction >= 0 ? doctrineOf(ctx, faction).production[def.id as BuildingId] : undefined;
  return { table: override?.table ?? def.production.table, interval: override?.interval ?? def.production.interval, flagship: override?.flagship };
}
