import * as D from '../core/dmath';

/**
 * Where each armed model's guns are: the turret's pivot, the pivot its
 * barrels pitch round, and the muzzle at the end of each barrel. Shots,
 * muzzle flashes and smoke start from the muzzle, and the models in
 * render/models build their turrets and barrels round these same points
 * (test/mounts.test.ts checks that they line up).
 *
 * Points are in the model's own space: +x is the nose, +y up, +z to the
 * model's left as it faces +x (the way Three.js builds them). A hull tilted
 * on a slope (see Tilt) carries its turret with it, the turret turns on the
 * hull, and the barrels pitch on the turret.
 */
export type V3 = readonly [number, number, number];

export interface Mount {
  /** The turret's pivot, in model space. */
  turret: V3;
  /** The pivot the barrels pitch round, in turret space. Without one, the guns are fixed in the turret. */
  pivot?: V3;
  /** Each barrel's muzzle with the barrels level: in pivot space (or turret space without a pivot, model space with `hull`). */
  muzzles: V3[];
  /** The guns are on the hull itself, not the turret (a gunship's rocket pods, a jet's nose cannon). */
  hull?: boolean;
  /**
   * With several muzzles, whether a burst's shots take turns along them
   * (left, right, left...) or go off together, one from each, and the burst
   * is over that much sooner.
   */
  salvo?: 'alternate' | 'together';
  /** How far the barrels pitch down and up from the turret, radians. */
  elev?: readonly [number, number];
  /** How far up the barrels sit when there's nothing to shoot (a rocket rack, a howitzer), radians. */
  rest?: number;
}

/** Most mounts have two barrels side by side. */
const pair = (x: number, y: number, z: number): V3[] => [
  [x, y, z],
  [x, y, -z],
];

/** Direct-fire guns: can't dip far below the turret, or lift far above it. */
const GUN: [number, number] = [-0.17, 0.4];
/** Machine guns and flak on a pintle or a high turret: they can shoot at aircraft. */
const AA: [number, number] = [-0.35, 1.3];

