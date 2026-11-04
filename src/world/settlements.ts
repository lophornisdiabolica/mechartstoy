import { Rng } from '../core/rng';
import { BUILDING_DEFS, BuildingDef, BuildingId, DECORATIVE_BUILDINGS } from '../game/buildings';
import { Battlefield, BaseSite, TownSite } from './battlefield';

/** Radius of the clear ground kept in front of a production building's door. */
const APRON_RADIUS = 3.5;

/** Where a building goes. Pure data: the game turns these into entities. */
export interface BuildingPlacement {
  building: BuildingId;
  /** Faction index, or -1 for civilian. */
  faction: number;
  x: number;
  z: number;
  heading: number;
}

class Layout {
  readonly placements: BuildingPlacement[] = [];
  /** Areas kept clear, such as the ground in front of factory doors. */
  private readonly reserved: { x: number; z: number; r: number }[] = [];

  constructor(private readonly field: Battlefield) {}

  /** Keep a circle free of later placements. */
  reserve(x: number, z: number, r: number): void {
    this.reserved.push({ x, z, r });
  }

  /**
   * Place a production building and keep an apron clear in front of its door,
   * so what it builds (Titans especially) has room to roll out.
   */
  tryPlaceProducer(p: BuildingPlacement): boolean {
    if (!this.tryPlace(p)) return false;
    const r = BUILDING_DEFS[p.building].radius;
    const ahead = r + APRON_RADIUS;
    this.reserve(p.x + Math.cos(p.heading) * ahead, p.z - Math.sin(p.heading) * ahead, APRON_RADIUS);
    return true;
  }

  /** Place if it doesn't overlap anything already placed or sit in water. Returns success. */
  tryPlace(p: BuildingPlacement, gap = 1): boolean {
    if (!this.fits(p.x, p.z, BUILDING_DEFS[p.building].radius, gap)) return false;
    this.placements.push(p);
    return true;
  }

  /** Whether a building of this radius would fit here: on the map, dry, clear of the rest. */
  fits(x: number, z: number, r: number, gap = 1): boolean {
    if (!this.field.contains(x, z, r + 1)) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (this.field.isWater(x + dx, z + dz)) return false;
    }
    // Nothing on or against a bridge.
    if (this.field.nearBridge(x, z, r + 1)) return false;
    for (const o of this.placements) {
      const or = BUILDING_DEFS[o.building].radius;
      if (Math.hypot(o.x - x, o.z - z) < r + or + gap) return false;
    }
    for (const o of this.reserved) {
      if (Math.hypot(o.x - x, o.z - z) < r + o.r) return false;
    }
    return true;
  }
}

/** What a side's doctrine adds to its base (see DoctrineDef). */
export interface BaseExtras {
  /** The signature building. A coastal one goes on the nearest shore, or `inland` goes in its place. */
  signature?: BuildingId;
  inland?: BuildingId;
  /** Guard towers on top of the usual three. */
  extraTowers?: number;
}

/**
 * A faction base: HQ in the middle, production buildings toward the front
 * (plus the doctrine's signature building toward the back, or on the shore
 * for a coastal one), guard towers on the perimeter facing the enemy, and
 * houses filling gaps. A lane through the middle is kept clear so units can
 * drive out.
 */
export function layoutBase(field: Battlefield, site: BaseSite, rng: Rng, extras: BaseExtras = {}): BuildingPlacement[] {
  const layout = new Layout(field);
  const forward = site.faction === 0 ? 0 : Math.PI; // heading toward the enemy
  const f = site.faction;
  // Position in base-local polar coordinates: angle relative to forward, distance from centre.
  const at = (angle: number, dist: number) => ({
    x: site.x + Math.cos(forward + angle) * dist,
    z: site.z - Math.sin(forward + angle) * dist,
  });

  layout.tryPlaceProducer({ building: 'hq', faction: f, ...at(Math.PI, 5), heading: forward });
  layout.tryPlaceProducer({ building: 'barracks', faction: f, ...at(0.75, 8), heading: forward });
  layout.tryPlaceProducer({ building: 'factory', faction: f, ...at(-0.75, 8.5), heading: forward });
  layout.tryPlaceProducer({ building: 'mechbay', faction: f, ...at(Math.PI - 0.9, 10), heading: forward });
  // The doctrine's signature building: on the shore if it's coastal and there is one, else in the first free spot round the back.
  let signature = extras.signature;
  if (signature && (BUILDING_DEFS[signature] as BuildingDef).coastal) {
    const shore = findShore(field, site, BUILDING_DEFS[signature].radius, layout);
    if (shore) layout.tryPlaceProducer({ building: signature, faction: f, ...shore });
    signature = shore ? undefined : extras.inland;
  }
  if (signature) {
    for (const [angle, dist] of [[Math.PI + 0.9, 10], [Math.PI + 1.6, 9], [Math.PI - 1.6, 9], [Math.PI, 12], [1.6, 10], [-1.6, 10]]) {
      if (layout.tryPlaceProducer({ building: signature, faction: f, ...at(angle, dist), heading: forward })) break;
    }
  }
  // Towers across the front. The barracks' and factory's aprons usually leave room for only the
  // middle one of the first three (which the balance was tuned with); extra ones go round the flanks.
  const towers = [-0.55, 0, 0.55, -1.1, 1.1, -1.65, 1.65].slice(0, 3 + (extras.extraTowers ?? 0));
  for (const a of towers) {
    layout.tryPlace({ building: 'tower', faction: f, ...at(a, site.radius - 1), heading: forward });
  }

  // Houses around the back half of the pad.
  for (let n = 0; n < 60 && layout.placements.length < 16; n++) {
    const angle = rng.range(Math.PI * 0.45, Math.PI * 1.55);
    const dist = rng.range(6, site.radius);
    const building = rng.pick(DECORATIVE_BUILDINGS);
    layout.tryPlace({ building, faction: f, ...at(angle, dist), heading: forward + rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) }, 0.8);
  }
  return layout.placements;
}

