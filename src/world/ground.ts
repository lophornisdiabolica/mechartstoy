import { MoveClass } from './moveClasses';

/**
 * What covers the ground in each map cell, on top of its height and the
 * biome's look. Most of the map is plain ground; the other kinds change how
 * hard it is to get across, and can change during a battle (see
 * Battlefield.paint): scrap piling up where wrecks fall, a road or a dense
 * thicket laid down by map generation or, later, by engineers.
 *
 * Each kind is data: a route cost and a speed per movement class (1 for any
 * class not listed), and a colour the terrain mesh blends in. A new kind is a
 * new entry here.
 */
export type GroundId = 'plain' | 'road' | 'scrap' | 'thicket' | 'trench' | 'earth' | 'felled' | 'oil' | 'paving' | 'apron';

export interface GroundDef {
  id: GroundId;
  label: string;
  /** Route cost multiplier per movement class (see MoveRules), on top of slopes, water and towns. */
  cost: Partial<Record<MoveClass, number>>;
  /** Speed multiplier per movement class while on it. */
  speed: Partial<Record<MoveClass, number>>;
  /** Colour blended into the terrain, and how strongly (0 leaves the biome's colour alone). */
  color: number;
  tint: number;
}

export const GROUND_DEFS: Record<GroundId, GroundDef> = {
  plain: { id: 'plain', label: 'Open ground', cost: {}, speed: {}, color: 0x000000, tint: 0 },
  /** Packed roads: wheels and tracks take them a little faster; feet and legs don't care. */
  road: { id: 'road', label: 'Road', cost: { tracked: 0.8, amphibious: 0.8, hover: 0.8 }, speed: { tracked: 1.15, amphibious: 1.15 }, color: 0x8b8578, tint: 0.6 },
  /**
   * Twisted metal from wrecked vehicles and rubble: a slog for tracks and
   * hovers, awkward on foot, and easy for long legs.
   */
  scrap: {
    id: 'scrap',
    label: 'Scrap',
    cost: { tracked: 3, amphibious: 3, hover: 4, foot: 1.4, walker: 1.3, climber: 1 },
    speed: { tracked: 0.55, amphibious: 0.55, hover: 0.5, foot: 0.8, walker: 0.85 },
    color: 0x5d5853,
    tint: 0.75,
  },
  /**
   * Dense forest (see woods.ts). Vehicles push through slowly, knocking the
   * trees flat, so routes go round it where they can; infantry and spiders
   * slip between the trunks.
   */
  thicket: {
    id: 'thicket',
    label: 'Dense forest',
    cost: { tracked: 4, amphibious: 4, hover: 4, walker: 2.5, foot: 1.1, climber: 1.1 },
    speed: { tracked: 0.5, amphibious: 0.5, hover: 0.5, walker: 0.7, foot: 0.9 },
    color: 0x3c5a2c,
    tint: 0.5,
  },
  /**
   * A trench Legion's engineers dug (see commander/engineers.ts): a narrow
   * cut that infantry stand in, firing over the berm in front, and that
   * wheels and tracks lurch across.
   */
  trench: {
    id: 'trench',
    label: 'Trench',
    cost: { tracked: 2.5, amphibious: 2.5, hover: 2.5, walker: 1.2 },
    speed: { tracked: 0.6, amphibious: 0.6, hover: 0.6, walker: 0.9 },
    color: 0x463224,
    tint: 0.85,
  },
  /** Fresh-heaped earth: a berm in front of a trench. Loose going for wheels and tracks. */
  earth: {
    id: 'earth',
    label: 'Earth berm',
    cost: { tracked: 1.4, amphibious: 1.4, hover: 1.4 },
    speed: { tracked: 0.85, amphibious: 0.85, hover: 0.85 },
    color: 0x8f6c45,
    tint: 0.75,
  },
  /**
   * Dense forest that's been knocked down: a tangle of fallen trunks, still
   * rougher going than open ground for wheels and tracks, however much it's
   * driven over (the trunks only sink part way: see Woods.trample).
   */
  felled: {
    id: 'felled',
    label: 'Fallen forest',
    cost: { tracked: 1.6, amphibious: 1.6, hover: 1.8, walker: 1.15, foot: 1.05 },
    speed: { tracked: 0.8, amphibious: 0.8, hover: 0.75, walker: 0.95 },
    color: 0x4f4a30,
    tint: 0.45,
  },
  /**
   * An oil field's pool of crude (see game/traits.ts): slick going for wheels
   * and tracks, and it goes up in flames when something bursts on it.
   */
  oil: {
    id: 'oil',
    label: 'Oil pool',
    cost: { tracked: 1.5, amphibious: 1.5, hover: 1.2, foot: 1.2, walker: 1.1 },
    speed: { tracked: 0.8, amphibious: 0.8, foot: 0.85, walker: 0.9 },
    color: 0x141210,
    tint: 0.9,
  },
  /**
   * Ancient ruins' old paving, among the columns and broken walls: soldiers
   * crouched in the rubble take half a burst that lands outside it (like a
   * trench, see systems/projectiles.ts).
   */
  paving: {
    id: 'paving',
    label: 'Ruins',
    cost: {},
    speed: {},
    color: 0xb3a990,
    tint: 0.7,
  },
  /** A landing field's concrete apron (see world/traits.ts): plain going, just paved. */
  apron: {
    id: 'apron',
    label: 'Apron',
    cost: {},
    speed: {},
    color: 0x9a9890,
    tint: 0.8,
  },
};

/** Ground kinds by their code in Battlefield.ground (the order is fixed: codes are stored per cell). */
export const GROUND_IDS: GroundId[] = ['plain', 'road', 'scrap', 'thicket', 'trench', 'earth', 'felled', 'oil', 'paving', 'apron'];

export function groundCode(id: GroundId): number {
  return GROUND_IDS.indexOf(id);
}

/** A rectangle of map cells (inclusive), as changes report it. */
export interface CellArea {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}
