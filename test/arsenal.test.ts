import { describe, expect, it } from 'vitest';
import { Ai, Armed, Arsenal, Mover, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS, UnitDef, WeaponDef } from '../src/game/units';
import { armsOf, engaged, shootsAir, weaponsOf } from '../src/game/arsenal';
import { fightingStrength } from '../src/game/offensive';
import { MOUNTS } from '../src/game/mounts';
import { hashSeed } from '../src/core/rng';
import { settingsFromParams } from '../src/ui/settingsUrl';
import { Frame, SimHost, SimView } from '../src/sim/mirror';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function emptyGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

/** A roof machine gun that only shoots aircraft, on a pintle of its own on top of the tank's turret. */
const roofGun: WeaponDef = {
  name: 'Roof AA gun',
  range: 14,
  minRange: 0,
  damage: 5,
  cooldown: 0.8,
  burst: 3,
  burstGap: 0.1,
  projectile: 'bullet',
  speed: 60,
  splash: 0,
  spread: 0.05,
  arc: false,
  muzzleHeight: 1.6,
  targets: 'air',
};

// A test mount: a pintle above the turret, barrels that lift right up.
MOUNTS['test:roofGun'] = { turret: [-0.3, 1.5, 0], pivot: [0, 0.1, 0], muzzles: [[0.5, 0, 0]], elev: [-0.3, 1.4] };

const aaTank: UnitDef = { ...UNIT_DEFS.tank, mounts: [{ weapon: roofGun, mount: 'test:roofGun', turnRate: 4 }] };

describe('weapons on mounts of their own', () => {
  it('a unit with mounts gets an Arsenal of its own weapons, each with its mount', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, aaTank, 0, base.x, base.z);
    const arsenal = game.world.req(e, Arsenal);
    expect(arsenal.arms).toHaveLength(1);
    expect(arsenal.arms[0].weapon).toBe(roofGun);
    expect(arsenal.arms[0].mount).toBe('test:roofGun');
    expect(armsOf(game.world, e).map((a) => a.weapon.name)).toEqual(['Cannon', 'Roof AA gun']);
    expect(weaponsOf(aaTank)).toEqual([UNIT_DEFS.tank.weapon, roofGun]);
    // A plain tank has none.
    const plain = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x + 5, base.z);
    expect(game.world.has(plain, Arsenal)).toBe(false);
  });

  it('each weapon picks its own target and fires on its own cooldown', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const tank = spawnUnit(game.world, game.ctx, aaTank, 0, base.x, base.z);
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, base.x + 9, base.z + 2);
    const copter = spawnUnit(game.world, game.ctx, UNIT_DEFS.scout, 1, base.x + 6, base.z - 4);
    // Keep the copter where it is: it's a target, not a fighter.
    game.world.req(copter, Mover).speed = 0;
    let shells = 0;
    let bullets = 0;
    game.events.on('fired', (f) => {
      if (f.entity !== tank) return;
      if (f.kind === 'shell') shells++;
      if (f.kind === 'bullet') bullets++;
    });
    run(game, 0.6);
    const main = game.world.req(tank, Armed);
    const roof = game.world.req(tank, Arsenal).arms[0];
    expect(main.target).toBe(trooper);
    expect(roof.target).toBe(copter);
    run(game, 4);
    expect(shells).toBeGreaterThan(0);
    expect(bullets).toBeGreaterThan(shells);
  });

  it('counts every weapon: strength, anti-air and being in a fight', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const mounted = spawnUnit(game.world, game.ctx, aaTank, 0, base.x, base.z);
    const plain = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x + 4, base.z);
    expect(fightingStrength(game.world, mounted)).toBeGreaterThan(fightingStrength(game.world, plain));
    expect(shootsAir(game.world, mounted)).toBe(true);
    expect(shootsAir(game.world, plain)).toBe(false);
    expect(engaged(game.world, mounted)).toBe(false);
    game.world.req(mounted, Arsenal).arms[0].target = plain;
    expect(engaged(game.world, mounted)).toBe(true);
  });

  it('a fixed weapon on a mount of its own never turns the hull', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    // A fixed anti-air gun on a turret-less soldier: only the rifle, its main weapon, turns it.
    const soldier: UnitDef = { ...UNIT_DEFS.trooper, mounts: [{ weapon: roofGun, turret: false }] };
    const e = spawnUnit(game.world, game.ctx, soldier, 0, base.x, base.z);
    // Standing orders only: no AI to march it about or face it anywhere.
    game.world.remove(e, Ai);
    const heading = game.world.req(e, Transform).heading;
    // An aircraft behind it: the rifle can't shoot it, the fixed gun could if it faced it.
    const copter = spawnUnit(game.world, game.ctx, UNIT_DEFS.scout, 1, base.x - Math.cos(heading) * 8, base.z + Math.sin(heading) * 8);
    game.world.req(copter, Mover).speed = 0;
    // And a harmless one, so the soldier lives to be looked at.
    game.world.req(copter, Armed).cooldown = Infinity;
    run(game, 2);
    expect(game.world.req(e, Arsenal).arms[0].target).toBe(copter);
    expect(game.world.req(e, Armed).target).toBeNull();
    expect(Math.abs(game.world.req(e, Transform).heading - heading)).toBeLessThan(1e-9);
  });
});

describe('weapons on mounts of their own, on the page', () => {
  it('the page gets each weapon and its own aim', () => {
    const settings = settingsFromParams(new URLSearchParams('seed=arsenal'));
    const seed = hashSeed('arsenal');
    const host = new SimHost(seed, structuredClone(settings));
    const view = new Game(seed, { settings: structuredClone(settings), view: true });
    const sim = new SimView(view);
    const base = host.game.field.baseSites[0];
    const tank = spawnUnit(host.game.world, host.game.ctx, aaTank, 0, base.x, base.z);
    const exchange = (steps: number) => {
      host.step(steps, false);
      const { frame } = host.frame();
      sim.apply(structuredClone(frame) as Frame);
      sim.pose(frame.time);
    };
    exchange(1);
    host.game.world.req(tank, Arsenal).arms[0].aim = 1.25;
    exchange(1);
    exchange(1);
    const arms = view.world.req(tank, Arsenal).arms;
    expect(arms).toHaveLength(1);
    expect(arms[0].weapon.name).toBe('Roof AA gun');
    expect(arms[0].aim).toBeCloseTo(host.game.world.req(tank, Arsenal).arms[0].aim, 5);
  });
});
