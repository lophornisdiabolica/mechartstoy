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
 * Every doctrine shares a core: rifle squads with an AT trooper, a heavy unit
 * that can stand up to super units and buildings, the HQ and towers.
 */
export type DoctrineId = 'armour' | 'raiders' | 'legion';

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
  /** Eternal-mode reinforcement waves for a side with no production left. */
  waves: ProductionEntry[];
}

const rifleSquad = (riflemen: number, weight = 1, at = 1): ProductionEntry => ({ unit: 'trooper', weight, count: riflemen, with: { unit: 'atTrooper', count: at } });

export const DOCTRINES: Record<DoctrineId, DoctrineDef> = {
  armour: {
    id: 'armour',
    name: 'Armour',
    blurb: 'Heavy tanks. Fewer infantry, more vehicles, and the Lancer heavy tank from its tank depot. Super unit: the Titan.',
    caps: { infantry: 0.8, vehicle: 1.2 },
    production: {
      factory: {
        table: [
          { unit: 'tank', weight: 3, count: 1 },
          { unit: 'strider', weight: 2, count: 2 },
          { unit: 'howitzer', weight: 1.2, count: 1 },
        ],
      },
      tankDepot: { table: [{ unit: 'lancer', weight: 1, count: 1 }], interval: 60 },
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
    caps: { infantry: 1.8, vehicle: 0.8 },
    production: {
      // Big squads with two AT troopers each: the Legion's answer to armour is many rockets.
      barracks: { table: [rifleSquad(4, 3, 2), { unit: 'mortar', weight: 1, count: 2 }], interval: 12 },
      barracksBlock: { table: [rifleSquad(5, 2, 2), { unit: 'mortar', weight: 1, count: 3 }], interval: 14 },
      factory: {
        table: [
          { unit: 'carrier', weight: 2, count: 1 },
          { unit: 'lightTank', weight: 2, count: 1 },
        ],
      },
      mechbay: { table: [{ unit: 'siegeCrawler', weight: 1, count: 1 }] },
    },
    signature: 'barracksBlock',
    waves: [rifleSquad(5, 5), { unit: 'mortar', weight: 1.5, count: 2 }, { unit: 'carrier', weight: 1.5, count: 1 }, { unit: 'lightTank', weight: 1.5, count: 1 }],
  },
};

/** Doctrines in the order the setup screen lists them; the order of the design notes. */
export const DOCTRINE_IDS: DoctrineId[] = ['armour', 'raiders', 'legion'];

/**
 * The default doctrine for faction slot `i`: Cobalt armour, Crimson raiders,
 * Ashen legion. Slots whose own doctrine isn't built yet cycle through these.
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
