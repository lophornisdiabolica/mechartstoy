/**
 * The overall look of a map: ground and water colours, the scenery, and the
 * style towns are built in. A biome is looks and scenery only; it doesn't
 * change how fast anything moves (snow included: slow units struggle enough
 * already). A new biome is a new entry here plus, if it wants them, new
 * prop kinds (props.ts and propsMesh.ts) and a town style (models/buildings.ts).
 */
export type BiomeId = 'temperate' | 'desert' | 'snow' | 'forest';

/** Scenery the props scatter can place (see props.ts). */
export type PropKind = 'tree' | 'pine' | 'snowPine' | 'cactus' | 'shrub' | 'deadTree' | 'rock';

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
  /** How civilian buildings look (see the town styles in models/buildings.ts). */
  town: TownStyle;
}

export type TownStyle = 'brick' | 'adobe' | 'alpine' | 'timber';

export const BIOMES: Record<BiomeId, BiomeDef> = {
  temperate: {
    id: 'temperate',
    label: 'Temperate',
    ground: { shore: 0xd8c690, low: 0x7fa35a, high: 0x5e8446, rock: 0x8a8378, pad: 0x9b9a86 },
    water: 0x3f7fa8,
    sky: 0x9fb4c4,
    props: { density: 35, gentle: { tree: 82, rock: 18 }, steep: { rock: 1 } },
    town: 'brick',
  },
  desert: {
    id: 'desert',
    label: 'Desert',
    ground: { shore: 0xe6d3a0, low: 0xdcb878, high: 0xc29560, rock: 0xa47a58, pad: 0xb3a48a },
    water: 0x3a92a0,
    sky: 0xd4c4a8,
    props: { density: 30, gentle: { cactus: 40, shrub: 35, deadTree: 8, rock: 30 }, steep: { rock: 1 } },
    town: 'adobe',
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    ground: { shore: 0xbfc4c4, low: 0xeef2f4, high: 0xd6dee6, rock: 0x7f858c, pad: 0xa9adb0 },
    water: 0x46708c,
    sky: 0xc4ced8,
    props: { density: 50, gentle: { snowPine: 70, deadTree: 6, rock: 24 }, steep: { rock: 1 } },
    town: 'alpine',
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    ground: { shore: 0xc9bb88, low: 0x5f8d47, high: 0x426c37, rock: 0x7b776c, pad: 0x8f8f7c },
    water: 0x3a6e88,
    sky: 0x93a9b2,
    props: { density: 120, gentle: { pine: 55, tree: 38, rock: 7 }, steep: { pine: 1, rock: 2 } },
    town: 'timber',
  },
};

export const BIOME_IDS = Object.keys(BIOMES) as BiomeId[];

export function isBiome(id: string): id is BiomeId {
  return id in BIOMES;
}
