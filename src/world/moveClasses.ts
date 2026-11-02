/**
 * How each kind of unit gets around. Every unit has a movement class; the
 * nav grid for a class (see NavGrid) and the movement system read these
 * rules, so a new kind of mover is a new entry here.
 */
export type MoveClass = 'foot' | 'tracked' | 'walker' | 'hover' | 'amphibious' | 'naval' | 'air';

export interface MoveRules {
  /** Deepest water (below sea level) it can enter: 0 keeps it on dry land, Infinity lets it go anywhere wet. */
  maxDepth: number;
  /** Boats: dry land (and water shallower than this) is off limits. 0 for everything else. */
  minDepth: number;
  /** Route cost multiplier on steep ground; Infinity means it can't climb it at all. */
  steep: number;
  /** Route cost multiplier inside towns and outposts (below 1 means it prefers them). */
  town: number;
  /** Route cost multiplier, and speed multiplier, in water it's allowed into. */
  waterCost: number;
  waterSpeed: number;
  /** Flies over everything: no routes, no terrain, no buildings in the way. */
  flies: boolean;
  /** Height above the ground or water surface it moves at. */
  altitude: number;
}

/** Slope above which ground counts as steep (see MoveRules.steep). */
export const STEEP_SLOPE = 0.7;

const land: MoveRules = { maxDepth: 0, minDepth: 0, steep: 3, town: 1, waterCost: 1, waterSpeed: 1, flies: false, altitude: 0 };

export const MOVE_RULES: Record<MoveClass, MoveRules> = {
  /** Infantry: happy on slopes, and prefer moving through towns and outposts, where there's cover. */
  foot: { ...land, steep: 1.6, town: 0.5 },
  /** Tanks and trucks: the baseline. Slopes are slow going and towns are cramped, so they go round them. */
  tracked: { ...land, steep: 3, town: 1.8 },
  /** Mechs: long legs take slopes in stride and wade through shallow water, but big ones keep out of towns. */
  walker: { ...land, maxDepth: 0.6, steep: 1.4, town: 1.8, waterCost: 2, waterSpeed: 0.6 },
  /** Hovercraft: skim water as easily as land, but can't climb steep ground. */
  hover: { ...land, maxDepth: Infinity, steep: Infinity, town: 1.5, waterSpeed: 1.1 },
  /** Amphibious vehicles: drive on land, swim slowly. */
  amphibious: { ...land, maxDepth: Infinity, town: 1.8, waterCost: 2, waterSpeed: 0.5 },
  /** Boats: water only, and not the shallowest of it. */
  naval: { ...land, maxDepth: Infinity, minDepth: 0.2, steep: 1, town: 1 },
  /** Aircraft: fly straight over everything. */
  air: { ...land, maxDepth: Infinity, steep: 1, flies: true, altitude: 6 },
};

/** Whether a mover of this class can be at a spot with this water depth (depth <= 0 is dry land) and slope. */
export function terrainAllows(rules: MoveRules, depth: number, slope: number): boolean {
  if (rules.flies) return true;
  if (depth > rules.maxDepth) return false;
  if (rules.minDepth > 0 && depth < rules.minDepth) return false;
  if (depth <= 0 && slope > STEEP_SLOPE && rules.steep === Infinity) return false;
  return true;
}
