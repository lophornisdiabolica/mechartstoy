import { Rng } from '../core/rng';
import { BUILDING_DEFS, BuildingId, DECORATIVE_BUILDINGS } from '../game/buildings';
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
    const r = BUILDING_DEFS[p.building].radius;
    if (!this.field.contains(p.x, p.z, r + 1)) return false;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (this.field.isWater(p.x + dx, p.z + dz)) return false;
    }
    for (const o of this.placements) {
      const or = BUILDING_DEFS[o.building].radius;
      if (Math.hypot(o.x - p.x, o.z - p.z) < r + or + gap) return false;
    }
    for (const o of this.reserved) {
      if (Math.hypot(o.x - p.x, o.z - p.z) < r + o.r) return false;
    }
    this.placements.push(p);
    return true;
  }
}

/**
 * A faction base: HQ in the middle, production buildings toward the front,
 * guard towers on the perimeter facing the enemy, and houses filling gaps.
 * A lane through the middle is kept clear so units can drive out.
 */
export function layoutBase(field: Battlefield, site: BaseSite, rng: Rng): BuildingPlacement[] {
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
  for (const a of [-0.55, 0, 0.55]) {
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
  const angle = rng.range(0, Math.PI / 2);
  const cells = Math.floor(site.radius / spacing);
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      // Leave a main street clear through the middle.
      if (j === 0 || rng.chance(0.2)) continue;
      const lx = i * spacing + rng.range(-0.4, 0.4);
      const lz = j * spacing + rng.range(-0.4, 0.4);
      if (Math.hypot(lx, lz) > site.radius) continue;
      const x = site.x + lx * Math.cos(angle) - lz * Math.sin(angle);
      const z = site.z + lx * Math.sin(angle) + lz * Math.cos(angle);
      // Taller buildings toward the centre.
      const central = Math.hypot(lx, lz) < site.radius * 0.45;
      const building: BuildingId = central ? rng.pick(['block', 'block', 'spire', 'house']) : rng.pick(['house', 'house', 'silo', 'block']);
      layout.tryPlace({ building, faction: -1, x, z, heading: -angle + rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) }, 0.6);
    }
  }
  return layout.placements;
}
