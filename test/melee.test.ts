import { describe, expect, it } from 'vitest';
import { Ai, Armed, Health, Mover, Projectile, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { MeleeDef, UNIT_DEFS, UnitDef, WeaponDef } from '../src/game/units';
import { effectiveRange } from '../src/game/systems/targeting';
import { menace } from '../src/game/commander/threats';
import { CHARGE_CALL } from '../src/game/commander/charges';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function emptyGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

function claws(melee: MeleeDef, damage = 30): WeaponDef {
  return { name: 'Claws', range: 0.6, minRange: 0, damage, cooldown: 1, burst: 1, burstGap: 0, projectile: 'shell', speed: 1, splash: 0, spread: 0, arc: false, muzzleHeight: 1, targets: 'ground', melee };
}

/** A walker that fights with its claws. */
function brawler(melee: MeleeDef, damage?: number): UnitDef {
  return { ...UNIT_DEFS.strider, weapon: claws(melee, damage) };
}

/** A trooper that just stands there and takes it. */
function dummy(game: Game, x: number, z: number, def: UnitDef = UNIT_DEFS.trooper): number {
  const e = spawnUnit(game.world, game.ctx, def, 1, x, z);
  game.world.remove(e, Ai);
  game.world.req(e, Armed).cooldown = Infinity;
  return e;
}

describe('melee', () => {
  it('closes to contact and lands blows, without firing a shot', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, brawler({ style: 'swing' }), 0, base.x, base.z);
    const victim = dummy(game, base.x + 10, base.z);
    let blows = 0;
    let shots = 0;
    game.events.on('struck', (s) => s.entity === e && blows++);
    game.events.on('fired', (f) => f.entity === e && shots++);
    run(game, 8);
    expect(blows).toBeGreaterThan(0);
    expect(shots).toBe(0);
    expect(game.world.isAlive(victim) && game.world.has(victim, Health) ? game.world.req(victim, Health).hp : 0).toBeLessThanOrEqual(0);
    for (const p of game.world.query(Projectile)) expect(game.world.req(p, Projectile).source).not.toBe('strider');
  });

  it('only strikes from up close: its reach runs from its own edge', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, brawler({ style: 'swing' }), 0, base.x, base.z);
    const victim = dummy(game, base.x + 6, base.z);
    const armed = game.world.req(e, Armed);
    // Its reach (0.6) plus its own radius (0.8).
    expect(effectiveRange(game.world, e, armed, victim)).toBeCloseTo(1.4);
    const lunger = spawnUnit(game.world, game.ctx, brawler({ style: 'thrust', lunge: 2 }), 0, base.x, base.z + 6);
    expect(effectiveRange(game.world, lunger, game.world.req(lunger, Armed), victim)).toBeCloseTo(3.4);
  });

  it('a lunge carries the striker in, and a knock throws the struck back', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const e = spawnUnit(game.world, game.ctx, brawler({ style: 'thrust', lunge: 2.5, knock: 1.5 }, 5), 0, base.x, base.z);
    game.world.remove(e, Ai);
    const victim = dummy(game, base.x + 3.5, base.z, UNIT_DEFS.tank);
    let lunged = 0;
    let before = 0;
    game.events.on('struck', (s) => {
      if (s.entity !== e || lunged > 0) return;
      lunged = s.lunge;
    });
    const vt = game.world.req(victim, Transform);
    before = vt.x;
    run(game, 2);
    expect(lunged).toBeGreaterThan(0.5);
    // A tank is bigger than a strider, so it moves less than the full knock, but it moves.
    expect(vt.x).toBeGreaterThan(before + 0.2);
  });

  it('a sweep catches enemies beside the target too', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const def = brawler({ style: 'swing', sweep: 1.3, sweepMost: 3 }, 8);
    const e = spawnUnit(game.world, game.ctx, { ...def, weapon: { ...def.weapon, range: 1.2 } }, 0, base.x, base.z);
    game.world.remove(e, Ai);
    const heading = game.world.req(e, Transform).heading;
    const at = (a: number, d: number) => ({ x: base.x + Math.cos(heading + a) * d, z: base.z - Math.sin(heading + a) * d });
    const victims = [0, 0.5, -0.5].map((a) => {
      const p = at(a, 1.3);
      return dummy(game, p.x, p.z);
    });
    let most = 0;
    game.events.on('struck', (s) => s.entity === e && (most = Math.max(most, s.hits)));
    run(game, 1.5);
    expect(most).toBeGreaterThanOrEqual(2);
    const hurt = victims.filter((v) => !game.world.has(v, Health) || game.world.req(v, Health).hp < UNIT_DEFS.trooper.hp);
    expect(hurt.length).toBeGreaterThanOrEqual(2);
  });

  it('charges: runs at what it can see but not yet reach', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const def = brawler({ style: 'swing', charge: 1.6 });
    const e = spawnUnit(game.world, game.ctx, def, 0, base.x, base.z);
    dummy(game, base.x + 14, base.z);
    let fastest = 0;
    const t = game.world.req(e, Transform);
    for (let i = 0; i < 60; i++) {
      const x = t.x;
      const z = t.z;
      game.step(DT);
      fastest = Math.max(fastest, Math.hypot(t.x - x, t.z - z) / DT);
    }
    expect(game.world.req(e, Mover).surge).toBe(1.6);
    expect(fastest).toBeGreaterThan(def.speed * 1.2);
  });

  it('the Commander calls a charge at enemies just out of a melee squad\'s sight', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const def = brawler({ style: 'swing', charge: 1.5 });
    const e = spawnUnit(game.world, game.ctx, def, 0, base.x, base.z);
    // Further than it can see, but within call, and weaker than it.
    const d = Math.min(CHARGE_CALL - 2, def.sight + 6);
    dummy(game, base.x + d, base.z);
    run(game, 2.5);
    const ai = game.world.req(e, Ai);
    const charge = game.ctx.commander.charges.forSquad(ai.squad);
    expect(charge).toBeDefined();
    expect(game.ctx.commander.sides[0].goals.some((g) => g.kind === 'charge')).toBe(true);
    const t = game.world.req(e, Transform);
    expect(t.x).toBeGreaterThan(base.x + 2);
  });

  it('melee danger reaches as far as the unit can run in a few seconds, and threatens everything on the ground', () => {
    const m = menace(claws({ style: 'swing' }), 'strider');
    expect(m.infantry).toBeGreaterThan(0);
    expect(m.vehicle).toBeGreaterThan(0);
    expect(m.air).toBe(0);
  });
});
