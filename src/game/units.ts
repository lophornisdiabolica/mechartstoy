import { MoveClass } from '../world/moveClasses';

/**
 * Unit and weapon definitions. Adding a unit type is a new entry here plus a
 * model registered under its `model` key; no system code changes needed.
 */
export type UnitClass = 'infantry' | 'vehicle' | 'mech' | 'aircraft';

/**
 * Which unit cap a unit counts against (see caps.ts). Each side has a cap per
 * category, so a side can't fill its whole army with one kind of unit.
 * Super units (the Titan) are the rare, war-winning kind: a small cap of their own.
 */
export type UnitCategory = 'infantry' | 'vehicle' | 'air' | 'super';

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
export type ProjectileKind = 'bullet' | 'shell' | 'missile' | 'artillery' | 'flame' | 'beam' | 'frost' | 'hack' | 'orbital' | 'acid' | 'arrow' | 'stone' | 'seed' | 'vine' | 'scrap' | 'spine';

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
  /** Share of the target's armour this weapon's direct hits ignore (0 to 1; see damageThrough). */
  pierce?: number;
  /** Only ever aims at units, never buildings (a base's defences, there to meet attackers, not to shell the neighbours). */
  unitsOnly?: boolean;
  /** Verdant's vines (see verdant.ts): lays this much tangle where it lands, ground grown over with vines that drags at enemies. */
  tangle?: number;
  /** Verdant's seed pods (see verdant.ts): a thicket this wide springs up where it lands (a side plants one every so often). */
  plants?: number;
  /** Lodestar's magnet cranes (see lodestar.ts): each throw takes this much of the wreckage in reach, and with none there it can't throw. */
  flings?: number;
  /**
   * A second round for armoured targets: fired instead of this weapon's
   * volley at anything with at least `heavyAt` armour (guard towers' armour-
   * piercing shells against tanks and mechs). It shares this weapon's range.
   */
  heavy?: WeaponDef;
  heavyAt?: number;
  /**
   * A close-quarters weapon (see MeleeDef and systems/melee.ts): it fires no
   * projectile but strikes what it's touching. Its `range` is measured from
   * the striker's edge to the target's, and `projectile` only sets how the
   * blow sounds.
   */
  melee?: MeleeDef;
  /** Times its damage against an energy shield (see shields.ts): Aegis's lances drain domes fast. */
  breaker?: number;
  /**
   * Lays frost where it lands, this much per hit (Rime; see frost.ts):
   * enemies on frosted ground slow right down, and the ground goes white.
   */
  frost?: number;
  /** Times its damage against anything standing on its enemies' frost (Rime's shard guns: frozen things shatter). */
  shatter?: number;
  /**
   * Picks its target from what its side's shatter guns (WeaponDef.shatter)
   * within this radius are shooting at, where the ground under it isn't
   * already deep in frost (Rime's freezer trucks: the slow and the shatter
   * land on the same thing). See systems/targeting.ts.
   */
  assists?: number;
  /**
   * Hacks what it hits (Cipher; see hacking.ts): an enemy vehicle it lands
   * on turns to the shooter's side for this many seconds, stops where it is
   * and fights whatever is near it, its old friends included. Such a weapon
   * only aims at vehicles it can turn.
   */
  hack?: number;
  /**
   * Lays haze where it lands, this much (Veil; see smoke.ts): shots through
   * it go wild, except its own side's.
   */
  smoke?: number;
  /**
   * Smoke only: lobs its canisters onto its own side's frontline units as
   * they close on the enemy, harmless screens this wide (radius) for them to
   * come on through, before shooting at the enemy (see systems/weapons.ts).
   */
  screens?: number;
  /**
   * Calls a strike down from orbit instead of firing a shot (Zenith; see
   * zenith.ts): a warning ring marks where it will land for `delay`
   * seconds, long enough for what's under it to scatter, then a beam comes
   * straight down and bursts with the weapon's damage and splash.
   */
  orbital?: { delay: number };
  /**
   * Fires this many shots at once in a ring all round the shooter, each
   * landing `range` out, instead of one at its target (the Leviathan's spine
   * volley). It still waits for a target in range before it lets go.
   */
  nova?: number;
  /**
   * The bearing off the unit's nose this fixed weapon points along, radians
   * counterclockwise (0 ahead, PI behind): with UnitDef.alternates the unit
   * turns its body to bring it to bear (see alternate.ts).
   */
  faces?: number;
}

/** A jamming field round a unit or building (Cipher; see hacking.ts). */
export interface JamDef {
  radius: number;
  /** How fast enemy weapons in it reload, as a share of their usual rate. */
  pace: number;
  /** Seconds between its pulses: each one jams what it reaches until the next. */
  every: number;
}

/**
 * An energy dome (Aegis; see shields.ts): a sphere round its emitter
 * that stops direct fire and missiles coming in from outside, soaking them
 * up until it collapses. Shots from inside go out freely, and lobbed shells
 * and flame fall straight through it.
 */
export interface ShieldDef {
  radius: number;
  /** How much it soaks up before it collapses. */
  hp: number;
  /** Hit points it builds back per second, once it's gone `rest` seconds without a hit. */
  regen: number;
  rest: number;
  /** Seconds a collapsed dome takes to come back up (at a third of its strength). */
  downTime: number;
}

/**
 * How a melee weapon lands its blows. The sim side is all physical: a blow
 * lands on what's within reach, a lunge carries the striker in, a knock
 * shoves the struck back, a sweep catches others beside the target. The
 * look (a claw swipe, a ram, a stomp) is the model's, keyed by `style`.
 */
export interface MeleeDef {
  /** How it looks and sounds: a blade or claw swinging across, a lunge or ram straight in, a stomp straight down. */
  style: 'swing' | 'thrust' | 'stomp';
  /**
   * How far it leaps or rams forward to land a blow, on top of its reach:
   * it strikes from that much further out and ends up against its target.
   */
  lunge?: number;
  /** How far a blow shoves the struck away, for one its own size (bigger ones move less, buildings not at all). */
  knock?: number;
  /** Radians either side of straight ahead a blow sweeps across, catching other enemies within reach there too. */
  sweep?: number;
  /** Most others a sweep can catch beside the target. */
  sweepMost?: number;
  /** Speed multiplier while closing on a target it can see but not yet reach: a charge. */
  charge?: number;
}

/**
 * A weapon on a mount of its own, beside a unit's main weapon (see
 * UnitDef.mounts): a tank's roof machine gun, a walker's flak pod, a
 * mech's claw. Each picks its own target and keeps its own cooldown, so a
 * unit can shoot a tank with its cannon while its machine gun works on
 * the infantry round it, or claw what's on it while its guns fire on.
 * Only the main weapon steers the unit: what it chases and where it stands.
 */
export interface WeaponMountDef {
  weapon: WeaponDef;
  /** Its mount's key in MOUNTS (see mounts.ts): where its turret, barrels and muzzles are. Without one, it fires from the unit's middle. */
  mount?: string;
  /** Turns to aim on its own (a turret, the default) rather than only firing where the hull points. */
  turret?: boolean;
  /** How fast it turns, radians per second (the unit's turret's rate by default). */
  turnRate?: number;
}

export interface UnitDef {
  id: string;
  name: string;
  class: UnitClass;
  /** Which unit cap it counts against. */
  category: UnitCategory;
  /**
   * How much of that cap one takes (1 by default): a little mech that counts
   * as half a slot lets a doctrine field twice as many in the same cap, while
   * the cap stays one pool shared by every type in the category.
   */
  capCost?: number;
  /** How it gets around (see moveClasses.ts). */
  move: MoveClass;
  role: Role;
  /**
   * Support units only: how it tags along behind a frontline ally (see
   * systems/ai.ts). `alone`: it picks an ally no other unit of its own kind
   * is already following, so a few of them spread over the army instead of
   * bunching behind the same one. `trail`: how far behind it keeps (default
   * SUPPORT_TRAIL).
   */
  escorts?: { alone?: boolean; trail?: number };
  model: string;
  hp: number;
  /**
   * Taken off every hit (see applyDamage): small arms barely scratch heavy
   * armour, while big shells and rockets punch through. A hit always does
   * at least a tenth of its damage.
   */
  armor: number;
  speed: number;
  turnRate: number;
  radius: number;
  sight: number;
  /** Has a turret that aims independently of the hull. */
  turret: boolean;
  turretTurnRate: number;
  weapon: WeaponDef;
  /** More weapons, each on a mount of its own with its own target and cooldown (see WeaponMountDef). */
  mounts?: WeaponMountDef[];
  /** An energy dome it carries over itself and the units round it (Aegis; see ShieldDef). */
  shield?: ShieldDef;
  /** Keeps the ground round it frozen (Rime; see frost.ts): this much frost every second within the radius. */
  chill?: { radius: number; rate: number };
  /**
   * Jams the enemy weapons round it (Cipher; see hacking.ts): within the
   * radius they reload at `pace` of their usual rate.
   */
  jam?: JamDef;
  /** Breathes out haze round itself (Veil; see smoke.ts): this much every second within the radius. */
  smokes?: { radius: number; rate: number };
  /**
   * Fades from sight once it has gone `after` seconds without firing (Veil;
   * see smoke.ts): if `still`, only while it isn't moving; if `cover`, only
   * while it's in a forest, by a building or in its own side's haze; if
   * `haze`, in its own side's haze it stays out of sight even as it fires.
   */
  stealth?: { after: number; still?: boolean; cover?: boolean; haze?: boolean };
  /** Seconds a wreck stays on the field (0 = removed immediately). */
  wreckTime: number;
  /** Siege units shell buildings in sight before bothering with units. */
  siege: boolean;
  /**
   * Infantry it carries and drops off near the fight (see systems/carriers.ts):
   * the squad's line-up, and seconds between fresh squads (0 = just the one it
   * set out with).
   */
  carries?: { squad: { unit: string; count: number }[]; every: number };
  /** Spots for allies' long-range weapons, like a sensor mast (see BuildingDef.spots). */
  spots?: number;
  /** A builder (see commander/engineers.ts): it isn't part of the army, takes no cap and never joins an attack. */
  builds?: boolean;
  /**
   * Carries enough fuel to blow up when it's destroyed: hurts everything
   * round it, friend or foe, like a fuel depot, and leaves the ground burning (Firestorm).
   */
  explodes?: { damage: number; radius: number };
  /** A plane: it can't hover, so it never stops (see Mover.cruise), and attacks in runs over its target. */
  fixedWing?: boolean;
  /** Trigger pulls before it flies home to rearm (see the Ammo component). */
  ammo?: number;
  /**
   * Below this share of its health it breaks off from its squad and drives
   * straight at the nearest enemy, to take some of them with it when it goes up.
   */
  desperate?: number;
  /** A Hive fabricator: it chews wreckage round it into more units (see hive.ts). */
  eats?: EatsDef;
  /** A Nomad crawler (see nomad.ts): it sets up as this building, taking `time` seconds to unfold or pack up. */
  deploys?: { into: string; time: number };
  /**
   * A shield held up in front (Antiquity's shield walls): direct fire that
   * comes at it within `arc` radians of straight ahead loses `block` of its
   * damage. Lobbed shots, splash and blows land as usual.
   */
  frontShield?: { arc: number; block: number };
  /**
   * A clockwork toy (Tin Soldiers; see windup.ts): after `run` seconds of
   * marching and shooting it stops to wind itself up for `rewind` seconds,
   * and a hit taking `topple` of its health in one go can tip it over.
   */
  windUp?: { run: number; rewind: number; topple?: number };
  /** A Mirage hologram (see mirage.ts): its shots do no harm, and it fizzles out after about `lasts` seconds. */
  decoy?: { lasts: number };
  /** A Mirage projector (see mirage.ts): every `every` seconds it throws up `count` holograms, taking turns through `units`. */
  projects?: ProjectsDef;
  /** A Lodestar crane (see lodestar.ts): every this many seconds it drags the wrecks in reach into a scrap wall ahead of itself. */
  walls?: number;
  /**
   * Leviathan (see leviathan.ts): it eats the wrecks within `radius` (times
   * its size) at `rate` a second, growing `perWreck` in size for each
   * tank-sized wreck, from `from` up to `most` times its model's size, but
   * never more than `perMinute` a minute since it hatched.
   */
  grows?: { radius: number; rate: number; perWreck: number; from: number; most: number; perMinute: number };
  /**
   * Knows when to break off (see retreat.ts): below `below` of its health it
   * falls back to its base, fighting only what gets in its way, and mends
   * there at `mends` of its full health a second until it's back to `until`.
   */
  retreats?: RetreatDef;
  /**
   * Its weapons with a `faces` bearing point different ways, and it brings
   * them to bear in turn (see alternate.ts): it stops and swings round, at
   * `turnRate` radians a second, to face its target with whichever is ready.
   */
  alternates?: { turnRate: number };
}

