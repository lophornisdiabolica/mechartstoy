import { MoveClass } from '../world/moveClasses';

/**
 * Unit and weapon definitions. Adding a unit type is a new entry here plus a
 * model registered under its `model` key; no system code changes needed.
 */
export type UnitClass = 'infantry' | 'vehicle' | 'mech';

/**
 * What a unit does in a fight, which sets a few simple habits (see the AI system):
 * - frontline: leads the push and closes with the enemy.
 * - artillery: fires from near its longest range, and backs off from
 *   enemies inside its minimum range.
 * - support: keeps a little behind the nearest frontline ally rather than
 *   charging, and only shoots what comes into range.
 */
export type Role = 'frontline' | 'artillery' | 'support';

/** Which targets a weapon can hit: things on the ground (and water), aircraft, or both. */
export type WeaponTargets = 'ground' | 'air' | 'both';

/** How a projectile travels and looks. */
export type ProjectileKind = 'bullet' | 'shell' | 'missile' | 'artillery';

export interface WeaponDef {
  name: string;
  range: number;
  /** Targets closer than this can't be hit (e.g. artillery). */
  minRange: number;
  damage: number;
  /** Seconds between shots (or between bursts). */
  cooldown: number;
  /** Shots per trigger pull, fired `burstGap` seconds apart. */
  burst: number;
  burstGap: number;
  projectile: ProjectileKind;
  /** World units per second. */
  speed: number;
  /** Damage radius on impact; 0 means it only hits the unit aimed at. */
  splash: number;
  /** Max miss distance, as a fraction of range at max range. */
  spread: number;
  /** Lobbed shots fly in a parabola. */
  arc: boolean;
  /** Height of the muzzle above the unit's origin. */
  muzzleHeight: number;
  targets: WeaponTargets;
}

export interface UnitDef {
  id: string;
  name: string;
  class: UnitClass;
  /** How it gets around (see moveClasses.ts). */
  move: MoveClass;
  role: Role;
  model: string;
  hp: number;
  /** Fraction of incoming damage ignored, 0..1. */
  armor: number;
  speed: number;
  turnRate: number;
  radius: number;
  sight: number;
  /** Has a turret that aims independently of the hull. */
  turret: boolean;
  turretTurnRate: number;
  weapon: WeaponDef;
  /** Seconds a wreck stays on the field (0 = removed immediately). */
  wreckTime: number;
  /** Siege units shell buildings in sight before bothering with units. */
  siege: boolean;
}

const rifle: WeaponDef = {
  name: 'Rifle',
  range: 9,
  minRange: 0,
  damage: 4,
  cooldown: 1.4,
  burst: 3,
  burstGap: 0.12,
  projectile: 'bullet',
  speed: 60,
  splash: 0,
  spread: 0.08,
  arc: false,
  muzzleHeight: 0.4,
  targets: 'ground',
};

export const UNIT_DEFS = {
  trooper: {
    id: 'trooper',
    name: 'Trooper',
    class: 'infantry',
    move: 'foot',
    role: 'frontline',
    model: 'trooper',
    hp: 20,
    armor: 0,
    speed: 1.6,
    turnRate: 6,
    radius: 0.3,
    sight: 14,
    turret: false,
    turretTurnRate: 6,
    weapon: rifle,
    wreckTime: 0,
    siege: false,
  },
  strider: {
    id: 'strider',
    name: 'Strider',
    class: 'mech',
    move: 'walker',
    role: 'frontline',
    model: 'strider',
    hp: 90,
    armor: 0.1,
    speed: 3.6,
    turnRate: 3,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 4,
    weapon: {
      name: 'Autocannon',
      range: 12,
      minRange: 0,
      damage: 7,
      cooldown: 1.1,
      burst: 4,
      burstGap: 0.1,
      projectile: 'bullet',
      speed: 55,
      splash: 0.6,
      spread: 0.07,
      arc: false,
      muzzleHeight: 1.6,
      targets: 'both',
    },
    wreckTime: 18,
    siege: false,
  },
  tank: {
    id: 'tank',
    name: 'Battle Tank',
    class: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'tank',
    hp: 220,
    armor: 0.35,
    speed: 2.6,
    turnRate: 1.6,
    radius: 1.1,
    sight: 18,
    turret: true,
    turretTurnRate: 1.8,
    weapon: {
      name: 'Cannon',
      range: 15,
      minRange: 0,
      damage: 45,
      cooldown: 3,
      burst: 1,
      burstGap: 0,
      projectile: 'shell',
      speed: 32,
      splash: 1.4,
      spread: 0.05,
      arc: false,
      muzzleHeight: 1.0,
      targets: 'ground',
    },
    wreckTime: 25,
    siege: false,
  },
  titan: {
    id: 'titan',
    name: 'Titan',
    class: 'mech',
    move: 'walker',
    role: 'frontline',
    model: 'titan',
    hp: 520,
    armor: 0.45,
    speed: 1.6,
    turnRate: 1,
    radius: 1.6,
    sight: 22,
    turret: true,
    turretTurnRate: 1.2,
    weapon: {
      name: 'Missile pods',
      range: 20,
      minRange: 3,
      damage: 22,
      cooldown: 4.5,
      burst: 6,
      burstGap: 0.18,
      projectile: 'missile',
      speed: 18,
      splash: 2,
      spread: 0.12,
      arc: true,
      muzzleHeight: 3.6,
      targets: 'both',
    },
    wreckTime: 35,
    siege: true,
  },
  howitzer: {
    id: 'howitzer',
    name: 'Howitzer',
    class: 'vehicle',
    move: 'tracked',
    role: 'artillery',
    model: 'howitzer',
    hp: 120,
    armor: 0.2,
    speed: 1.8,
    turnRate: 1.2,
    radius: 1.1,
    sight: 30,
    turret: true,
    turretTurnRate: 0.9,
    weapon: {
      name: 'Howitzer',
      range: 30,
      minRange: 8,
      damage: 60,
      cooldown: 6,
      burst: 1,
      burstGap: 0,
      projectile: 'artillery',
      speed: 16,
      splash: 3.2,
      spread: 0.1,
      arc: true,
      muzzleHeight: 1.2,
      targets: 'ground',
    },
    wreckTime: 25,
    siege: true,
  },
} satisfies Record<string, UnitDef>;

export type UnitId = keyof typeof UNIT_DEFS;

export function unitDef(id: UnitId): UnitDef {
  return UNIT_DEFS[id];
}