export const MOUNTS: Record<string, Mount> = {
  // Walkers: the torso turns, and the guns are fixed in it (legs take the slopes, the body stays level).
  strider: { turret: [0, 1.55, 0], muzzles: pair(0.85, -0.08, 0.45) },
  titan: { turret: [0, 2.8, 0], muzzles: pair(0.43, 1.35, 1.0) },
  fortress: { turret: [0, 2.9, 0], muzzles: pair(2.2, 0.45, 0.6), salvo: 'together' },
  warhound: { turret: [0, 2.25, 0], muzzles: pair(1.5, 0.3, 0.85) },
  juggernaut: { turret: [0, 3.25, 0], muzzles: pair(0.55, 1.75, 1.25) },
  cinderWalker: { turret: [0, 1.5, 0], muzzles: pair(1.31, 0.05, 0.45), salvo: 'together' },
  inferno: { turret: [0.8, 3.2, 0], muzzles: pair(1.57, 0.12, 0.35), salvo: 'together' },
  flakWalker: {
    turret: [0, 1.7, 0],
    pivot: [0.4, 0.34, 0],
    muzzles: [...pair(0.9, 0.09, 0.25), ...pair(0.9, -0.09, 0.25)],
    elev: [-0.2, 1.4],
    rest: 0.5,
  },
  spider: { turret: [0.25, 0.88, 0], pivot: [0.2, 0.12, 0], muzzles: pair(0.55, 0, 0.1), elev: [-0.5, 1.3] },
  siegeSpider: { turret: [-0.3, 3.05, 0], pivot: [0.6, 0.55, 0], muzzles: [[3.55, 0, 0]], elev: [0.2, 1.1], rest: 0.55 },

  // Tracked and wheeled vehicles.
  tank: { turret: [-0.1, 0.83, 0], pivot: [0.4, 0.22, 0], muzzles: [[1.3, 0, 0]], elev: GUN },
  lancer: { turret: [-0.15, 1.03, 0], pivot: [0.55, 0.28, 0], muzzles: [[1.925, 0, 0]], elev: [-0.15, 0.35] },
  lightTank: { turret: [-0.05, 0.71, 0], pivot: [0.38, 0.18, 0], muzzles: [[0.97, 0, 0]], elev: GUN },
  railgun: { turret: [-0.3, 0.81, 0], pivot: [0.3, 0.3, 0], muzzles: [[2.6, 0, 0]], elev: [-0.12, 0.3] },
  howitzer: { turret: [-0.3, 0.75, 0], pivot: [0.45, 0.4, 0], muzzles: [[2.05, 0, 0]], elev: [0, 1.0], rest: 0.5 },
  flakTank: { turret: [-0.1, 0.85, 0], pivot: [0.35, 0.3, 0], muzzles: pair(1.15, 0, 0.22), elev: [-0.12, 1.35], rest: 0.45 },
  carrier: { turret: [0.3, 1.1, 0], pivot: [0.2, 0.15, 0], muzzles: [[0.65, 0, 0]], elev: AA },
  siegeCrawler: { turret: [0.3, 1.9, 0], pivot: [0.2, 0.55, 0], muzzles: pair(1.0, 0, 0.3), elev: [0.3, 1.2], rest: 0.8 },
  mgTruck: { turret: [-0.35, 0.82, 0], pivot: [0, 0.42, 0], muzzles: [[0.75, 0, 0]], elev: AA },
  buggy: { turret: [-0.25, 0.98, 0], pivot: [0, 0.08, 0], muzzles: [[0.55, 0, 0]], elev: AA },
  rocketTruck: {
    turret: [-0.4, 0.62, 0],
    pivot: [0, 0.45, 0],
    muzzles: [...pair(0.63, 0.11, 0.2), ...pair(0.63, -0.11, 0.2)],
    elev: [0, 0.9],
    rest: 0.45,
  },
  landTrain: { turret: [-0.25, 1.35, 0], muzzles: [...pair(0.5, 0.33, 0.2), ...pair(0.5, 0.17, 0.2)] },
  amphib: { turret: [0.2, 1.1, 0], pivot: [0.15, 0.12, 0], muzzles: [[0.55, 0, 0]], elev: AA },
  scorchBuggy: { turret: [0.25, 0.56, 0], pivot: [0.1, 0.12, 0], muzzles: [[0.63, 0, 0]], elev: [-0.4, 0.6] },

  // Hovers and boats: their hulls ride their own bob, which the muzzles don't follow (it's a few centimetres).
  skimmer: { turret: [0.05, 0.62, 0], pivot: [0.3, 0.15, 0], muzzles: [[0.85, 0, 0]], elev: GUN },
  hoverFortress: { turret: [0.6, 1.0, 0], pivot: [0, 0.55, 0], muzzles: pair(0.63, 0, 0.4), elev: [-0.1, 1.2], rest: 0.15 },
  missileBoat: { turret: [0.55, 0.3, 0], pivot: [0, 0.45, 0], muzzles: pair(0.38, 0, 0.12), elev: [-0.1, 1.2], rest: 0.3 },
  dreadnought: { turret: [1.15, 0.5, 0], pivot: [0.3, 0.22, 0], muzzles: pair(0.95, 0, 0.16), salvo: 'together', elev: [0, 0.9], rest: 0.1 },

  // Aircraft: chin guns that swing down at the ground, and guns fixed in the airframe.
  scout: { turret: [0.55, 0.05, 0], pivot: [0, 0, 0], muzzles: [[0.36, 0, 0]], elev: [-1.4, 0.4] },
  drone: { turret: [0.2, 0.05, 0], pivot: [0, 0, 0], muzzles: [[0.2, 0, 0]], elev: [-1.4, 0.4] },
  gunship: { turret: [0.7, 0.05, 0], muzzles: pair(0.4, 0.18, 0.85), hull: true },
  bomber: { turret: [0.1, 0.05, 0], muzzles: [[0.1, 0.03, 0]], hull: true },
  jet: { turret: [0, 0, 0], muzzles: pair(1.6, 0.22, 0.1), hull: true },
  airship: { turret: [1.0, 0.1, 0], pivot: [0.1, 0.05, 0], muzzles: pair(0.6, 0, 0.1), elev: [-1.3, 1.0] },

  // Buildings.
  'bld:tower': { turret: [0, 1.75, 0], pivot: [0.35, 0.35, 0], muzzles: pair(1.0, 0, 0.15), elev: [-0.5, 1.2] },
  'bld:bigGun': { turret: [0, 0.8, 0], pivot: [0.4, 0.5, 0], muzzles: [[2.6, 0, 0]], elev: [0, 0.9], rest: 0.25 },
  'bld:shoreBattery': { turret: [0, 0.52, 0], pivot: [0.38, 0.3, 0], muzzles: pair(0.99, 0, 0.24), elev: [-0.35, 0.6], rest: 0.08 },
};

export function mountOf(model: string): Mount | undefined {
  return MOUNTS[model];
}

/** How a hull sits: its heading and, on a slope, its pitch (nose up) and roll (toward its left side). */
export interface HullPose {
  x: number;
  y: number;
  z: number;
  heading: number;
  pitch: number;
  roll: number;
}

/**
 * The hull's rotation as a 3x3 matrix, row by row: turn to the heading, then
 * pitch the nose up, then roll (Three.js's 'YZX' order, which the entity
 * view poses models with).
 */
