/**
 * The overall look of a map: ground and water colours, the scenery, and the
 * style towns are built in. A biome is looks and scenery only; it doesn't
 * change how fast anything moves (snow included: slow units struggle enough
 * already). A new biome is a new entry here plus, if it wants them, new
 * prop kinds (props.ts and propsMesh.ts) and a town style (models/buildings.ts).
 */
export type BiomeId = 'temperate' | 'desert' | 'snow' | 'forest' | 'jungle' | 'steppe' | 'tundra' | 'ash' | 'scrap' | 'crystal';

/** Scenery the props scatter can place (see props.ts). */
export type PropKind = 'tree' | 'pine' | 'snowPine' | 'cactus' | 'shrub' | 'deadTree' | 'rock' | 'crystal' | 'junk';

export interface BiomeDef {
  id: BiomeId;
  label: string;
  ground: {
    /** Shoreline and beaches. */
    shore: number;
    /** Low ground, fading to `high` toward the hilltops. */
    low: number;
    high: number;
    /** Steep slopes. */
    rock: number;
    /** Base pads. */
    pad: number;
  };
  water: number;
  /** Sky and fog colour behind the board. */
  sky: number;
  /**
   * Scenery: how many props per 1000 square units of map, and the mix on
   * gentle ground and on steep ground (weights).
   */
  props: { density: number; gentle: Partial<Record<PropKind, number>>; steep: Partial<Record<PropKind, number>> };
  /** How civilian buildings look (see the town styles in models/buildings.ts), unless the map's settings choose another. */
  town: TownStyle;
  /** Dense forest's trees (see woods.ts and render/woodsMesh.ts): their shape and tint. */
  woods: { plant: 'tree' | 'pine' | 'snowPine' | 'cactus' | 'jungle' | 'monolith'; tint: number };
}

export type TownStyle = 'brick' | 'adobe' | 'alpine' | 'timber' | 'concrete' | 'thatch' | 'shanty' | 'yurt' | 'dome';

/** The town styles, by name, for the setup screen (see models/buildings.ts for how each looks). */
export const TOWN_STYLES: Record<TownStyle, { label: string; blurb: string }> = {
  brick: { label: 'Brick', blurb: 'Brick and render houses under tiled gables, flat-roofed blocks of flats' },
  adobe: { label: 'Adobe', blurb: 'Flat-roofed mud-brick houses, stepped terraces and minarets' },
  alpine: { label: 'Alpine', blurb: 'Dark timber chalets under steep, snowy roofs' },
  timber: { label: 'Timber', blurb: 'Timber-framed halls under mossy roofs' },
  concrete: { label: 'Concrete', blurb: 'Grey concrete blocks and flat roofs' },
  thatch: { label: 'Thatch', blurb: 'Houses on stilts under deep thatched roofs' },
  shanty: { label: 'Shanty', blurb: 'Patched-together shacks under rusty sheet roofs' },
  yurt: { label: 'Yurts', blurb: 'Round felt tents and timber halls' },
  dome: { label: 'Domes', blurb: 'White domed habitats and towers' },
};

export const TOWN_STYLE_IDS = Object.keys(TOWN_STYLES) as TownStyle[];