/** When a unit falls back to mend, and how fast it mends at home (see UnitDef.retreats). */
export interface RetreatDef {
  below: number;
  until: number;
  mends: number;
}

/** What a Mirage projector throws up (see mirage.ts). */
export interface ProjectsDef {
  units: string[];
  count: number;
  every: number;
}

/** What a fabricator eats and makes (see hive.ts). */
export interface EatsDef {
  /** How far round itself it chews. */
  radius: number;
  /** Salvage it chews a second, in tank-sized wrecks. */
  rate: number;
  /** What it turns it into, taking turns: each batch costs `cost` of salvage. */
  makes: { unit: string; count: number; cost: number }[];
}

/** A weapon with the usual defaults filled in, for the units below that only change a few things. */
function weapon(w: Partial<WeaponDef> & Pick<WeaponDef, 'name' | 'range' | 'damage' | 'cooldown' | 'projectile'>): WeaponDef {
  return { minRange: 0, burst: 1, burstGap: 0.1, speed: 40, splash: 0, spread: 0.06, arc: false, muzzleHeight: 1, targets: 'ground', ...w };
}

/** A flamethrower: short, a burst of gouts that lick round corners, and splash. Never aircraft. */
function flamer(name: string, range: number, damage: number, burst: number, splash: number, muzzleHeight: number, cooldown = 1.6): WeaponDef {
  return weapon({ name, range, damage, cooldown, burst, burstGap: 0.08, projectile: 'flame', speed: 16, splash, spread: 0.1, muzzleHeight });
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

/** An AT trooper's rocket launcher (and a shade's). */
const rocketLauncher: WeaponDef = {
  // Slow, heavy rockets: they get through a tank's armour, but not much of a Titan's.
  name: 'Rocket launcher',
  range: 11,
  minRange: 0,
  damage: 40,
  cooldown: 4.5,
  burst: 1,
  burstGap: 0,
  projectile: 'missile',
  speed: 24,
  splash: 0.5,
  spread: 0.06,
  arc: false,
  muzzleHeight: 0.45,
  // Missiles are everyone's answer to aircraft (see the notes on air in the README).
  targets: 'both',
};

export const UNIT_DEFS = {
  trooper: {
    id: 'trooper',
    name: 'Trooper',
    class: 'infantry',
    category: 'infantry',
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
  atTrooper: {
    id: 'atTrooper',
    name: 'AT Trooper',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'frontline',
    model: 'atTrooper',
    hp: 20,
    armor: 0,
    speed: 1.6,
    turnRate: 6,
    radius: 0.3,
    sight: 14,
    turret: false,
    turretTurnRate: 6,
    weapon: rocketLauncher,
    wreckTime: 0,
    siege: false,
  },
  strider: {
    id: 'strider',
    name: 'Strider',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'strider',
    hp: 90,
    armor: 2,
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
      damage: 10,
      cooldown: 1.1,
      burst: 3,
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
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'tank',
    hp: 220,
    armor: 6,
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
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'titan',
    hp: 520,
    armor: 25,
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
    category: 'vehicle',
    move: 'tracked',
    role: 'artillery',
    model: 'howitzer',
    hp: 132,
    armor: 3,
    speed: 1.8,
    turnRate: 1.2,
    radius: 1.1,
    // Its own crew sees less far than it shoots: a sensor mast or Fortress Walker spots the rest.
    sight: 24,
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
  // Armour doctrine.
  lancer: {
    id: 'lancer',
    name: 'Lancer Heavy Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'lancer',
    hp: 385,
    armor: 8,
    speed: 2.0,
    turnRate: 1.3,
    radius: 1.25,
    sight: 19,
    turret: true,
    turretTurnRate: 1.5,
    weapon: {
      name: 'Heavy cannon',
      range: 17,
      minRange: 0,
      damage: 70,
      cooldown: 3.6,
      burst: 1,
      burstGap: 0,
      projectile: 'shell',
      speed: 36,
      splash: 1.6,
      spread: 0.04,
      arc: false,
      muzzleHeight: 1.15,
      targets: 'ground',
    },
    wreckTime: 25,
    siege: false,
  },
  // Raiders doctrine: fast trucks.
  mgTruck: {
    id: 'mgTruck',
    name: 'MG Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'frontline',
    model: 'mgTruck',
    hp: 130,
    armor: 2,
    speed: 4.4,
    turnRate: 3,
    radius: 0.8,
    sight: 16,
    turret: true,
    turretTurnRate: 5,
    weapon: {
      name: 'Heavy machine gun',
      range: 11,
      minRange: 0,
      damage: 7,
      cooldown: 1.2,
      burst: 6,
      burstGap: 0.08,
      projectile: 'bullet',
      speed: 60,
      splash: 0,
      spread: 0.07,
      arc: false,
      muzzleHeight: 1.1,
      // Truck-bed guns swing up at aircraft too.
      targets: 'both',
    },
    wreckTime: 15,
    siege: false,
  },
  buggy: {
    id: 'buggy',
    name: 'Scout Buggy',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'frontline',
    model: 'buggy',
    hp: 60,
    armor: 1,
    speed: 5.6,
    turnRate: 3.5,
    radius: 0.6,
    sight: 20,
    turret: true,
    turretTurnRate: 6,
    // One heavy recoilless round rather than a machine gun: it hits and runs, and it dents armour and buildings.
    weapon: weapon({ name: 'Recoilless rifle', range: 11, damage: 26, cooldown: 3.4, projectile: 'shell', speed: 45, splash: 0.4, spread: 0.05, muzzleHeight: 0.8, pierce: 0.3, targets: 'ground' }),
    wreckTime: 12,
    siege: false,
  },
  // Zenith: a light buggy with a machine gun that rides down in a drop pod with a squad (DoctrineDef.podRider).
  dropBuggy: {
    id: 'dropBuggy',
    name: 'Drop Buggy',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.5,
    move: 'wheeled',
    role: 'frontline',
    model: 'buggy',
    hp: 70,
    armor: 1,
    speed: 5.2,
    turnRate: 3.5,
    radius: 0.6,
    sight: 20,
    turret: true,
    turretTurnRate: 6,
    weapon: weapon({ name: 'Light machine gun', range: 10, damage: 5, cooldown: 1, burst: 4, burstGap: 0.08, projectile: 'bullet', speed: 60, spread: 0.08, muzzleHeight: 0.8 }),
    wreckTime: 12,
    siege: false,
  },
  rocketTruck: {
    id: 'rocketTruck',
    name: 'Rocket Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'artillery',
    model: 'rocketTruck',
    hp: 100,
    armor: 2,
    speed: 3.4,
    turnRate: 2,
    radius: 0.9,
    sight: 21,
    turret: true,
    turretTurnRate: 2,
    weapon: {
      // A ripple of heavy rockets: the Raiders' answer to buildings and super units.
      name: 'Rocket rack',
      range: 19,
      minRange: 5,
      damage: 42,
      cooldown: 8,
      burst: 4,
      burstGap: 0.15,
      projectile: 'missile',
      speed: 20,
      splash: 1.4,
      spread: 0.1,
      arc: true,
      muzzleHeight: 1.2,
      targets: 'ground',
    },
    wreckTime: 15,
    siege: true,
  },
  landTrain: {
    id: 'landTrain',
    name: 'Land-train',
    class: 'vehicle',
    category: 'super',
    move: 'tracked',
    role: 'frontline',
    model: 'landTrain',
    hp: 900,
    armor: 18,
    speed: 2.4,
    turnRate: 0.9,
    radius: 1.7,
    sight: 20,
    turret: true,
    turretTurnRate: 1.4,
    weapon: {
      name: 'Rocket batteries',
      range: 18,
      minRange: 0,
      damage: 30,
      cooldown: 3.5,
      burst: 4,
      burstGap: 0.2,
      projectile: 'missile',
      speed: 24,
      splash: 1.6,
      spread: 0.08,
      arc: false,
      muzzleHeight: 1.8,
      targets: 'ground',
    },
    wreckTime: 35,
    siege: true,
  },
  // Nobody's doctrine: the rail line trait's train (see rail.ts), put on the line for whoever holds a station.
  armouredTrain: {
    id: 'armouredTrain',
    name: 'Armoured Train',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'armouredTrain',
    hp: 1300,
    armor: 16,
    speed: 3.4,
    turnRate: 3,
    radius: 1.6,
    sight: 24,
    turret: true,
    turretTurnRate: 1.6,
    weapon: {
      name: 'Rail gun battery',
      range: 22,
      minRange: 0,
      damage: 30,
      cooldown: 3,
      burst: 2,
      burstGap: 0.3,
      projectile: 'shell',
      speed: 50,
      splash: 1.4,
      spread: 0.05,
      arc: false,
      muzzleHeight: 1.6,
      targets: 'ground',
    },
    wreckTime: 35,
    siege: false,
  },
  // Legion doctrine: infantry masses.
  mortar: {
    id: 'mortar',
    name: 'Mortar Team',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'artillery',
    model: 'mortar',
    hp: 20,
    armor: 0,
    speed: 1.4,
    turnRate: 6,
    radius: 0.3,
    sight: 22,
    turret: false,
    turretTurnRate: 6,
    weapon: {
      name: 'Mortar',
      range: 20,
      minRange: 6,
      damage: 20,
      cooldown: 5,
      burst: 1,
      burstGap: 0,
      projectile: 'artillery',
      speed: 14,
      splash: 2,
      spread: 0.1,
      arc: true,
      muzzleHeight: 0.4,
      targets: 'ground',
    },
    wreckTime: 0,
    siege: false,
  },
  lightTank: {
    id: 'lightTank',
    name: 'Light Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'lightTank',
    hp: 190,
    armor: 5,
    speed: 3,
    turnRate: 1.9,
    radius: 1,
    sight: 18,
    turret: true,
    turretTurnRate: 2.2,
    weapon: {
      name: 'Cannon',
      range: 14,
      minRange: 0,
      damage: 36,
      cooldown: 2.6,
      burst: 1,
      burstGap: 0,
      projectile: 'shell',
      speed: 32,
      splash: 1.2,
      spread: 0.05,
      arc: false,
      muzzleHeight: 0.9,
      targets: 'ground',
    },
    wreckTime: 22,
    siege: false,
  },
  carrier: {
    id: 'carrier',
    name: 'Squad Carrier',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'carrier',
    hp: 200,
    armor: 6,
    speed: 3.2,
    turnRate: 1.8,
    radius: 1.1,
    sight: 18,
    turret: true,
    turretTurnRate: 3,
    weapon: {
      name: 'Light autocannon',
      range: 11,
      minRange: 0,
      damage: 6,
      cooldown: 1,
      burst: 3,
      burstGap: 0.1,
      projectile: 'bullet',
      speed: 55,
      splash: 0.3,
      spread: 0.07,
      arc: false,
      muzzleHeight: 1.2,
      targets: 'ground',
    },
    wreckTime: 22,
    siege: false,
    carries: { squad: [{ unit: 'trooper', count: 4 }, { unit: 'atTrooper', count: 1 }], every: 60 },
  },
  siegeCrawler: {
    id: 'siegeCrawler',
    name: 'Siege Crawler',
    class: 'vehicle',
    category: 'super',
    move: 'tracked',
    role: 'frontline',
    model: 'siegeCrawler',
    hp: 1000,
    armor: 20,
    speed: 1.2,
    turnRate: 0.8,
    radius: 1.9,
    sight: 25,
    turret: true,
    turretTurnRate: 1,
    weapon: {
      name: 'Siege mortars',
      range: 24,
      minRange: 6,
      damage: 62,
      cooldown: 5,
      burst: 2,
      burstGap: 0.4,
      projectile: 'artillery',
      speed: 16,
      splash: 2.7,
      spread: 0.1,
      arc: true,
      muzzleHeight: 2.6,
      targets: 'ground',
    },
    wreckTime: 35,
    siege: true,
    carries: { squad: [{ unit: 'trooper', count: 4 }, { unit: 'atTrooper', count: 1 }], every: 40 },
  },
  // Armour's anti-air: flak that also scatters over infantry without blanketing a squad.
  flakTank: {
    id: 'flakTank',
    name: 'Flak Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'flakTank',
    hp: 150,
    armor: 5,
    speed: 2.6,
    turnRate: 1.6,
    radius: 1,
    sight: 18,
    turret: true,
    turretTurnRate: 2.6,
    weapon: {
      name: 'Twin flak cannon',
      range: 15,
      minRange: 0,
      damage: 10,
      cooldown: 2.4,
      burst: 4,
      burstGap: 0.15,
      projectile: 'shell',
      speed: 40,
      splash: 1.3,
      spread: 0.12,
      arc: false,
      muzzleHeight: 1.3,
      targets: 'both',
    },
    wreckTime: 20,
    siege: false,
  },
  // Every doctrine's light aircraft.
  scout: {
    id: 'scout',
    name: 'Scout Copter',
    class: 'aircraft',
    category: 'air',
    move: 'air',
    role: 'frontline',
    model: 'scout',
    hp: 90,
    armor: 1,
    speed: 5.5,
    turnRate: 2.6,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 4,
    weapon: {
      name: 'Chin gun',
      range: 9,
      minRange: 0,
      damage: 4,
      cooldown: 1.2,
      burst: 5,
      burstGap: 0.09,
      projectile: 'bullet',
      speed: 60,
      splash: 0,
      spread: 0.08,
      arc: false,
      muzzleHeight: 0.4,
      targets: 'both',
    },
    wreckTime: 8,
    siege: false,
  },
  // Skyline doctrine: aircraft.
  gunship: {
    id: 'gunship',
    name: 'Gunship',
    class: 'aircraft',
    category: 'air',
    move: 'air',
    role: 'frontline',
    model: 'gunship',
    hp: 190,
    armor: 3,
    speed: 4,
    turnRate: 1.8,
    radius: 1.1,
    sight: 20,
    turret: true,
    turretTurnRate: 2.6,
    weapon: {
      name: 'Rocket pods',
      range: 14,
      minRange: 0,
      damage: 20,
      cooldown: 4,
      burst: 4,
      burstGap: 0.18,
      projectile: 'missile',
      speed: 26,
      splash: 1,
      spread: 0.08,
      arc: false,
      muzzleHeight: 0.5,
      targets: 'ground',
    },
    wreckTime: 10,
    siege: false,
    ammo: 6,
  },
  bomber: {
    id: 'bomber',
    name: 'Bomber',
    class: 'aircraft',
    category: 'air',
    move: 'air',
    role: 'frontline',
    model: 'bomber',
    hp: 240,
    armor: 3,
    speed: 4.5,
    turnRate: 0.95,
    radius: 1.3,
    sight: 20,
    turret: true,
    turretTurnRate: 6,
    weapon: {
      name: 'Bombs',
      range: 3,
      minRange: 0,
      damage: 55,
      cooldown: 6,
      burst: 3,
      burstGap: 0.25,
      projectile: 'artillery',
      speed: 10,
      splash: 2.6,
      spread: 0.15,
      arc: true,
      muzzleHeight: 0.4,
      targets: 'ground',
    },
    wreckTime: 10,
    siege: true,
    fixedWing: true,
    ammo: 4,
  },
  // Skyline's fighter: fast, never stops, and strafes whatever it lines up on, in the air or on the ground.
  jet: {
    id: 'jet',
    name: 'Strike Jet',
    class: 'aircraft',
    category: 'air',
    move: 'air',
    role: 'frontline',
    model: 'jet',
    hp: 155,
    armor: 2,
    speed: 7.5,
    turnRate: 1.1,
    radius: 0.9,
    sight: 22,
    // Its guns point where it flies: it has to line up on what it shoots.
    turret: false,
    turretTurnRate: 1.1,
    weapon: weapon({ name: 'Nose cannons', range: 11, damage: 9, cooldown: 1.4, burst: 6, burstGap: 0.06, projectile: 'bullet', speed: 70, splash: 0.4, spread: 0.06, muzzleHeight: 0, targets: 'both' }),
    wreckTime: 8,
    siege: false,
    fixedWing: true,
    ammo: 10,
  },
  drone: {
    id: 'drone',
    name: 'Drone',
    class: 'aircraft',
    category: 'air',
    move: 'air',
    role: 'frontline',
    model: 'drone',
    hp: 60,
    armor: 0,
    speed: 6,
    turnRate: 3.2,
    radius: 0.5,
    sight: 16,
    turret: true,
    turretTurnRate: 5,
    weapon: {
      name: 'Drone gun',
      range: 8,
      minRange: 0,
      damage: 4,
      cooldown: 1,
      burst: 3,
      burstGap: 0.1,
      projectile: 'bullet',
      speed: 60,
      splash: 0,
      spread: 0.08,
      arc: false,
      muzzleHeight: 0.3,
      targets: 'both',
    },
    wreckTime: 6,
    siege: false,
  },
  flakWalker: {
    id: 'flakWalker',
    name: 'Flak Walker',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'flakWalker',
    hp: 220,
    armor: 6,
    speed: 2.2,
    turnRate: 1.6,
    radius: 1.1,
    sight: 20,
    turret: true,
    turretTurnRate: 2.4,
    weapon: {
      name: 'Quad flak',
      range: 17,
      minRange: 0,
      damage: 9,
      cooldown: 2.2,
      burst: 4,
      burstGap: 0.14,
      projectile: 'shell',
      speed: 40,
      splash: 1.1,
      spread: 0.1,
      arc: false,
      muzzleHeight: 2.2,
      targets: 'both',
    },
    wreckTime: 20,
    siege: false,
  },
  airship: {
    id: 'airship',
    name: 'Airship Carrier',
    class: 'aircraft',
    category: 'super',
    move: 'air',
    role: 'frontline',
    model: 'airship',
    hp: 1100,
    armor: 12,
    speed: 1.6,
    turnRate: 0.5,
    radius: 2.4,
    sight: 24,
    turret: true,
    turretTurnRate: 1.6,
    weapon: {
      name: 'Defence flak',
      range: 16,
      minRange: 0,
      damage: 14,
      cooldown: 3,
      burst: 3,
      burstGap: 0.15,
      projectile: 'shell',
      speed: 40,
      splash: 1.5,
      spread: 0.1,
      arc: false,
      muzzleHeight: 1.2,
      targets: 'both',
    },
    wreckTime: 30,
    siege: false,
    carries: { squad: [{ unit: 'drone', count: 3 }], every: 35 },
  },
  // Bastion: artillery and fortresses.
  railgun: {
    id: 'railgun',
    name: 'Railgun Battery',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'artillery',
    model: 'railgun',
    hp: 160,
    armor: 4,
    speed: 1.8,
    turnRate: 1.2,
    radius: 1.15,
    sight: 22,
    turret: true,
    turretTurnRate: 0.8,
    // Long, flat and hard: a slug that goes through a tank's armour from further than the tank can answer.
    weapon: weapon({ name: 'Railgun', range: 28, damage: 100, cooldown: 7, projectile: 'shell', speed: 90, splash: 0.4, spread: 0.02, muzzleHeight: 1.1 }),
    wreckTime: 25,
    siege: false,
  },
  fortress: {
    id: 'fortress',
    name: 'Fortress Walker',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'fortress',
    hp: 950,
    armor: 22,
    speed: 1.1,
    turnRate: 0.7,
    radius: 1.9,
    sight: 24,
    turret: true,
    turretTurnRate: 0.9,
    weapon: weapon({ name: 'Twin siege guns', range: 22, damage: 55, cooldown: 4, burst: 2, burstGap: 0.3, projectile: 'shell', speed: 34, splash: 1.8, spread: 0.05, muzzleHeight: 3.2 }),
    wreckTime: 35,
    siege: true,
    // A walking sensor mast: Bastion's guns reach their full range round it.
    spots: 26,
  },
  // Bastion's test variant (see DOCTRINES.bastionSpider): a giant spider carrying a siege howitzer.
  siegeSpider: {
    id: 'siegeSpider',
    name: 'Siege Spider',
    class: 'mech',
    category: 'super',
    move: 'climber',
    role: 'artillery',
    model: 'siegeSpider',
    hp: 1000,
    armor: 18,
    speed: 1.3,
    turnRate: 0.8,
    radius: 2.1,
    sight: 26,
    turret: true,
    turretTurnRate: 0.8,
    weapon: weapon({ name: 'Siege howitzer', range: 38, minRange: 9, damage: 95, cooldown: 7, burst: 2, burstGap: 0.7, projectile: 'artillery', speed: 17, splash: 3.6, spread: 0.08, arc: true, muzzleHeight: 3.6 }),
    wreckTime: 35,
    siege: true,
    // Up on its legs it sees for its own gun, and for the howitzers round it.
    spots: 30,
  },
  // Talon: walkers.
  spider: {
    id: 'spider',
    name: 'Spider Walker',
    class: 'mech',
    category: 'vehicle',
    move: 'climber',
    role: 'frontline',
    model: 'spider',
    hp: 105,
    armor: 3,
    speed: 3.2,
    turnRate: 3,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 4,
    weapon: weapon({ name: 'Twin machine guns', range: 11, damage: 7, cooldown: 0.9, burst: 4, burstGap: 0.08, projectile: 'bullet', speed: 60, splash: 0.2, spread: 0.07, muzzleHeight: 0.9, targets: 'both' }),
    wreckTime: 18,
    siege: false,
  },
  warhound: {
    id: 'warhound',
    name: 'Warhound',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'warhound',
    hp: 305,
    armor: 8,
    speed: 2.4,
    turnRate: 1.6,
    radius: 1.3,
    sight: 19,
    turret: true,
    turretTurnRate: 1.6,
    weapon: weapon({ name: 'Arm cannons', range: 16, damage: 46, cooldown: 3.4, burst: 2, burstGap: 0.25, projectile: 'shell', speed: 34, splash: 1.4, spread: 0.05, muzzleHeight: 2 }),
    wreckTime: 25,
    siege: false,
  },
  juggernaut: {
    id: 'juggernaut',
    name: 'Juggernaut',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'juggernaut',
    hp: 1200,
    armor: 22,
    speed: 1.3,
    turnRate: 0.8,
    radius: 2,
    sight: 24,
    turret: true,
    turretTurnRate: 1,
    weapon: weapon({ name: 'Heavy missile racks', range: 20, damage: 40, cooldown: 4.5, burst: 3, burstGap: 0.2, projectile: 'missile', speed: 22, splash: 1.6, spread: 0.08, muzzleHeight: 4, targets: 'both' }),
    wreckTime: 35,
    siege: true,
  },
  // Tidewater: hovers and boats.
  skimmer: {
    id: 'skimmer',
    name: 'Skimmer',
    class: 'vehicle',
    category: 'vehicle',
    move: 'hover',
    role: 'frontline',
    model: 'skimmer',
    hp: 145,
    armor: 4,
    speed: 4.2,
    turnRate: 2.4,
    radius: 0.95,
    sight: 18,
    turret: true,
    turretTurnRate: 2.5,
    weapon: weapon({ name: 'Light cannon', range: 13, damage: 26, cooldown: 1.6, projectile: 'shell', speed: 40, splash: 0.8, spread: 0.06, muzzleHeight: 0.8 }),
    wreckTime: 18,
    siege: false,
  },
  missileBoat: {
    id: 'missileBoat',
    name: 'Missile Boat',
    class: 'vehicle',
    category: 'vehicle',
    move: 'naval',
    role: 'frontline',
    model: 'missileBoat',
    hp: 220,
    armor: 4,
    speed: 3.4,
    turnRate: 1.4,
    radius: 1.2,
    sight: 26,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Missile rack', range: 21, damage: 32, cooldown: 4, burst: 2, burstGap: 0.25, projectile: 'missile', speed: 26, splash: 1, spread: 0.06, muzzleHeight: 1, targets: 'both' }),
    wreckTime: 15,
    siege: false,
  },
  amphib: {
    id: 'amphib',
    name: 'Amphibious Transport',
    class: 'vehicle',
    category: 'vehicle',
    move: 'amphibious',
    role: 'frontline',
    model: 'amphib',
    hp: 200,
    armor: 5,
    speed: 2.8,
    turnRate: 1.6,
    radius: 1.2,
    sight: 18,
    turret: true,
    turretTurnRate: 3,
    weapon: weapon({ name: 'Pintle gun', range: 11, damage: 6, cooldown: 1, burst: 3, projectile: 'bullet', speed: 55, splash: 0.3, spread: 0.07, muzzleHeight: 1.2, targets: 'both' }),
    wreckTime: 20,
    siege: false,
    carries: { squad: [{ unit: 'trooper', count: 4 }, { unit: 'atTrooper', count: 1 }], every: 60 },
  },
  hoverFortress: {
    id: 'hoverFortress',
    name: 'Hover Fortress',
    class: 'vehicle',
    category: 'super',
    move: 'hover',
    role: 'frontline',
    model: 'hoverFortress',
    hp: 850,
    armor: 18,
    speed: 1.7,
    turnRate: 0.8,
    radius: 2.1,
    sight: 24,
    turret: true,
    turretTurnRate: 1.2,
    weapon: weapon({ name: 'Missile batteries', range: 20, damage: 27, cooldown: 5, burst: 4, burstGap: 0.18, projectile: 'missile', speed: 24, splash: 1.5, spread: 0.08, muzzleHeight: 2.2, targets: 'both' }),
    wreckTime: 30,
    siege: true,
  },
  // Tidewater's second super unit: a battleship from the dock that steams in and shells the coast.
  // It's too broad in the beam for the canals, so it keeps to open water and leaves those to the missile boats.
  dreadnought: {
    id: 'dreadnought',
    name: 'Dreadnought',
    class: 'vehicle',
    category: 'super',
    move: 'naval',
    role: 'frontline',
    model: 'dreadnought',
    hp: 900,
    armor: 20,
    speed: 1.5,
    turnRate: 0.5,
    radius: 2.0,
    sight: 28,
    turret: true,
    turretTurnRate: 0.9,
    weapon: weapon({ name: 'Twin deck guns', range: 20, minRange: 5, damage: 60, cooldown: 5.5, burst: 2, burstGap: 0.35, projectile: 'shell', speed: 34, splash: 2.2, spread: 0.07, arc: true, muzzleHeight: 1.6 }),
    wreckTime: 30,
    siege: true,
    // From its fighting top it sees for its own guns.
    spots: 26,
  },
  // Firestorm: flamethrowers.
  flameTrooper: {
    id: 'flameTrooper',
    name: 'Flame Trooper',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'frontline',
    model: 'flameTrooper',
    hp: 45,
    armor: 1,
    speed: 1.8,
    turnRate: 6,
    radius: 0.3,
    sight: 12,
    turret: false,
    turretTurnRate: 6,
    weapon: flamer('Flamethrower', 6.5, 6, 5, 1.1, 0.4, 1.2),
    wreckTime: 0,
    siege: false,
    explodes: { damage: 30, radius: 2 },
    desperate: 0.35,
  },
  scorchBuggy: {
    id: 'scorchBuggy',
    name: 'Scorch Buggy',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'frontline',
    model: 'scorchBuggy',
    hp: 140,
    armor: 3,
    speed: 4.6,
    turnRate: 2.6,
    radius: 0.85,
    sight: 16,
    turret: true,
    turretTurnRate: 4,
    weapon: flamer('Flame projector', 7, 8, 5, 1.1, 0.9),
    wreckTime: 15,
    siege: false,
    explodes: { damage: 60, radius: 3 },
    desperate: 0.35,
  },
  cinderWalker: {
    id: 'cinderWalker',
    name: 'Cinder Walker',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'cinderWalker',
    hp: 350,
    armor: 8,
    speed: 2.2,
    turnRate: 1.8,
    radius: 1.2,
    sight: 16,
    turret: true,
    turretTurnRate: 2,
    weapon: flamer('Twin flame lances', 9, 14.7, 6, 1.2, 1.8, 2),
    wreckTime: 25,
    siege: false,
    explodes: { damage: 100, radius: 3.5 },
    desperate: 0.3,
  },
  inferno: {
    id: 'inferno',
    name: 'Inferno Walker',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'inferno',
    hp: 1100,
    armor: 20,
    speed: 1.3,
    turnRate: 0.8,
    radius: 1.9,
    sight: 20,
    turret: true,
    turretTurnRate: 1.2,
    weapon: flamer('Inferno projectors', 10, 22, 8, 1.6, 3, 3.5),
    wreckTime: 35,
    siege: true,
    explodes: { damage: 220, radius: 5 },
    desperate: 0.25,
  },
  // Every doctrine's builder (see commander/engineers.ts): its base's HQ trains one when the Commander has work for it.
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'support',
    model: 'engineer',
    hp: 30,
    armor: 0,
    speed: 1.7,
    turnRate: 6,
    radius: 0.3,
    sight: 12,
    turret: false,
    turretTurnRate: 6,
    weapon: { ...rifle, name: 'Sidearm', damage: 2, range: 8 },
    wreckTime: 0,
    siege: false,
    builds: true,
  },
  // Aegis: energy domes (see shields.ts).
  domeTruck: {
    id: 'domeTruck',
    name: 'Dome Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'support',
    model: 'domeTruck',
    hp: 170,
    armor: 4,
    speed: 3,
    turnRate: 2.4,
    radius: 0.9,
    sight: 18,
    turret: true,
    turretTurnRate: 4,
    weapon: weapon({ name: 'Pintle gun', range: 11, damage: 5, cooldown: 1.1, burst: 3, projectile: 'bullet', speed: 55, splash: 0.2, spread: 0.07, muzzleHeight: 1.3, targets: 'both' }),
    // Each dome truck keeps right behind a tank of its own, so the domes cover the army rather than each other.
    escorts: { alone: true, trail: 0.5 },
    shield: { radius: 6, hp: 260, regen: 22, rest: 3, downTime: 10 },
    wreckTime: 15,
    siege: false,
  },
  lanceWalker: {
    id: 'lanceWalker',
    name: 'Lance Walker',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'lanceWalker',
    hp: 150,
    armor: 5,
    speed: 2.9,
    turnRate: 2.4,
    radius: 0.9,
    sight: 19,
    turret: true,
    turretTurnRate: 2.6,
    // A straight, fast beam that bores through armour and drains enemy domes fast.
    weapon: weapon({ name: 'Lance', range: 15, damage: 30, cooldown: 2.6, projectile: 'beam', speed: 90, spread: 0.03, muzzleHeight: 1.8, pierce: 0.6, breaker: 2.5 }),
    wreckTime: 20,
    siege: false,
  },
  citadel: {
    id: 'citadel',
    name: 'Citadel',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'citadel',
    hp: 950,
    armor: 18,
    speed: 1.3,
    turnRate: 0.8,
    radius: 2,
    sight: 22,
    turret: true,
    turretTurnRate: 1.1,
    weapon: weapon({ name: 'Twin lances', range: 18, damage: 50, cooldown: 3.6, burst: 2, burstGap: 0.3, projectile: 'beam', speed: 90, spread: 0.03, muzzleHeight: 3.4, pierce: 0.5, breaker: 2.5 }),
    // A dome over itself and the army round it.
    shield: { radius: 10, hp: 900, regen: 35, rest: 4, downTime: 14 },
    wreckTime: 35,
    siege: true,
  },
  // Rime: frost (see frost.ts).
  cryoTrooper: {
    id: 'cryoTrooper',
    name: 'Cryo Trooper',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'frontline',
    model: 'cryoTrooper',
    hp: 40,
    armor: 1,
    speed: 1.7,
    turnRate: 6,
    radius: 0.3,
    sight: 13,
    turret: false,
    turretTurnRate: 6,
    weapon: weapon({ name: 'Cryo sprayer', range: 9, damage: 7, cooldown: 1.4, burst: 3, burstGap: 0.1, projectile: 'frost', speed: 22, splash: 0.8, spread: 0.08, muzzleHeight: 0.4, frost: 1.5 }),
    wreckTime: 0,
    siege: false,
  },
  freezerTruck: {
    id: 'freezerTruck',
    name: 'Freezer Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'artillery',
    model: 'freezerTruck',
    hp: 130,
    armor: 3,
    speed: 3.2,
    turnRate: 2.4,
    radius: 0.9,
    sight: 18,
    turret: true,
    turretTurnRate: 2.5,
    // Lobs canisters of coolant that burst into a wide white patch: the shard tanks' work is done on it,
    // so it freezes what they're shooting at.
    weapon: weapon({ name: 'Frost mortar', range: 19, minRange: 4, damage: 14, cooldown: 3.4, projectile: 'frost', speed: 16, splash: 3.2, spread: 0.08, arc: true, muzzleHeight: 1.2, frost: 6, assists: 22 }),
    wreckTime: 15,
    siege: false,
  },
  shardTank: {
    id: 'shardTank',
    name: 'Shard Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'shardTank',
    hp: 220,
    armor: 6,
    speed: 2.7,
    turnRate: 1.7,
    radius: 1.05,
    sight: 18,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Shard cannon', range: 15, damage: 40, cooldown: 2.6, projectile: 'shell', speed: 40, splash: 0.7, spread: 0.05, muzzleHeight: 1, shatter: 1.8, frost: 0.5 }),
    wreckTime: 25,
    siege: false,
  },
  glacier: {
    id: 'glacier',
    name: 'Glacier',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'glacier',
    hp: 1150,
    armor: 20,
    speed: 1.25,
    turnRate: 0.8,
    radius: 2,
    sight: 22,
    turret: true,
    turretTurnRate: 1,
    weapon: weapon({ name: 'Shard cannons', range: 18, damage: 44, cooldown: 4, burst: 2, burstGap: 0.3, projectile: 'shell', speed: 40, splash: 1.3, spread: 0.06, muzzleHeight: 3, shatter: 1.8, frost: 2 }),
    // The cold rolls off it: everything round it walks on ice.
    chill: { radius: 7, rate: 1.2 },
    wreckTime: 35,
    siege: true,
  },
  // Sabre: blade mechs. Each fights hand to hand with its main weapon and carries a gun
  // on a mount of its own, so it isn't helpless across a river or a tight crossing.
  duelist: {
    id: 'duelist',
    name: 'Duelist',
    class: 'mech',
    category: 'vehicle',
    // Little mechs: two to a vehicle slot, so Sabre fields packs of them instead of rifle squads.
    capCost: 0.5,
    move: 'walker',
    role: 'frontline',
    model: 'duelist',
    hp: 80,
    armor: 2,
    speed: 3.9,
    turnRate: 3.4,
    radius: 0.65,
    sight: 16,
    turret: true,
    turretTurnRate: 5,
    weapon: weapon({ name: 'Arm blade', range: 0.6, damage: 16, cooldown: 1.1, projectile: 'shell', speed: 1, muzzleHeight: 1.2, melee: { style: 'swing', lunge: 1, knock: 0.4, sweep: 0.9, sweepMost: 2, charge: 1.5 } }),
    mounts: [{ weapon: weapon({ name: 'Arm cannon', range: 10, damage: 4, cooldown: 1.3, burst: 3, burstGap: 0.1, projectile: 'bullet', speed: 60, spread: 0.08, muzzleHeight: 1.22, targets: 'both' }), mount: 'duelist#gun', turnRate: 5 }],
    wreckTime: 15,
    siege: false,
  },
  // A heavy tank whose turret is a great axe arm: it swings round with the turret and sweeps
  // across whatever it's up against. A machine gun in the hull does the ranged work.
  reaver: {
    id: 'reaver',
    name: 'Reaver',
    class: 'vehicle',
    category: 'vehicle',
    // A heavy: one and a half vehicle slots.
    capCost: 1.5,
    move: 'tracked',
    role: 'frontline',
    model: 'reaver',
    hp: 340,
    armor: 9,
    speed: 2.6,
    turnRate: 1.7,
    radius: 1.25,
    sight: 18,
    turret: true,
    turretTurnRate: 2.4,
    weapon: weapon({ name: 'Axe arm', range: 1.3, damage: 58, cooldown: 2.3, projectile: 'shell', speed: 1, muzzleHeight: 1.35, pierce: 0.4, melee: { style: 'swing', lunge: 1.2, knock: 1.4, sweep: 1.2, sweepMost: 3, charge: 1.35 } }),
    mounts: [{ weapon: weapon({ name: 'Hull machine gun', range: 11, damage: 5, cooldown: 1.2, burst: 4, burstGap: 0.09, projectile: 'bullet', speed: 60, spread: 0.07, muzzleHeight: 1.2, targets: 'both' }), mount: 'reaver#mg', turnRate: 3.5 }],
    wreckTime: 25,
    siege: false,
  },
  colossus: {
    id: 'colossus',
    name: 'Colossus',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'colossus',
    hp: 1250,
    armor: 20,
    speed: 1.4,
    turnRate: 0.9,
    radius: 2,
    sight: 22,
    turret: true,
    turretTurnRate: 1.1,
    // Hammers down round itself: everything close goes flying.
    weapon: weapon({ name: 'Hammer fists', range: 1.2, damage: 95, cooldown: 2.6, projectile: 'shell', speed: 1, muzzleHeight: 3.5, pierce: 0.3, melee: { style: 'stomp', lunge: 1.5, knock: 2.2, sweep: 3.14, sweepMost: 7, charge: 1.3 } }),
    mounts: [{ weapon: weapon({ name: 'Rocket rack', range: 18, damage: 30, cooldown: 4.5, burst: 4, burstGap: 0.15, projectile: 'missile', speed: 24, splash: 1.2, spread: 0.08, muzzleHeight: 5.2, targets: 'both' }), mount: 'colossus#rockets', turnRate: 1.4 }],
    wreckTime: 35,
    siege: true,
  },
  // Cipher: hacking. Its hack weapons turn an enemy vehicle to its side for a few seconds
  // (see hacking.ts), and its jammers slow the enemy guns round them.
  hackVan: {
    id: 'hackVan',
    name: 'Hack Van',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'support',
    model: 'hackVan',
    hp: 140,
    armor: 3,
    speed: 3.3,
    turnRate: 2.4,
    radius: 0.9,
    sight: 18,
    turret: true,
    turretTurnRate: 3,
    // A dish on the bed: it locks on to an enemy vehicle and turns it for a while.
    weapon: weapon({ name: 'Hack uplink', range: 13, damage: 0, cooldown: 10, projectile: 'hack', speed: 45, spread: 0, muzzleHeight: 1.5, hack: 6 }),
    mounts: [{ weapon: weapon({ name: 'Pintle gun', range: 10, damage: 4, cooldown: 1.1, burst: 3, projectile: 'bullet', speed: 55, splash: 0.2, spread: 0.07, muzzleHeight: 1.3, targets: 'both' }), mount: 'hackVan#gun', turnRate: 4 }],
    wreckTime: 15,
    siege: false,
  },
  // Cipher's anti-infantry: a soldier with a carbine and a drone on its back, which it sends up when
  // there's something to hunt, and readies another a while after.
  droneOperator: {
    id: 'droneOperator',
    name: 'Drone Operator',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'frontline',
    model: 'droneOperator',
    hp: 20,
    armor: 0,
    speed: 1.6,
    turnRate: 6,
    radius: 0.3,
    sight: 16,
    turret: false,
    turretTurnRate: 6,
    weapon: weapon({ ...rifle, name: 'Carbine', range: 9, damage: 3 }),
    carries: { squad: [{ unit: 'drone', count: 1 }], every: 60 },
    wreckTime: 0,
    siege: false,
  },
  jammer: {
    id: 'jammer',
    name: 'Jammer',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'jammer',
    hp: 170,
    armor: 5,
    speed: 2.8,
    turnRate: 2.2,
    radius: 0.9,
    sight: 17,
    turret: true,
    turretTurnRate: 2.6,
    weapon: weapon({ name: 'Twin guns', range: 13, damage: 9, cooldown: 1.4, burst: 2, burstGap: 0.15, projectile: 'bullet', speed: 55, splash: 0.3, spread: 0.06, muzzleHeight: 1.7 }),
    // Its mast sends out a pulse every few seconds: enemy guns it reaches reload slowly until the next.
    jam: { radius: 14, pace: 0.6, every: 3 },
    wreckTime: 15,
    siege: false,
  },
  overmind: {
    id: 'overmind',
    name: 'Overmind',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'overmind',
    hp: 1000,
    armor: 18,
    speed: 1.3,
    turnRate: 0.9,
    radius: 2,
    sight: 22,
    turret: true,
    turretTurnRate: 1.1,
    weapon: weapon({ name: 'Twin cannons', range: 18, damage: 40, cooldown: 3.6, burst: 2, burstGap: 0.3, projectile: 'shell', speed: 40, splash: 1.3, spread: 0.06, muzzleHeight: 3.3 }),
    // A hack array on its back turns enemy vehicles for longer than the trucks do, and often.
    mounts: [{ weapon: weapon({ name: 'Hack array', range: 16, damage: 0, cooldown: 6, projectile: 'hack', speed: 45, spread: 0, muzzleHeight: 4.8, hack: 8 }), mount: 'overmind#array', turnRate: 2 }],
    jam: { radius: 13, pace: 0.6, every: 3 },
    // And a rack of drones, sent up when it meets the enemy and readied again a while later.
    carries: { squad: [{ unit: 'drone', count: 2 }], every: 60 },
    wreckTime: 35,
    siege: true,
  },
  // Veil: haze and stealth (see smoke.ts). Shots through its haze go wild, except Veil's own, and
  // its shades and ghost tanks fade from sight when they hold their fire.
  shadeTrooper: {
    id: 'shadeTrooper',
    name: 'Shade',
    class: 'infantry',
    category: 'infantry',
    move: 'foot',
    role: 'frontline',
    model: 'shadeTrooper',
    hp: 20,
    armor: 0,
    speed: 1.6,
    turnRate: 6,
    radius: 0.3,
    sight: 14,
    turret: false,
    turretTurnRate: 6,
    // An AT trooper that hides: rockets for the armour it creeps up on unseen.
    weapon: rocketLauncher,
    // In a forest, by a building or in Veil's haze, and holding its fire, it's gone, moving or not.
    stealth: { after: 2, cover: true },
    wreckTime: 0,
    siege: false,
  },
  smokeTruck: {
    id: 'smokeTruck',
    name: 'Smoke Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'artillery',
    model: 'smokeTruck',
    hp: 130,
    armor: 3,
    speed: 3.2,
    turnRate: 2.4,
    radius: 0.9,
    sight: 18,
    turret: true,
    turretTurnRate: 2.5,
    // Lobs smoke canisters onto its own tanks as they close on the enemy, a screen they come on through:
    // shots into the haze go wild, Veil's own don't, and ghost tanks in it stay out of sight even as they fire.
    weapon: weapon({ name: 'Smoke mortar', range: 20, minRange: 4, damage: 10, cooldown: 3.5, projectile: 'artillery', speed: 16, splash: 2.6, spread: 0.08, arc: true, muzzleHeight: 1.2, smoke: 7, screens: 3.2 }),
    wreckTime: 15,
    siege: false,
  },
  ghostTank: {
    id: 'ghostTank',
    name: 'Ghost Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'ghostTank',
    hp: 200,
    armor: 6,
    speed: 2.8,
    turnRate: 1.7,
    radius: 1.05,
    sight: 18,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Cannon', range: 15, damage: 45, cooldown: 3, projectile: 'shell', speed: 40, splash: 0.8, spread: 0.05, muzzleHeight: 1, pierce: 0.2 }),
    // Gone from sight a few seconds after its last shot.
    stealth: { after: 3, haze: true },
    wreckTime: 25,
    siege: false,
  },
  eclipse: {
    id: 'eclipse',
    name: 'Eclipse',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'eclipse',
    hp: 1150,
    armor: 18,
    speed: 1.3,
    turnRate: 0.9,
    radius: 2,
    sight: 22,
    turret: true,
    turretTurnRate: 1.1,
    weapon: weapon({ name: 'Twin cannons', range: 18, damage: 48, cooldown: 3.6, burst: 2, burstGap: 0.3, projectile: 'shell', speed: 40, splash: 1.3, spread: 0.06, muzzleHeight: 3.3 }),
    // Smoke pours off it: it's too big to hide in it, but what walks with it isn't.
    smokes: { radius: 8, rate: 1.4 },
    wreckTime: 35,
    siege: true,
  },
  // Zenith: drops and orbital strikes (see zenith.ts). Its squads come down in pods by its beacon runners,
  // and its uplinks call strikes that land after a warning ring.
  beaconRunner: {
    id: 'beaconRunner',
    name: 'Beacon Runner',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.35,
    move: 'tracked',
    role: 'support',
    model: 'beaconRunner',
    hp: 100,
    armor: 2,
    speed: 4.6,
    turnRate: 3.2,
    radius: 0.65,
    sight: 20,
    turret: true,
    turretTurnRate: 4,
    weapon: weapon({ name: 'Pintle gun', range: 10, damage: 4, cooldown: 1.1, burst: 3, projectile: 'bullet', speed: 55, spread: 0.08, muzzleHeight: 0.9, targets: 'both' }),
    wreckTime: 10,
    siege: false,
  },
  uplinkTruck: {
    id: 'uplinkTruck',
    name: 'Uplink Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'artillery',
    model: 'uplinkTruck',
    hp: 170,
    armor: 4,
    speed: 2.8,
    turnRate: 2.2,
    radius: 0.95,
    sight: 18,
    turret: true,
    turretTurnRate: 2,
    // A targeting laser paints the ground, and a few seconds later a beam comes down from orbit.
    weapon: weapon({ name: 'Orbital uplink', range: 24, minRange: 5, damage: 120, cooldown: 8, projectile: 'orbital', speed: 1, splash: 3.6, spread: 0.04, muzzleHeight: 2.6, orbital: { delay: 2.4 } }),
    wreckTime: 15,
    siege: false,
  },
  lancePlatform: {
    id: 'lancePlatform',
    name: 'Lance Platform',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'artillery',
    model: 'lancePlatform',
    hp: 1100,
    armor: 18,
    speed: 1.1,
    turnRate: 0.8,
    radius: 2,
    sight: 22,
    turret: true,
    turretTurnRate: 0.9,
    // Heavy strikes on anything its beacon runners can see.
    weapon: weapon({ name: 'Orbital lance', range: 38, minRange: 6, damage: 160, cooldown: 6, projectile: 'orbital', speed: 1, splash: 5.5, spread: 0.04, muzzleHeight: 4.4, orbital: { delay: 3.2 } }),
    mounts: [{ weapon: weapon({ name: 'Point guns', range: 12, damage: 8, cooldown: 1.2, burst: 3, projectile: 'bullet', speed: 55, splash: 0.3, spread: 0.07, muzzleHeight: 2.4, targets: 'both' }), mount: 'lancePlatform#guns', turnRate: 3 }],
    wreckTime: 35,
    siege: true,
  },
  // Hive: a swarm grown from wreckage (see hive.ts).
  // Mites: knee-high biting bugs, three to an infantry slot. They swarm over walls and buildings.
  mite: {
    id: 'mite',
    name: 'Mite',
    class: 'infantry',
    category: 'infantry',
    capCost: 0.34,
    move: 'climber',
    role: 'frontline',
    model: 'mite',
    hp: 32,
    armor: 1,
    speed: 2.6,
    turnRate: 7,
    radius: 0.3,
    sight: 12,
    turret: false,
    turretTurnRate: 7,
    weapon: weapon({ name: 'Mandibles', range: 0.4, damage: 9, cooldown: 0.8, projectile: 'shell', speed: 1, muzzleHeight: 0.25, pierce: 0.3, melee: { style: 'thrust', lunge: 0.8, knock: 0.1, charge: 1.4 } }),
    wreckTime: 0,
    siege: false,
  },
  // A tiny spider mech with a gun on its back: the swarm's ranged support.
  gunMite: {
    id: 'gunMite',
    name: 'Gun Mite',
    class: 'mech',
    category: 'vehicle',
    capCost: 0.35,
    move: 'climber',
    role: 'frontline',
    model: 'gunMite',
    hp: 55,
    armor: 1,
    speed: 3,
    turnRate: 4,
    radius: 0.5,
    sight: 15,
    turret: true,
    turretTurnRate: 5,
    weapon: weapon({ name: 'Needle gun', range: 10, damage: 4, cooldown: 1, burst: 3, burstGap: 0.1, projectile: 'bullet', speed: 60, spread: 0.08, muzzleHeight: 0.6, targets: 'both' }),
    wreckTime: 8,
    siege: false,
  },
  // A slow armoured crawler that chews wrecks round it into mites and gun mites, right at the front.
  fabricator: {
    id: 'fabricator',
    name: 'Fabricator',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'support',
    model: 'fabricator',
    hp: 280,
    armor: 7,
    speed: 1.8,
    turnRate: 1.4,
    radius: 1.2,
    sight: 16,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Cutting arm', range: 1.2, damage: 30, cooldown: 1.8, projectile: 'shell', speed: 1, muzzleHeight: 0.9, pierce: 0.4, melee: { style: 'swing', lunge: 0.6, knock: 0.6, sweep: 1, sweepMost: 3 } }),
    eats: { radius: 8, rate: 0.35, makes: [{ unit: 'mite', count: 3, cost: 0.5 }, { unit: 'gunMite', count: 1, cost: 0.45 }, { unit: 'mite', count: 3, cost: 0.5 }] },
    wreckTime: 20,
    siege: false,
  },
  // A bloated bug that spits acid: lobbed globs on the ground, and up at aircraft.
  acidSpitter: {
    id: 'acidSpitter',
    name: 'Acid Spitter',
    class: 'mech',
    category: 'vehicle',
    move: 'climber',
    role: 'frontline',
    model: 'acidSpitter',
    hp: 140,
    armor: 3,
    speed: 2.6,
    turnRate: 2.4,
    radius: 0.9,
    sight: 18,
    turret: true,
    turretTurnRate: 3,
    weapon: weapon({ name: 'Acid glob', range: 15, damage: 14, cooldown: 1.6, burst: 2, burstGap: 0.25, projectile: 'acid', speed: 26, splash: 1.4, spread: 0.08, muzzleHeight: 1.1, pierce: 0.25, targets: 'both' }),
    wreckTime: 15,
    siege: false,
  },
  // The swarm's heavy: a great armoured beetle with crushing pincers.
  ravager: {
    id: 'ravager',
    name: 'Ravager',
    class: 'mech',
    category: 'vehicle',
    move: 'climber',
    role: 'frontline',
    model: 'ravager',
    hp: 370,
    armor: 11,
    speed: 2.4,
    turnRate: 1.8,
    radius: 1.3,
    sight: 16,
    turret: true,
    turretTurnRate: 2.4,
    weapon: weapon({ name: 'Pincers', range: 1.4, damage: 60, cooldown: 2, projectile: 'shell', speed: 1, muzzleHeight: 0.9, pierce: 0.5, melee: { style: 'swing', lunge: 1.2, knock: 1.2, sweep: 1.4, sweepMost: 3, charge: 1.4 } }),
    wreckTime: 25,
    siege: false,
  },
  // Super unit: a towering brood mother. Mites crawl off her back, and she eats wrecks as she goes.
  hiveMother: {
    id: 'hiveMother',
    name: 'Hive Mother',
    class: 'mech',
    category: 'super',
    move: 'climber',
    role: 'frontline',
    model: 'hiveMother',
    hp: 1150,
    armor: 15,
    speed: 1.4,
    turnRate: 0.9,
    radius: 1.6,
    sight: 22,
    turret: true,
    turretTurnRate: 1.2,
    weapon: weapon({ name: 'Acid spray', range: 16, damage: 15, cooldown: 1.6, burst: 4, burstGap: 0.15, projectile: 'acid', speed: 24, splash: 2, spread: 0.12, muzzleHeight: 2.8, pierce: 0.3, targets: 'both' }),
    carries: { squad: [{ unit: 'mite', count: 4 }], every: 22 },
    eats: { radius: 10, rate: 0.6, makes: [{ unit: 'mite', count: 4, cost: 0.6 }, { unit: 'gunMite', count: 2, cost: 0.8 }] },
    wreckTime: 40,
    siege: true,
  },
  // Nomad: a base that walks (see nomad.ts).
  // A huge, slow tracked factory rig: it drives out behind the army and sets up camp there.
  crawler: {
    id: 'crawler',
    name: 'Crawler',
    class: 'vehicle',
    category: 'vehicle',
    // Its numbers are kept by the crawler yard, not the cap (see nomad.ts).
    capCost: 0,
    move: 'tracked',
    role: 'support',
    model: 'crawler',
    hp: 800,
    armor: 12,
    speed: 1.4,
    turnRate: 0.7,
    radius: 2,
    sight: 18,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Twin machine guns', range: 13, damage: 6, cooldown: 1, burst: 5, burstGap: 0.08, projectile: 'bullet', speed: 60, spread: 0.07, muzzleHeight: 2.4, targets: 'both' }),
    deploys: { into: 'crawlerCamp', time: 15 },
    wreckTime: 40,
    siege: false,
  },
  // A fast raiding motorbike with a gunner riding pillion.
  outrider: {
    id: 'outrider',
    name: 'Outrider',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.5,
    move: 'wheeled',
    role: 'frontline',
    model: 'outrider',
    hp: 70,
    armor: 1,
    speed: 5.4,
    turnRate: 3.8,
    radius: 0.5,
    sight: 20,
    turret: true,
    turretTurnRate: 6,
    // Its pillion rider fires one rocket at a time, like an AT trooper: hit and run.
    weapon: weapon({ name: 'Pillion rocket', range: 11, damage: 34, cooldown: 4, projectile: 'missile', speed: 24, splash: 0.5, spread: 0.06, muzzleHeight: 1.0, targets: 'ground' }),
    wreckTime: 10,
    siege: false,
  },
  // Super unit: the Ark, a land-ship on six tracks with a battery of cannons, carrying a squad that it drops off at the fight.
  ark: {
    id: 'ark',
    name: 'Ark',
    class: 'vehicle',
    category: 'super',
    move: 'tracked',
    role: 'frontline',
    model: 'ark',
    hp: 1500,
    armor: 18,
    speed: 1.3,
    turnRate: 0.6,
    radius: 2.6,
    sight: 22,
    turret: true,
    turretTurnRate: 1,
    weapon: weapon({ name: 'Twin heavy cannon', range: 20, damage: 65, cooldown: 3.2, burst: 2, burstGap: 0.35, projectile: 'shell', speed: 42, splash: 1.6, spread: 0.04, muzzleHeight: 3.1, pierce: 0.4 }),
    mounts: [{ weapon: weapon({ name: 'Deck guns', range: 13, damage: 6, cooldown: 1, burst: 5, burstGap: 0.08, projectile: 'bullet', speed: 60, spread: 0.07, muzzleHeight: 2.6, targets: 'both' }), mount: 'ark#guns', turnRate: 4 }],
    carries: { squad: [{ unit: 'trooper', count: 4 }, { unit: 'atTrooper', count: 1 }], every: 25 },
    wreckTime: 45,
    siege: true,
  },
  // Antiquity (silly): an ancient army, Roman and Chinese, against tanks.
  // A legionary: a big rectangular shield in front and a short sword. Bullets from in front mostly glance off the shield.
  legionary: {
    id: 'legionary',
    name: 'Legionary',
    class: 'infantry',
    category: 'infantry',
    capCost: 0.5,
    move: 'foot',
    role: 'frontline',
    model: 'legionary',
    hp: 36,
    armor: 1,
    speed: 1.5,
    turnRate: 5,
    radius: 0.32,
    sight: 12,
    turret: false,
    turretTurnRate: 5,
    weapon: weapon({ name: 'Gladius', range: 0.5, damage: 8, cooldown: 1, projectile: 'shell', speed: 1, muzzleHeight: 0.8, melee: { style: 'thrust', lunge: 0.6, knock: 0.2, charge: 1.3 } }),
    frontShield: { arc: 1.1, block: 0.8 },
    wreckTime: 0,
    siege: false,
  },
  // A crossbowman with a repeating crossbow: a quick volley of bolts, even up at aircraft.
  crossbowman: {
    id: 'crossbowman',
    name: 'Crossbowman',
    class: 'infantry',
    category: 'infantry',
    capCost: 0.5,
    move: 'foot',
    role: 'frontline',
    model: 'crossbowman',
    hp: 20,
    armor: 0,
    speed: 1.6,
    turnRate: 6,
    radius: 0.3,
    sight: 13,
    turret: false,
    turretTurnRate: 6,
    weapon: weapon({ name: 'Repeating crossbow', range: 10, damage: 3, cooldown: 1.8, burst: 4, burstGap: 0.18, projectile: 'arrow', speed: 30, spread: 0.08, muzzleHeight: 0.9, targets: 'both' }),
    wreckTime: 0,
    siege: false,
  },
  // A ballista on a cart: a heavy bolt that goes through armour.
  ballista: {
    id: 'ballista',
    name: 'Ballista',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.6,
    move: 'wheeled',
    role: 'artillery',
    model: 'ballista',
    hp: 90,
    armor: 2,
    speed: 1.8,
    turnRate: 1.6,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 1.4,
    weapon: weapon({ name: 'Bolt thrower', range: 19, damage: 28, cooldown: 3.2, projectile: 'arrow', speed: 34, spread: 0.03, muzzleHeight: 0.9, pierce: 0.6 }),
    wreckTime: 12,
    siege: false,
  },
  // A trebuchet: it lobs a great stone a long way, slowly.
  trebuchet: {
    id: 'trebuchet',
    name: 'Trebuchet',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.7,
    move: 'wheeled',
    role: 'artillery',
    model: 'trebuchet',
    hp: 120,
    armor: 2,
    speed: 1.2,
    turnRate: 1,
    radius: 1.1,
    sight: 16,
    turret: true,
    turretTurnRate: 0.8,
    weapon: weapon({ name: 'Throwing arm', range: 30, minRange: 8, damage: 55, cooldown: 7, projectile: 'stone', speed: 16, splash: 2.4, spread: 0.1, arc: true, muzzleHeight: 3 }),
    wreckTime: 15,
    siege: true,
  },
  // A chariot: two horses and an archer, fast and flimsy.
  chariot: {
    id: 'chariot',
    name: 'Chariot',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.5,
    move: 'wheeled',
    role: 'frontline',
    model: 'chariot',
    hp: 70,
    armor: 1,
    speed: 4.6,
    turnRate: 3,
    radius: 0.7,
    sight: 18,
    turret: true,
    turretTurnRate: 5,
    weapon: weapon({ name: 'Bow', range: 11, damage: 6, cooldown: 1.2, burst: 2, burstGap: 0.3, projectile: 'arrow', speed: 30, spread: 0.07, muzzleHeight: 1.1 }),
    wreckTime: 8,
    siege: false,
  },
  // A hwacha: a cart that fires a whole rack of fire arrows at once.
  hwacha: {
    id: 'hwacha',
    name: 'Hwacha',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.6,
    move: 'wheeled',
    role: 'artillery',
    model: 'hwacha',
    hp: 80,
    armor: 1,
    speed: 1.8,
    turnRate: 1.6,
    radius: 0.8,
    sight: 16,
    turret: true,
    turretTurnRate: 1.4,
    weapon: weapon({ name: 'Fire arrow rack', range: 22, minRange: 5, damage: 9, cooldown: 9, burst: 12, burstGap: 0.06, projectile: 'missile', speed: 22, splash: 1.1, spread: 0.2, arc: true, muzzleHeight: 1 }),
    wreckTime: 10,
    siege: false,
  },
  // A war elephant: it tramples and tosses what it charges, with archers in the howdah on its back.
  warElephant: {
    id: 'warElephant',
    name: 'War Elephant',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'warElephant',
    hp: 420,
    armor: 5,
    speed: 2.2,
    turnRate: 1.6,
    radius: 1.2,
    sight: 16,
    turret: false,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Tusks', range: 1.2, damage: 40, cooldown: 2, projectile: 'shell', speed: 1, muzzleHeight: 1.2, pierce: 0.3, melee: { style: 'thrust', lunge: 1.4, knock: 2, sweep: 1, sweepMost: 4, charge: 1.6 } }),
    mounts: [{ weapon: weapon({ name: 'Howdah archers', range: 11, damage: 4, cooldown: 1.4, burst: 3, burstGap: 0.2, projectile: 'arrow', speed: 30, spread: 0.08, muzzleHeight: 3, targets: 'both' }), mount: 'warElephant#bows', turnRate: 4 }],
    wreckTime: 20,
    siege: false,
  },
  // A war kite: a great box kite with an archer slung under it, flown off a long line. Slow and flimsy.
  warKite: {
    id: 'warKite',
    name: 'War Kite',
    class: 'aircraft',
    category: 'air',
    move: 'air',
    role: 'frontline',
    model: 'warKite',
    hp: 60,
    armor: 0,
    speed: 3.6,
    turnRate: 2,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 4,
    weapon: weapon({ name: 'Bow', range: 10, damage: 5, cooldown: 1.3, burst: 2, burstGap: 0.3, projectile: 'arrow', speed: 30, spread: 0.08, muzzleHeight: 0.2, targets: 'both' }),
    wreckTime: 6,
    siege: false,
  },
  // Super unit: a giant bronze automaton with a great sword, ticking and clanking.
  bronzeColossus: {
    id: 'bronzeColossus',
    name: 'Bronze Colossus',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'bronzeColossus',
    hp: 1100,
    armor: 14,
    speed: 1.6,
    turnRate: 0.9,
    radius: 1.8,
    sight: 18,
    turret: true,
    turretTurnRate: 1.4,
    weapon: weapon({ name: 'Great sword', range: 2.4, damage: 72, cooldown: 2.6, projectile: 'shell', speed: 1, muzzleHeight: 3.4, pierce: 0.4, melee: { style: 'swing', lunge: 1.2, knock: 2.4, sweep: 2.4, sweepMost: 6, charge: 1.3 } }),
    wreckTime: 40,
    siege: true,
  },
  // Tin Soldiers (silly): clockwork toys that stop to wind themselves up, and tip over when hit (see windup.ts).
  tinSoldier: {
    id: 'tinSoldier',
    name: 'Tin Soldier',
    class: 'infantry',
    category: 'infantry',
    capCost: 0.5,
    move: 'foot',
    role: 'frontline',
    model: 'tinSoldier',
    hp: 34,
    armor: 1,
    speed: 1.5,
    turnRate: 5,
    radius: 0.3,
    sight: 13,
    turret: false,
    turretTurnRate: 5,
    weapon: weapon({ name: 'Cork rifle', range: 9, damage: 4, cooldown: 1.3, burst: 3, burstGap: 0.12, projectile: 'bullet', speed: 60, spread: 0.08, muzzleHeight: 0.8, targets: 'both' }),
    windUp: { run: 12, rewind: 3, topple: 0.25 },
    wreckTime: 0,
    siege: false,
  },
  // A tin tank with a big key in its back.
  clockworkTank: {
    id: 'clockworkTank',
    name: 'Clockwork Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'clockworkTank',
    hp: 250,
    armor: 7,
    speed: 2.8,
    turnRate: 1.8,
    radius: 1,
    sight: 17,
    turret: true,
    turretTurnRate: 2.2,
    weapon: weapon({ name: 'Tin cannon', range: 15, damage: 34, cooldown: 2.6, projectile: 'shell', speed: 40, splash: 0.9, spread: 0.04, muzzleHeight: 1.1, pierce: 0.3 }),
    windUp: { run: 16, rewind: 3.5, topple: 0.3 },
    wreckTime: 18,
    siege: false,
  },
  // A toy cannon on spoked wheels that lobs painted cannonballs.
  toyCannon: {
    id: 'toyCannon',
    name: 'Toy Cannon',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'artillery',
    model: 'toyCannon',
    hp: 120,
    armor: 3,
    speed: 2,
    turnRate: 1.6,
    radius: 0.8,
    sight: 16,
    turret: true,
    turretTurnRate: 1.4,
    weapon: weapon({ name: 'Toy mortar', range: 26, minRange: 6, damage: 40, cooldown: 5, projectile: 'artillery', speed: 16, splash: 2.2, spread: 0.1, arc: true, muzzleHeight: 0.9 }),
    windUp: { run: 18, rewind: 4, topple: 0.3 },
    wreckTime: 14,
    siege: true,
  },
  // A tin robot with sparking eyes and fists like hammers.
  tinRobot: {
    id: 'tinRobot',
    name: 'Tin Robot',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'tinRobot',
    hp: 300,
    armor: 7,
    speed: 2.2,
    turnRate: 2,
    radius: 0.9,
    sight: 16,
    turret: true,
    turretTurnRate: 3,
    weapon: weapon({ name: 'Ray eyes', range: 12, damage: 16, cooldown: 1.4, burst: 2, burstGap: 0.2, projectile: 'beam', speed: 90, spread: 0.04, muzzleHeight: 2.0, targets: 'both' }),
    windUp: { run: 14, rewind: 3.5, topple: 0.25 },
    wreckTime: 18,
    siege: false,
  },
  // Super unit: a towering clockwork giant with a huge key turning in its back.
  clockworkGiant: {
    id: 'clockworkGiant',
    name: 'Clockwork Giant',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'clockworkGiant',
    hp: 1000,
    armor: 15,
    speed: 1.6,
    turnRate: 1,
    radius: 1.9,
    sight: 20,
    turret: true,
    turretTurnRate: 1.2,
    weapon: weapon({ name: 'Chest cannon', range: 18, damage: 42, cooldown: 2.6, burst: 2, burstGap: 0.4, projectile: 'shell', speed: 40, splash: 1.8, spread: 0.05, muzzleHeight: 3.2, pierce: 0.4 }),
    windUp: { run: 25, rewind: 5 },
    wreckTime: 40,
    siege: true,
  },
  // Mirage: holograms that draw fire and fizzle (see mirage.ts).
  // Its main tank: a crystal prism on the turret that focuses a beam.
  prismTank: {
    id: 'prismTank',
    name: 'Prism Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'prismTank',
    hp: 200,
    armor: 6,
    speed: 2.8,
    turnRate: 1.7,
    radius: 1,
    sight: 18,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Prism cannon', range: 16, damage: 40, cooldown: 2.6, projectile: 'shell', speed: 42, splash: 0.7, spread: 0.04, muzzleHeight: 1.1, pierce: 0.4 }),
    wreckTime: 18,
    siege: false,
  },
  // Holograms: they move and shoot like the real thing, but their shots do no harm, and they fizzle out.
  holoPrism: {
    id: 'holoPrism',
    name: 'Prism Tank (hologram)',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0,
    move: 'tracked',
    role: 'frontline',
    model: 'prismTank',
    hp: 70,
    armor: 0,
    speed: 2.8,
    turnRate: 1.7,
    radius: 1,
    sight: 18,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Prism cannon', range: 16, damage: 0, cooldown: 2.6, projectile: 'shell', speed: 42, splash: 0.7, spread: 0.04, muzzleHeight: 1.1, pierce: 0.4 }),
    decoy: { lasts: 20 },
    wreckTime: 0,
    siege: false,
  },
  // A truck with a projector dish on a mast: it throws up a couple of hologram tanks every so often.
  projectorTruck: {
    id: 'projectorTruck',
    name: 'Projector Truck',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'support',
    model: 'projectorTruck',
    hp: 150,
    armor: 3,
    speed: 2.8,
    turnRate: 1.8,
    radius: 1,
    sight: 18,
    turret: true,
    turretTurnRate: 3,
    weapon: weapon({ name: 'Machine gun', range: 11, damage: 5, cooldown: 1, burst: 4, burstGap: 0.08, projectile: 'bullet', speed: 60, spread: 0.07, muzzleHeight: 1.6, targets: 'both' }),
    projects: { units: ['holoPrism'], count: 2, every: 15 },
    wreckTime: 15,
    siege: false,
  },
  // Super unit: the Fata Morgana, a tall walker crowned with mirrors, that throws up a whole column of holograms round itself.
  fataMorgana: {
    id: 'fataMorgana',
    name: 'Fata Morgana',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'fataMorgana',
    hp: 1300,
    armor: 15,
    speed: 1.5,
    turnRate: 0.9,
    radius: 1.8,
    sight: 22,
    turret: true,
    turretTurnRate: 1.2,
    weapon: weapon({ name: 'Mirror cannons', range: 20, damage: 58, cooldown: 3, burst: 2, burstGap: 0.3, projectile: 'shell', speed: 42, splash: 1.1, spread: 0.04, muzzleHeight: 3.8, pierce: 0.5 }),
    projects: { units: ['holoPrism'], count: 2, every: 14 },
    wreckTime: 40,
    siege: true,
  },
  // Verdant: a living army (see verdant.ts).
  // A strangler: a plant-mech on root legs that lashes vines, holding vehicles where they are.
  strangler: {
    id: 'strangler',
    name: 'Strangler',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'strangler',
    hp: 170,
    armor: 4,
    speed: 2.5,
    turnRate: 2.4,
    radius: 0.9,
    sight: 16,
    turret: true,
    turretTurnRate: 3,
    weapon: weapon({ name: 'Vine lash', range: 11, damage: 16, cooldown: 1.8, projectile: 'vine', speed: 40, spread: 0.04, muzzleHeight: 1.3, pierce: 0.3, tangle: 5 }),
    wreckTime: 14,
    siege: false,
  },
  // A seed mortar: a bulb on wheels that lobs seed pods. Where one bursts, a small thicket springs up.
  seedMortar: {
    id: 'seedMortar',
    name: 'Seed Mortar',
    class: 'vehicle',
    category: 'vehicle',
    move: 'wheeled',
    role: 'artillery',
    model: 'seedMortar',
    hp: 120,
    armor: 3,
    speed: 2.2,
    turnRate: 1.6,
    radius: 0.9,
    sight: 16,
    turret: true,
    turretTurnRate: 1.4,
    weapon: weapon({ name: 'Seed pod', range: 26, minRange: 6, damage: 34, cooldown: 5, projectile: 'seed', speed: 16, splash: 2, spread: 0.1, arc: true, muzzleHeight: 1.2, plants: 2.6 }),
    wreckTime: 14,
    siege: true,
  },
  // A graft walker: a heavy biotech walker with claw arms, slow and very tough, and a spine launcher on its back.
  graftWalker: {
    id: 'graftWalker',
    name: 'Graft Walker',
    class: 'mech',
    category: 'vehicle',
    move: 'walker',
    role: 'frontline',
    model: 'graftWalker',
    hp: 410,
    armor: 9,
    speed: 1.9,
    turnRate: 1.6,
    radius: 1.2,
    sight: 16,
    turret: true,
    turretTurnRate: 2,
    weapon: weapon({ name: 'Claw arms', range: 1.4, damage: 50, cooldown: 2.2, projectile: 'shell', speed: 1, muzzleHeight: 2, pierce: 0.4, melee: { style: 'swing', lunge: 1, knock: 1.6, sweep: 1.4, sweepMost: 4, charge: 1.4 } }),
    mounts: [{ weapon: weapon({ name: 'Spine launcher', range: 12, damage: 6, cooldown: 1.2, burst: 3, burstGap: 0.12, projectile: 'vine', speed: 40, spread: 0.07, muzzleHeight: 2.6, targets: 'both' }), mount: 'graftWalker#spines', turnRate: 4 }],
    wreckTime: 25,
    siege: false,
  },
  // Super unit: the Worldtree, a towering biotech walker. It lashes vines and seeds thickets round itself as it goes.
  worldTree: {
    id: 'worldTree',
    name: 'Worldtree',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'worldTree',
    hp: 1300,
    armor: 15,
    speed: 1.3,
    turnRate: 0.8,
    radius: 2,
    sight: 20,
    turret: true,
    turretTurnRate: 1.2,
    weapon: weapon({ name: 'Great vines', range: 14, damage: 40, cooldown: 1.6, burst: 2, burstGap: 0.3, projectile: 'vine', speed: 40, spread: 0.05, muzzleHeight: 4, pierce: 0.4, tangle: 5 }),
    mounts: [{ weapon: weapon({ name: 'Seed burst', range: 24, minRange: 6, damage: 40, cooldown: 6, projectile: 'seed', speed: 16, splash: 2.2, spread: 0.12, arc: true, muzzleHeight: 5, plants: 2.6 }), mount: 'worldTree#seeds', turnRate: 2 }],
    wreckTime: 45,
    siege: true,
  },
  // Lodestar: magnets and scrap (see lodestar.ts).
  // A magnet crane: it flings the wrecks lying round it, and drags heaps of them into scrap walls.
  magnetCrane: {
    id: 'magnetCrane',
    name: 'Magnet Crane',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'artillery',
    model: 'magnetCrane',
    hp: 190,
    armor: 5,
    speed: 2.2,
    turnRate: 1.4,
    radius: 1.1,
    sight: 18,
    turret: true,
    turretTurnRate: 1.6,
    weapon: weapon({ name: 'Scrap fling', range: 20, minRange: 4, damage: 50, cooldown: 4, projectile: 'scrap', speed: 18, splash: 1.6, spread: 0.08, arc: true, muzzleHeight: 3, pierce: 0.3, flings: 0.2 }),
    mounts: [{ weapon: weapon({ name: 'Machine gun', range: 11, damage: 5, cooldown: 1, burst: 4, burstGap: 0.08, projectile: 'bullet', speed: 60, spread: 0.07, muzzleHeight: 1.3, targets: 'both' }), mount: 'magnetCrane#mg', turnRate: 4 }],
    walls: 22,
    wreckTime: 18,
    siege: false,
  },
  // A coil tank: a magnetic coilgun that puts a slug straight through armour.
  coilTank: {
    id: 'coilTank',
    name: 'Coil Tank',
    class: 'vehicle',
    category: 'vehicle',
    move: 'tracked',
    role: 'frontline',
    model: 'coilTank',
    hp: 245,
    armor: 7,
    speed: 2.5,
    turnRate: 1.6,
    radius: 1.1,
    sight: 18,
    turret: true,
    turretTurnRate: 1.8,
    weapon: weapon({ name: 'Coilgun', range: 17, damage: 48, cooldown: 3, projectile: 'shell', speed: 80, spread: 0.03, muzzleHeight: 1.1, pierce: 0.6 }),
    wreckTime: 20,
    siege: false,
  },
  // Super unit: the Lodestone, a giant walker with a great magnet that rips up whole wrecks and hurls them.
  lodestone: {
    id: 'lodestone',
    name: 'Lodestone',
    class: 'mech',
    category: 'super',
    move: 'walker',
    role: 'frontline',
    model: 'lodestone',
    hp: 1300,
    armor: 16,
    speed: 1.4,
    turnRate: 0.9,
    radius: 1.9,
    sight: 22,
    turret: true,
    turretTurnRate: 1.2,
    weapon: weapon({ name: 'Wreck hurl', range: 24, minRange: 5, damage: 95, cooldown: 3.6, projectile: 'scrap', speed: 18, splash: 2.4, spread: 0.07, arc: true, muzzleHeight: 4.5, pierce: 0.4, flings: 0.3 }),
    mounts: [{ weapon: weapon({ name: 'Coilguns', range: 16, damage: 30, cooldown: 2, burst: 2, burstGap: 0.2, projectile: 'shell', speed: 80, spread: 0.04, muzzleHeight: 2.8, pierce: 0.5 }), mount: 'lodestone#coils', turnRate: 2.5 }],
    walls: 25,
    wreckTime: 45,
    siege: true,
  },
  // Leviathan (silly): one giant creature that grows by eating wrecks, and its cult (see leviathan.ts).
  leviathan: {
    id: 'leviathan',
    name: 'Leviathan',
    class: 'mech',
    category: 'super',
    move: 'amphibious',
    role: 'frontline',
    model: 'leviathan',
    hp: 2500,
    armor: 14,
    speed: 1.7,
    turnRate: 0.9,
    radius: 2.2,
    sight: 22,
    turret: false,
    turretTurnRate: 1.4,
    // Its tail whips round through everything behind it: it wheels round to lash it, then back to breathe fire (see alternate.ts).
    // The tail's long, so it reaches nearly three metres past its hide.
    weapon: weapon({ name: 'Tail whip', range: 2.8, damage: 50, cooldown: 2.4, projectile: 'shell', speed: 1, muzzleHeight: 1.7, pierce: 0.4, faces: Math.PI, melee: { style: 'swing', knock: 2.4, sweep: Math.PI * 0.6, sweepMost: 6, charge: 1.4 } }),
    alternates: { turnRate: 2.2 },
    // Besides the whip: fire breathed on what's in front of it (its head turns a little on its neck), a ring of spines
    // flung at what crowds it, and acid lobbed at what keeps its distance. All of them grow with it (see leviathan.ts).
    mounts: [
      { weapon: { ...flamer('Fire breath', 7, 12, 5, 1.3, 2.2, 5), faces: 0 }, mount: 'leviathan#head', turnRate: 1.4 },
      { weapon: weapon({ name: 'Spine volley', range: 7, damage: 16, cooldown: 9, projectile: 'spine', arc: true, speed: 18, splash: 0.8, spread: 0.05, muzzleHeight: 2.2, pierce: 0.3, nova: 12 }) },
      { weapon: weapon({ name: 'Acid pods', range: 18, minRange: 5, damage: 24, cooldown: 7, burst: 2, burstGap: 0.4, projectile: 'acid', arc: true, speed: 16, splash: 2, spread: 0.1, muzzleHeight: 2.6, pierce: 0.2 }) },
    ],
    grows: { radius: 9, rate: 0.6, perWreck: 0.07, from: 0.8, most: 1.8, perMinute: 0.09 },
    retreats: { below: 0.35, until: 0.9, mends: 0.012 },
    wreckTime: 60,
    siege: true,
  },
  // The cult's vehicles are whatever its faithful drove in on: weak, but enough to hold a line until the Leviathan has grown.
  // A rusty pickup with a scrap plate on the cab and a machine gun in the bed.
  pilgrimTruck: {
    id: 'pilgrimTruck',
    name: 'Pilgrim Truck',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.75,
    move: 'wheeled',
    role: 'frontline',
    model: 'pilgrimTruck',
    hp: 150,
    armor: 2,
    speed: 4.2,
    turnRate: 3,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 5,
    weapon: weapon({ name: 'Bed machine gun', range: 12, damage: 6, cooldown: 1.2, burst: 4, burstGap: 0.08, projectile: 'bullet', speed: 60, spread: 0.08, muzzleHeight: 1 }),
    wreckTime: 20,
    siege: false,
  },
  // A farm tractor with a whaling harpoon gun bolted to its bonnet: a slow, heavy shot for vehicles.
  harpoonTractor: {
    id: 'harpoonTractor',
    name: 'Harpoon Tractor',
    class: 'vehicle',
    category: 'vehicle',
    capCost: 0.75,
    move: 'wheeled',
    role: 'frontline',
    model: 'harpoonTractor',
    hp: 220,
    armor: 4,
    speed: 2.6,
    turnRate: 2,
    radius: 0.8,
    sight: 18,
    turret: true,
    turretTurnRate: 2.5,
    weapon: weapon({ name: 'Harpoon gun', range: 14, damage: 55, cooldown: 4.5, projectile: 'arrow', speed: 30, spread: 0.04, muzzleHeight: 1, pierce: 0.4 }),
    wreckTime: 20,
    siege: false,
  },
  // A cultist in a hooded robe with an old rifle.
  cultist: {
    id: 'cultist',
    name: 'Cultist',
    class: 'infantry',
    category: 'infantry',
    capCost: 0.5,
    move: 'foot',
    role: 'frontline',
    model: 'cultist',
    hp: 26,
    armor: 0,
    speed: 1.7,
    turnRate: 6,
    radius: 0.3,
    sight: 13,
    turret: false,
    turretTurnRate: 6,
    weapon: weapon({ name: 'Old rifle', range: 10, damage: 6, cooldown: 1.8, burst: 2, burstGap: 0.2, projectile: 'bullet', speed: 60, spread: 0.07, muzzleHeight: 0.8, targets: 'both' }),
    wreckTime: 0,
    siege: false,
  },
  // A zealot with a burning torch and a satchel charge: it runs at vehicles.
  zealot: {
    id: 'zealot',
    name: 'Zealot',
    class: 'infantry',
    category: 'infantry',
    capCost: 0.5,
    move: 'foot',
    role: 'frontline',
    model: 'zealot',
    hp: 26,
    armor: 0,
    speed: 2,
    turnRate: 6,
    radius: 0.3,
    sight: 13,
    turret: false,
    turretTurnRate: 6,
    weapon: weapon({ name: 'Satchel charge', range: 0.6, damage: 30, cooldown: 2.5, projectile: 'shell', speed: 1, muzzleHeight: 0.8, pierce: 0.5, melee: { style: 'thrust', lunge: 0.8, knock: 0.5, charge: 1.5 } }),
    wreckTime: 0,
    siege: false,
  },
} satisfies Record<string, UnitDef>;

export type UnitId = keyof typeof UNIT_DEFS;

export function unitDef(id: UnitId): UnitDef {
  return UNIT_DEFS[id];
}
