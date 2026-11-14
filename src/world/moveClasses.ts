/**
 * How each kind of unit gets around. Every unit has a movement class; the
 * nav grid for a class (see NavGrid) and the movement system read these
 * rules, so a new kind of mover is a new entry here.
 */
export type MoveClass = 'foot' | 'tracked' | 'walker' | 'climber' | 'hover' | 'amphibious' | 'naval' | 'air';

export interface MoveRules {
  /** Deepest water (below sea level) it can enter: 0 keeps it on dry land, Infinity lets it go anywhere wet. */
  maxDepth: number;
  /** Boats: dry land (and water shallower than this) is off limits. 0 for everything else. */
  minDepth: number;
  /** Route cost multiplier on steep ground; Infinity means it can't climb it at all. */
  steep: number;
  /** Route cost multiplier inside towns and outposts (below 1 means it prefers them). */
  town: number;
  /** Route cost multiplier on bridge decks (above 1: it would rather go round by land). */
  bridge: number;
  /**
   * Route cost multiplier just outside a bridge deck's railings (see
   * Battlefield.railAt): high for vehicles, which have to take the ramps at
   * the ends rather than bump over the side. A class with this at
   * RAIL_WALL or more can't cross a railing at all, even when shoved.
   */
  rail: number;
  /**
   * Takes turns on narrow passages (bridges, later narrow streets) rather
   * than squeezing past oncoming traffic, and plans round busy ones (see
   * traffic.ts). Infantry and spiders slip past each other instead.
   */
  queues: boolean;
  /** Route cost multiplier, and speed multiplier, in water it's allowed into. */
  waterCost: number;
  waterSpeed: number;
  /** Flies over everything: no routes, no terrain, no buildings in the way. */
  flies: boolean;
  /** Height above the ground or water surface it moves at. */
  altitude: number;
  /**
   * Which buildings it goes over rather than round: none, low ones (walls,
   * which long legs step over), or all of them (spiders climb up one side and
   * down the other).
   */
  over: 'none' | 'low' | 'all';
}

/** Slope above which ground counts as steep (see MoveRules.steep). */
export const STEEP_SLOPE = 0.7;
/** MoveRules.rail at or above this: the class can't get over a bridge's railings at all (see NavGrid.railCrossing). */
export const RAIL_WALL = 10;

const land: MoveRules = { maxDepth: 0, minDepth: 0, steep: 3, town: 1, bridge: 1, rail: 40, queues: true, waterCost: 1, waterSpeed: 1, flies: false, altitude: 0, over: 'none' };

export const MOVE_RULES: Record<MoveClass, MoveRules> = {
  /** Infantry: happy on slopes, and prefer moving through towns and outposts, where there's cover. */
  foot: { ...land, steep: 1.6, town: 0.5, rail: 3, queues: false },
  /** Tanks and trucks: the baseline. Slopes are slow going and towns are cramped, so they go round them. */
  tracked: { ...land, steep: 3, town: 1.8 },
  /**
   * Mechs: long legs take slopes in stride and wade through shallow water,
   * but big ones keep out of towns, and take a bridge only when going round
   * by land is a long way further (a bridge is a tight squeeze for a Titan).
   * They step straight over walls.
   */
  walker: { ...land, maxDepth: 0.6, steep: 1.4, town: 1.8, bridge: 3, waterCost: 2, waterSpeed: 0.6, over: 'low' },
  /**
   * Spider walkers: many legs take any slope as easily as flat ground, they're
   * small enough for town streets, and they climb straight over buildings and walls.
   */
  climber: { ...land, maxDepth: 0.6, steep: 1, town: 1, rail: 3, queues: false, waterCost: 2, waterSpeed: 0.6, over: 'all' },
  /**
   * Hovercraft: skim water as easily as land, but steep ground is the worst
   * going of any class. Running down a river they hop a bridge's deck rather
   * than pass under it, so its railings only put them off a little.
   */
  hover: { ...land, maxDepth: Infinity, steep: 6, town: 1.5, rail: 4, waterSpeed: 1.1 },
  /** Amphibious vehicles: drive on land, swim slowly. */
  amphibious: { ...land, maxDepth: Infinity, town: 1.8, rail: 4, waterCost: 2, waterSpeed: 0.5 },
  /** Boats: water only, and not the shallowest of it. */
  naval: { ...land, maxDepth: Infinity, minDepth: 0.2, steep: 1, town: 1, rail: 1, queues: false },
  /** Aircraft: fly straight over everything. */
  air: { ...land, maxDepth: Infinity, steep: 1, rail: 1, queues: false, flies: true, altitude: 6 },
};

/** Whether a mover of this class can be at a spot with this water depth (depth <= 0 is dry land) and slope. */
export function terrainAllows(rules: MoveRules, depth: number, slope: number): boolean {
  if (rules.flies) return true;
  if (depth > rules.maxDepth) return false;
  if (rules.minDepth > 0 && depth < rules.minDepth) return false;
  if (depth <= 0 && slope > STEEP_SLOPE && rules.steep === Infinity) return false;
  return true;
}