/** A civilian town laid out on a loose street grid, with a few gaps for squares. */
export function layoutTown(field: Battlefield, site: TownSite, rng: Rng): BuildingPlacement[] {
  const layout = new Layout(field);
  const spacing = 4.4;
  const angle = site.angle;
  const cells = Math.floor(site.radius / spacing);
  // One wedge of the town is its industrial quarter (in towns big enough to have quarters).
  const industry = site.radius >= 10 ? rng.range(-Math.PI, Math.PI) : null;
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      // Leave the main street clear through the middle (along the town's angle).
      if (j === 0 || rng.chance(0.2)) continue;
      const lx = i * spacing + rng.range(-0.4, 0.4);
      const lz = j * spacing + rng.range(-0.4, 0.4);
      if (Math.hypot(lx, lz) > site.radius) continue;
      const x = site.x + lx * Math.cos(angle) - lz * Math.sin(angle);
      const z = site.z + lx * Math.sin(angle) + lz * Math.cos(angle);
      const building = townBuilding(field, site, rng, x, z, industry);
      layout.tryPlace({ building, faction: -1, x, z, heading: -angle + rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) }, 0.6);
    }
  }
  return layout.placements;
}

/**
 * What goes up at a spot in a town, by district: warehouses and silos on
 * the waterfront (the harbour) and in the industrial quarter, taller blocks
 * and the spire in the centre, houses everywhere else.
 */
function townBuilding(field: Battlefield, site: TownSite, rng: Rng, x: number, z: number, industry: number | null): BuildingId {
  const harbour = [0, 1, 2, 3, 4, 5, 6, 7].some((a) => field.isWater(x + Math.cos((a * Math.PI) / 4) * 4.5, z + Math.sin((a * Math.PI) / 4) * 4.5));
  if (harbour) return rng.pick(['warehouse', 'warehouse', 'silo', 'house']);
  const d = Math.hypot(x - site.x, z - site.z);
  if (industry !== null && d > site.radius * 0.35) {
    const off = Math.atan2(z - site.z, x - site.x) - industry;
    if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < Math.PI / 3.5) return rng.pick(['warehouse', 'silo', 'silo', 'block']);
  }
  // Taller buildings toward the centre.
  return d < site.radius * 0.45 ? rng.pick(['block', 'block', 'spire', 'house']) : rng.pick(['house', 'house', 'silo', 'block']);
}

/** Water at least this deep counts as open water for a dock's door (boats need 0.2; see MOVE_RULES.naval). */
const DOCK_DEPTH = 0.5;
/** Furthest past the base's edge a dock goes looking for a shore. */
const SHORE_SEARCH = 16;
/** Grid step for measuring a body of water, and the cells of it that make it open water rather than a pond (about 250 square units). */
const WATER_STEP = 1.5;
const OPEN_WATER = 110;

/**
 * The nearest spot to a base for a building on the shore: dry ground for its
 * footprint, its door facing open water (deep enough for boats, and a lake
 * or sea rather than a pond). Null if there's none near enough.
 */
function findShore(field: Battlefield, site: BaseSite, radius: number, layout: Layout): { x: number; z: number; heading: number } | null {
  const sizes = new Map<string, number>();
  for (let dist = site.radius * 0.5; dist <= site.radius + SHORE_SEARCH; dist += 1.5) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = site.x + Math.cos(a) * dist;
      const z = site.z - Math.sin(a) * dist;
      if (!layout.fits(x, z, radius)) continue;
      for (let h = 0; h < 16; h++) {
        const heading = (h / 16) * Math.PI * 2;
        const door = { x: x + Math.cos(heading) * (radius + 2.5), z: z - Math.sin(heading) * (radius + 2.5) };
        // Boats leave through open water, not under a bridge.
        if (field.nearBridge(door.x, door.z, 3)) continue;
        if (deepWaterArea(field, door.x, door.z, OPEN_WATER, sizes) >= OPEN_WATER) return { x, z, heading };
      }
    }
  }
  return null;
}

/**
 * Roughly how much boat-deep water (in WATER_STEP cells) is connected to a
 * point, counting up to `cap`. Remembered per starting cell in `sizes`.
 */
function deepWaterArea(field: Battlefield, x: number, z: number, cap: number, sizes: Map<string, number>): number {
  const deep = (i: number, j: number) => {
    const px = i * WATER_STEP;
    const pz = j * WATER_STEP;
    return field.contains(px, pz, 1) && field.heightAt(px, pz) < field.seaLevel - DOCK_DEPTH;
  };
  const si = Math.round(x / WATER_STEP);
  const sj = Math.round(z / WATER_STEP);
  const key = `${si},${sj}`;
  const known = sizes.get(key);
  if (known !== undefined) return known;
  if (!deep(si, sj)) return 0;
  const seen = new Set<string>([key]);
  const stack = [[si, sj]];
  while (stack.length > 0 && seen.size < cap) {
    const [i, j] = stack.pop()!;
    for (const [ni, nj] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      const k = `${ni},${nj}`;
      if (seen.has(k) || !deep(ni, nj)) continue;
      seen.add(k);
      stack.push([ni, nj]);
    }
  }
  sizes.set(key, seen.size);
  return seen.size;
}