export function isTownStyle(id: string): id is TownStyle {
  return id in TOWN_STYLES;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  temperate: {
    id: 'temperate',
    label: 'Temperate',
    ground: { shore: 0xd8c690, low: 0x7fa35a, high: 0x5e8446, rock: 0x8a8378, pad: 0x9b9a86 },
    water: 0x3f7fa8,
    sky: 0x9fb4c4,
    props: { density: 35, gentle: { tree: 82, rock: 18 }, steep: { rock: 1 } },
    town: 'brick',
    woods: { plant: 'pine', tint: 0xc8d2c0 },
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    ground: { shore: 0xe6d3a0, low: 0xdcb878, high: 0xc29560, rock: 0xa47a58, pad: 0xb3a48a },
    water: 0x3a92a0,
    sky: 0xd4c4a8,
    props: { density: 30, gentle: { cactus: 40, shrub: 35, deadTree: 8, rock: 30 }, steep: { rock: 1 } },
    town: 'adobe',
    woods: { plant: 'cactus', tint: 0x5f8a4a },
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    ground: { shore: 0xbfc4c4, low: 0xeef2f4, high: 0xd6dee6, rock: 0x7f858c, pad: 0xa9adb0 },
    water: 0x46708c,
    sky: 0xc4ced8,
    props: { density: 50, gentle: { snowPine: 70, deadTree: 6, rock: 24 }, steep: { rock: 1 } },
    town: 'alpine',
    woods: { plant: 'snowPine', tint: 0xc8d2c0 },
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    ground: { shore: 0xc9bb88, low: 0x5f8d47, high: 0x426c37, rock: 0x7b776c, pad: 0x8f8f7c },
    water: 0x3a6e88,
    sky: 0x93a9b2,
    props: { density: 120, gentle: { pine: 55, tree: 38, rock: 7 }, steep: { pine: 1, rock: 2 } },
    town: 'timber',
    woods: { plant: 'pine', tint: 0xc8d2c0 },
  },
  jungle: {
    id: 'jungle',
    label: 'Jungle',
    ground: { shore: 0xcdbb7e, low: 0x467e3a, high: 0x33642e, rock: 0x6e7262, pad: 0x8a8f78 },
    water: 0x2f7f80,
    sky: 0x8fb0a0,
    props: { density: 150, gentle: { tree: 62, shrub: 32, rock: 6 }, steep: { tree: 1, rock: 2 } },
    town: 'thatch',
    woods: { plant: 'jungle', tint: 0xd2dcc8 },
  },
  steppe: {
    id: 'steppe',
    label: 'Steppe',
    ground: { shore: 0xd2c08a, low: 0xa9a774, high: 0x908f62, rock: 0x8f8670, pad: 0xa8a28a },
    water: 0x4a88a0,
    sky: 0xc4c8b8,
    props: { density: 16, gentle: { shrub: 60, rock: 28, tree: 12 }, steep: { rock: 1 } },
    town: 'yurt',
    woods: { plant: 'tree', tint: 0x5c6a42 },
  },
  tundra: {
    id: 'tundra',
    label: 'Tundra',
    ground: { shore: 0xa8a89a, low: 0x9aa58a, high: 0xbcc0b4, rock: 0x76787a, pad: 0xa0a29a },
    water: 0x4c6e86,
    sky: 0xb8c4cc,
    props: { density: 24, gentle: { shrub: 45, rock: 40, snowPine: 15 }, steep: { rock: 1 } },
    town: 'concrete',
    woods: { plant: 'snowPine', tint: 0xb4bcb0 },
  },
  ash: {
    id: 'ash',
    label: 'Ash wastes',
    ground: { shore: 0x6b6660, low: 0x5c5853, high: 0x4b4744, rock: 0x3a3634, pad: 0x77726a },
    water: 0x4a5a5e,
    sky: 0x9a948c,
    props: { density: 22, gentle: { deadTree: 45, rock: 40, junk: 15 }, steep: { rock: 1 } },
    town: 'shanty',
    woods: { plant: 'pine', tint: 0x6a6a5c },
  },
  scrap: {
    id: 'scrap',
    label: 'Scrapland',
    ground: { shore: 0xa89878, low: 0x8a7a62, high: 0x76684f, rock: 0x6a5a4a, pad: 0x9a9080 },
    water: 0x51706a,
    sky: 0xb8a890,
    props: { density: 30, gentle: { junk: 55, rock: 25, shrub: 20 }, steep: { rock: 3, junk: 1 } },
    town: 'shanty',
    woods: { plant: 'tree', tint: 0x6a7040 },
  },
  crystal: {
    id: 'crystal',
    label: 'Crystal fields',
    ground: { shore: 0xc8bcd8, low: 0x8a86a8, high: 0x75709a, rock: 0x5e5a7a, pad: 0x9a98aa },
    water: 0x4a6ac0,
    sky: 0xb4b0cc,
    props: { density: 28, gentle: { crystal: 50, rock: 35, shrub: 15 }, steep: { rock: 2, crystal: 1 } },
    town: 'dome',
    woods: { plant: 'monolith', tint: 0xa8b4e0 },
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export function isBiome(id: string): id is BiomeId {
  return id in BIOMES;
}