export function hullMatrix(heading: number, pitch: number, roll: number, out: number[] = new Array(9)): number[] {
  const ch = D.cos(heading);
  const sh = D.sin(heading);
  const cp = D.cos(pitch);
  const sp = D.sin(pitch);
  const cr = D.cos(roll);
  const sr = D.sin(roll);
  out[0] = ch * cp;
  out[1] = -ch * sp * cr + sh * sr;
  out[2] = ch * sp * sr + sh * cr;
  out[3] = sp;
  out[4] = cp * cr;
  out[5] = -cp * sr;
  out[6] = -sh * cp;
  out[7] = sh * sp * cr + ch * sr;
  out[8] = -sh * sp * sr + ch * cr;
  return out;
}

const _m: number[] = new Array(9);

/**
 * The turret's turn on the hull, for a weapon pointing at world heading
 * `aim`: the angle of that heading laid onto the hull's tilted deck. The
 * entity view turns the model's turret by the same amount.
 */
export function turretYaw(m: readonly number[], aim: number): number {
  const dx = D.cos(aim);
  const dz = -D.sin(aim);
  // The direction in hull space (the transpose undoes the rotation); its height is dropped.
  const lx = m[0] * dx + m[6] * dz;
  const lz = m[2] * dx + m[8] * dz;
  return D.atan2(-lz, lx);
}

/**
 * Where a direction (world heading and climb) points relative to the hull:
 * how far round from the nose, and how far up off the deck.
 */
export function toHull(m: readonly number[], heading: number, climb: number): { yaw: number; elev: number } {
  const c = D.cos(climb);
  const dx = c * D.cos(heading);
  const dy = D.sin(climb);
  const dz = -c * D.sin(heading);
  const lx = m[0] * dx + m[3] * dy + m[6] * dz;
  const ly = m[1] * dx + m[4] * dy + m[7] * dz;
  const lz = m[2] * dx + m[5] * dy + m[8] * dz;
  return { yaw: D.atan2(-lz, lx), elev: D.atan2(ly, D.hypot(lx, lz)) };
}

/**
 * Where muzzle `index` (wrapping round the mount's muzzles) is in the world,
 * for a hull posed as `hull`, the weapon pointing at world heading `aim` and
 * the barrels pitched `elev` up off the turret.
 */
export function muzzleWorld(mount: Mount, hull: HullPose, aim: number, elev: number, index: number): { x: number; y: number; z: number } {
  const m = hullMatrix(hull.heading, hull.pitch, hull.roll, _m);
  const tip = mount.muzzles[index % mount.muzzles.length];
  let x: number;
  let y: number;
  let z: number;
  if (mount.hull) {
    [x, y, z] = tip;
  } else {
    // Barrel pitch about the pivot, then the turret's turn, then onto the turret's pivot.
    let bx = tip[0];
    let by = tip[1];
    const bz = tip[2];
    if (mount.pivot) {
      const ce = D.cos(elev);
      const se = D.sin(elev);
      const px = bx * ce - by * se;
      by = bx * se + by * ce;
      bx = px + mount.pivot[0];
      by += mount.pivot[1];
    }
    const pz = mount.pivot ? bz + mount.pivot[2] : bz;
    const yaw = turretYaw(m, aim);
    const cy = D.cos(yaw);
    const sy = D.sin(yaw);
    x = cy * bx + sy * pz + mount.turret[0];
    y = by + mount.turret[1];
    z = -sy * bx + cy * pz + mount.turret[2];
  }
  return {
    x: hull.x + m[0] * x + m[1] * y + m[2] * z,
    y: hull.y + m[3] * x + m[4] * y + m[5] * z,
    z: hull.z + m[6] * x + m[7] * y + m[8] * z,
  };
}

/** Height of the barrels' pivot above the model's origin (the turret's, without one): roughly where shots start. */
export function pivotHeight(mount: Mount): number {
  return mount.turret[1] + (mount.pivot?.[1] ?? 0);
}

/** Which way the barrels point in the world, as a heading and a climb (for muzzle flashes and smoke). */
export function barrelDirection(mount: Mount, hull: HullPose, aim: number, elev: number): { heading: number; climb: number } {
  const m = hullMatrix(hull.heading, hull.pitch, hull.roll, _m);
  let x = 1;
  let y = 0;
  let z = 0;
  if (!mount.hull) {
    const e = mount.pivot ? elev : 0;
    const yaw = turretYaw(m, aim);
    const ce = D.cos(e);
    x = D.cos(yaw) * ce;
    y = D.sin(e);
    z = -D.sin(yaw) * ce;
  }
  const dx = m[0] * x + m[1] * y + m[2] * z;
  const dy = m[3] * x + m[4] * y + m[5] * z;
  const dz = m[6] * x + m[7] * y + m[8] * z;
  return { heading: D.atan2(-dz, dx), climb: D.atan2(dy, D.hypot(dx, dz)) };
}
