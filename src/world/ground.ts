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
export type GroundId = 'plain' | 'road' | 'scrap' | 'thicket';

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
   * Dense forest. Vehicles push through slowly; infantry and spiders slip
   * between the trunks. (Trees that block shots and get knocked flat come
   * with destructible props, later.)
   */
  thicket: {
    id: 'thicket',
    label: 'Dense forest',
    cost: { tracked: 3, amphibious: 3, hover: 3, walker: 2, foot: 1.1, climber: 1.1 },
    speed: { tracked: 0.5, amphibious: 0.5, hover: 0.5, walker: 0.7, foot: 0.9 },
    color: 0x3c5a2c,
    tint: 0.5,
  },
};

/** Ground kinds by their code in Battlefield.ground (the order is fixed: codes are stored per cell). */
export const GROUND_IDS: GroundId[] = ['plain', 'road', 'scrap', 'thicket'];

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
