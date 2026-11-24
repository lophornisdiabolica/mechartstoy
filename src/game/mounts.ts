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
  /** How far the turret turns either side of the nose, radians (a neck); without it, all the way round. */
  yaw?: number;
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
  pilgrimTruck: { turret: [-0.4, 0.98, 0], pivot: [0, 0.12, 0], muzzles: [[0.6, 0, 0]], elev: [-0.3, 0.7] },
  harpoonTractor: { turret: [0.3, 0.92, 0], pivot: [0, 0.1, 0], muzzles: [[0.98, 0, 0]], elev: [-0.25, 0.4] },
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
  // Aegis and Rime.
  domeTruck: { turret: [0.55, 1.15, 0], pivot: [0, 0.25, 0], muzzles: [[0.55, 0, 0]], elev: AA },
  lanceWalker: { turret: [0, 1.75, 0], muzzles: [[1.5, 0, -0.5]] },
  citadel: { turret: [0, 3.1, 0], muzzles: pair(1.6, 0.5, 1.2) },
  shardTank: { turret: [-0.1, 0.83, 0], pivot: [0.4, 0.22, 0], muzzles: [[1.3, 0, 0]], elev: GUN },
  freezerTruck: { turret: [-0.7, 0.62, 0], pivot: [0.05, 0.36, 0], muzzles: [[0.66, 0, 0]], elev: [0, 1.1], rest: 0.6 },
  glacier: { turret: [0, 3.25, 0], muzzles: pair(1.55, 0.55, 1.22) },
  // Sabre. Its melee weapons' "muzzles" are the tips of the blades; each gun on a mount of its own is
  // keyed by its model and '#' (see UnitDef.mounts), and sits on top of the body, where the torso turns.
  duelist: { turret: [0, 1.2, 0], muzzles: [[1.13, 0, -0.36]] },
  'duelist#gun': { turret: [0.05, 1.22, 0.38], muzzles: [[0.51, 0, 0]] },
  reaver: { turret: [-0.15, 1.03, 0], muzzles: [[2.82, 0.32, 0]] },
  'reaver#mg': { turret: [0.85, 1.1, 0.36], muzzles: [[0.5, 0.1, 0]] },
  colossus: { turret: [0, 3.25, 0], muzzles: pair(1.6, 0.4, 1.25) },
  'colossus#rockets': { turret: [0, 4.85, 0], muzzles: pair(0.61, 0.45, 0.25), salvo: 'alternate' },
  // Cipher.
  hackVan: { turret: [-0.4, 1.28, 0], pivot: [0, 0.3, 0], muzzles: [[0.35, 0, 0]], elev: [-0.2, 0.9], rest: 0.4 },
  'hackVan#gun': { turret: [0.5, 1.22, 0], muzzles: [[0.55, 0.26, 0]] },
  jammer: { turret: [0, 1.6, 0], muzzles: pair(0.95, -0.05, 0.42) },
  overmind: { turret: [0, 3.1, 0], muzzles: pair(1.6, 0.5, 1.2) },
  'overmind#array': { turret: [-0.3, 4.75, 0], muzzles: [[0.75, 0.35, 0]] },
  'bld:uplinkMast': { turret: [0, 4.2, 0], pivot: [0, 0.3, 0], muzzles: [[0.55, 0, 0]], elev: [-0.6, 0.6], rest: 0.2 },
  // Veil.
  smokeTruck: { turret: [-0.7, 0.62, 0], pivot: [0.05, 0.4, 0], muzzles: [[0.73, 0, 0]], elev: [0, 1.1], rest: 0.6 },
  ghostTank: { turret: [-0.1, 0.8, 0], pivot: [0.4, 0.2, 0], muzzles: [[1.3, 0, 0]], elev: GUN },
  eclipse: { turret: [0, 3.1, 0], muzzles: pair(1.6, 0.5, 1.2) },
  'frostTower#mortar': { turret: [0, 2.32, 0], pivot: [0, 0.2, 0], muzzles: [[0.45, 0, 0]], elev: [0.3, 1.2], rest: 0.8 },
  // Zenith.
  beaconRunner: { turret: [0.3, 0.56, 0], muzzles: [[0.5, 0.24, 0]] },
  uplinkTruck: { turret: [-0.55, 0.75, 0], pivot: [0, 1.75, 0], muzzles: [[0.45, 0, 0]], elev: [-0.9, 0.7], rest: -0.2 },
  lancePlatform: { turret: [0, 3.0, 0], pivot: [0.3, 1.0, 0], muzzles: [[3.1, 0, 0]], elev: [0, 1.2], rest: 0.45 },
  'bld:dropControl': { turret: [-1.3, 3.95, 0], pivot: [0, 0.2, 0], muzzles: [[0.45, 0, 0]], elev: [-0.9, 0.8], rest: -0.1 },
  'lancePlatform#guns': { turret: [-1.0, 3.1, 0], muzzles: pair(0.5, 0.1, 0.3) },
  // Hive.
  mite: { turret: [0, 0, 0], muzzles: [[0.4, 0.25, 0]], hull: true },
  gunMite: { turret: [0.15, 0.57, 0], pivot: [0.08, 0.06, 0], muzzles: [[0.33, 0, 0]], elev: [-0.5, 1.2] },
  fabricator: { turret: [0.3, 1.0, 0], muzzles: [[1.5, 0.15, 0]] },
  acidSpitter: { turret: [0.45, 0.95, 0], pivot: [0.2, 0.08, 0], muzzles: [[0.32, 0, 0]], elev: [-0.4, 1.2] },
  ravager: { turret: [0.9, 0.95, 0], muzzles: [[1.0, -0.05, 0.32]] },
  // Drawn at 0.72 of her first size (HIVE_MOTHER_SIZE in render/models/units.ts).
  hiveMother: { turret: [1.296, 2.088, 0], pivot: [0.396, -0.072, 0], muzzles: [[0.4032, 0, 0]], elev: [-0.7, 1.0] },
  'bld:recycler': { turret: [-0.4, 2.65, 0], pivot: [0.3, 0.2, 0], muzzles: [[0.55, 0, 0]], elev: [-0.6, 1.0] },
  // Nomad.
  crawler: { turret: [1.45, 2.1, 0], pivot: [0.1, 0.18, 0], muzzles: pair(0.6, 0, 0.12), elev: [-0.4, 1.0] },
  outrider: { turret: [-0.25, 0.8, 0], pivot: [0.05, 0.12, 0], muzzles: [[0.45, 0, 0]], elev: [-0.4, 0.6] },
  ark: { turret: [0.9, 2.1, 0], pivot: [0.6, 0.35, 0], muzzles: pair(1.8, 0, 0.35), elev: [-0.2, 0.5] },
  'ark#guns': { turret: [-1.8, 3.8, 0], muzzles: pair(0.47, 0.14, 0.08) },
  'bld:crawlerCamp': { turret: [1.45, 1.85, 0], pivot: [0.1, 0.18, 0], muzzles: pair(0.6, 0, 0.12), elev: [-0.4, 1.0] },
  // Antiquity.
  legionary: { turret: [0, 0, 0], muzzles: [[0.35, 0.54, -0.17]], hull: true },
  crossbowman: { turret: [0, 0, 0], muzzles: [[0.34, 0.64, -0.08]], hull: true },
  ballista: { turret: [0.1, 0.55, 0], pivot: [0, 0.3, 0], muzzles: [[0.65, 0, 0]], elev: [-0.3, 0.6] },
  trebuchet: { turret: [0, 0.5, 0], pivot: [0, 2.0, 0], muzzles: [[1.7, 0, 0]], elev: [-0.4, 1.2], rest: -0.3 },
  chariot: { turret: [-0.3, 0.8, 0], pivot: [0.05, 0.25, 0], muzzles: [[0.165, 0, 0.17]], elev: [-0.4, 0.8] },
  hwacha: { turret: [0.1, 0.55, 0], pivot: [0, 0.4, 0], muzzles: [[0.41, 0, 0]], elev: [0, 1.0], rest: 0.5 },
  warElephant: { turret: [0, 0, 0], muzzles: [[1.85, 1.35, 0.22]], hull: true },
  'warElephant#bows': { turret: [-0.1, 2.6, 0], muzzles: [[0.165, 0.1, 0.17]] },
  bronzeColossus: { turret: [0, 2.6, 0], muzzles: [[2.4, 0.1, 0.95]] },
  warKite: { turret: [0, 0, 0], pivot: [0, 0.02, 0], muzzles: [[0.145, 0, 0.15]], elev: [-1.4, 0.4] },
  'bld:castrum': { turret: [2.75, 2.2, 0], pivot: [0, 0.3, 0], muzzles: [[0.6, 0, 0]], elev: [-0.4, 0.6] },
  // Tin Soldiers.
  tinSoldier: { turret: [0, 0, 0], muzzles: [[0.12, 0.87, -0.16]], hull: true },
  clockworkTank: { turret: [0.1, 0.88, 0], pivot: [0.2, 0.18, 0], muzzles: [[0.9, 0, 0]], elev: [-0.2, 0.4] },
  toyCannon: { turret: [0, 0.55, 0], pivot: [0, 0.1, 0], muzzles: [[0.72, 0, 0]], elev: [0, 1.1], rest: 0.5 },
  tinRobot: { turret: [0, 1.85, 0], pivot: [0.25, 0.25, 0], muzzles: [[0.06, 0, 0.12], [0.06, 0, -0.12]], elev: [-0.4, 0.8] },
  clockworkGiant: { turret: [0, 2.6, 0], pivot: [0.7, 0.8, 0], muzzles: [[0.7, 0, 0]], elev: [-0.3, 0.4] },
  'bld:toyBox': { turret: [0.4, 2.3, 0], pivot: [0.3, 0.85, 0], muzzles: [[0.65, 0, 0]], elev: [-0.4, 0.5] },
  // Mirage.
  prismTank: { turret: [-0.1, 0.82, 0], pivot: [0.15, 0.4, 0], muzzles: [[0.7, 0, 0]], elev: [-0.2, 0.4] },
  projectorTruck: { turret: [0.6, 1.3, 0], pivot: [0, 0.12, 0], muzzles: [[0.47, 0, 0]], elev: [-0.4, 0.9] },
  fataMorgana: { turret: [0, 2.4, 0], pivot: [0.7, 0.6, 0], muzzles: [[1.95, 0, 0]], elev: [-0.3, 0.5] },
  'bld:mirrorArray': { turret: [0, 3.3, 0], pivot: [0, 0.4, 0], muzzles: [[0.6, 0, 0]], elev: [-0.5, 0.6] },
  // Verdant.
  strangler: { turret: [0, 1.3, 0], pivot: [0.1, 0.18, 0], muzzles: [[0.77, 0, 0]], elev: [-0.4, 0.8] },
  seedMortar: { turret: [0.15, 0.62, 0], pivot: [0.2, 0.3, 0], muzzles: [[0.45, 0, 0]], elev: [0, 1.1], rest: 0.6 },
  graftWalker: { turret: [0, 1.2, 0], muzzles: [[0.55, 0.03, 0.57]] },
  'graftWalker#spines': { turret: [-0.2, 2.47, 0], muzzles: [[0.37, 0.03, 0]] },
  worldTree: { turret: [0, 2.6, 0], pivot: [0.9, 1.8, 0], muzzles: [[1.3, 0, 0]], elev: [-0.4, 0.6] },
  'worldTree#seeds': { turret: [0.8, 4.4, 1.0], muzzles: [[0.55, 0.05, 0]] },
  'bld:glasshouse': { turret: [0, 2.78, 0], pivot: [0.15, 0.2, 0], muzzles: [[0.75, 0, 0]], elev: [-0.5, 0.6] },
  // Lodestar.
  magnetCrane: { turret: [-0.3, 0.9, 0], pivot: [0.2, 0.3, 0], muzzles: [[2.1, 0, 0]], elev: [0, 1.0], rest: 0.55 },
  'magnetCrane#mg': { turret: [0.6, 1.5, 0.45], muzzles: [[0.42, 0.08, 0]] },
  coilTank: { turret: [0, 0.88, 0], pivot: [0.35, 0.2, 0], muzzles: [[1.5, 0, 0]], elev: [-0.2, 0.4] },
  lodestone: { turret: [0, 2.6, 0], pivot: [0.8, 1.0, 0], muzzles: [[2.2, 0, 0.45]], elev: [-0.3, 0.9] },
  'lodestone#coils': { turret: [0.2, 4.5, 0.7], muzzles: [[0.95, 0, 0.12], [0.95, 0, -0.12]] },
  'bld:scrapyard': { turret: [0.6, 2.6, 0.2], pivot: [0, 0.35, 0], muzzles: [[1.7, 0, 0]], elev: [0, 1.0], rest: 0.3 },
  // Leviathan.
  // Its tail whips round (the main, melee weapon), and its head turns a little on its neck to breathe fire.
  leviathan: { turret: [0, 0, 0], muzzles: [[1.8, 2.2, 0]], hull: true },
  'leviathan#head': { turret: [2.0, 2.7, 0], muzzles: [[1.6, -0.55, 0]], yaw: 1.0 },
  'bld:shrine': { turret: [0, 2.3, 0], pivot: [0.56, 0.5, 0], muzzles: [[0.08, 0, 0.25], [0.08, 0, -0.25]], elev: [-0.4, 0.5] },
  'bld:tower': { turret: [0, 1.75, 0], pivot: [0.35, 0.35, 0], muzzles: pair(1.0, 0, 0.15), elev: [-0.5, 1.2] },
  'bld:frostTower': { turret: [0, 1.75, 0], pivot: [0.35, 0.35, 0], muzzles: pair(1.0, 0, 0.15), elev: [-0.5, 1.2] },
  'bld:bigGun': { turret: [0, 0.8, 0], pivot: [0.4, 0.5, 0], muzzles: [[2.6, 0, 0]], elev: [0, 0.9], rest: 0.25 },
  'bld:shoreBattery': { turret: [0, 0.52, 0], pivot: [0.38, 0.3, 0], muzzles: pair(0.99, 0, 0.24), elev: [-0.35, 0.6], rest: 0.08 },
};

export function mountOf(model: string): Mount | undefined {
  return MOUNTS[model];
}

const scaledMounts = new WeakMap<Mount, Map<number, Mount>>();
/** A mount on a model drawn `scale` times its size (a growing Leviathan): every point moved out with it. */
export function scaledMount(mount: Mount, scale: number): Mount {
  const k = Math.round(scale * 100) / 100;
  if (k === 1) return mount;
  let sizes = scaledMounts.get(mount);
  if (!sizes) scaledMounts.set(mount, (sizes = new Map()));
  let m = sizes.get(k);
  if (!m) {
    const s = (v: V3): V3 => [v[0] * k, v[1] * k, v[2] * k];
    m = { ...mount, turret: s(mount.turret), ...(mount.pivot ? { pivot: s(mount.pivot) } : {}), muzzles: mount.muzzles.map(s) };
    sizes.set(k, m);
  }
  return m;
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
