import { describe, expect, it } from 'vitest';
import { Ai, Armed, Building, Faction, Health, Mover, Veiled } from '../src/game/components';
import { DOCTRINES } from '../src/game/doctrines';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS, UnitDef } from '../src/game/units';
import { THICK } from '../src/game/smoke';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function emptyGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

function standing(game: Game, def: UnitDef, faction: number, x: number, z: number): number {
  const e = spawnUnit(game.world, game.ctx, def, faction, x, z);
  game.world.remove(e, Ai);
  return e;
}

function dummy(game: Game, def: UnitDef, faction: number, x: number, z: number): number {
  const e = standing(game, def, faction, x, z);
  game.world.req(e, Armed).cooldown = Infinity;
  return e;
}

describe('Veil: smoke', () => {
  it("a smoke truck's canisters lay smoke where they land, and it thins away", () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.smokeTruck, 0, base.x, base.z);
    dummy(game, UNIT_DEFS.tank, 1, base.x + 14, base.z);
    let most = 0;
    for (let i = 0; i < 8 / DT; i++) {
      game.step(DT);
      most = Math.max(most, game.ctx.smoke.at(base.x + 14, base.z));
    }
    expect(most).toBeGreaterThan(THICK);
  });

  it("nobody sees into smoke but the side that laid it", () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const enemy = dummy(game, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    const shooter = standing(game, UNIT_DEFS.tank, 0, base.x, base.z);
    const keep = () => game.ctx.smoke.add(base.x + 10, base.z, 3, 0.5, 2);
    for (let i = 0; i < 3 / DT; i++) {
      keep();
      game.step(DT);
    }
    // Side 2's smoke: side 0 can't pick the tank in it out.
    expect(game.world.req(shooter, Armed).target).toBeNull();
    expect(game.world.req(enemy, Health).hp).toBe(UNIT_DEFS.tank.hp);
    // Its own smoke it sees straight through.
    const game2 = emptyGame();
    const enemy2 = dummy(game2, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    const shooter2 = standing(game2, UNIT_DEFS.tank, 0, base.x, base.z);
    for (let i = 0; i < 3 / DT; i++) {
      game2.ctx.smoke.add(base.x + 10, base.z, 3, 0.5, 0);
      game2.step(DT);
    }
    expect(game2.world.req(shooter2, Armed).target).toBe(enemy2);
  });

  it('close up, smoke hides nothing', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const enemy = dummy(game, UNIT_DEFS.tank, 1, base.x + 4.5, base.z);
    const shooter = standing(game, UNIT_DEFS.tank, 0, base.x, base.z);
    for (let i = 0; i < 2 / DT; i++) {
      game.ctx.smoke.add(base.x + 4.5, base.z, 3, 0.5, 1);
      game.step(DT);
    }
    expect(game.world.req(shooter, Armed).target).toBe(enemy);
  });
});

describe('Veil: stealth', () => {
  it('a ghost tank fades from sight when it holds fire, and firing gives it away', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const ghost = dummy(game, UNIT_DEFS.ghostTank, 0, base.x, base.z);
    const tank = standing(game, UNIT_DEFS.tank, 1, base.x + 12, base.z);
    run(game, 4);
    expect(game.world.req(ghost, Veiled).hidden).toBe(true);
    expect(game.world.req(tank, Armed).target).toBeNull();
    // It fires: seen again.
    game.world.req(ghost, Armed).cooldown = 0;
    run(game, 1);
    expect(game.world.req(ghost, Veiled).hidden).toBe(false);
    run(game, 0.6);
    expect(game.world.req(tank, Armed).target).toBe(ghost);
  });

  it('a spotter sees what stealth hides', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const ghost = dummy(game, UNIT_DEFS.ghostTank, 0, base.x, base.z);
    const tank = standing(game, UNIT_DEFS.tank, 1, base.x + 12, base.z);
    // Bastion's scout copters spot; a plain tower spots for everyone that has one.
    const s = UNIT_DEFS.scout;
    dummy(game, { ...s, spots: 14 }, 1, base.x + 6, base.z + 4);
    run(game, 4);
    expect(game.world.req(ghost, Veiled).hidden).toBe(true);
    expect(game.world.req(tank, Armed).target).toBe(ghost);
  });

  it('shades vanish only while they stand still', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const still = dummy(game, UNIT_DEFS.shadeTrooper, 0, base.x, base.z);
    const walking = dummy(game, UNIT_DEFS.shadeTrooper, 0, base.x, base.z + 3);
    const m = game.world.req(walking, Mover);
    for (let i = 0; i < 3 / DT; i++) {
      // Keep it walking off.
      m.targetX = base.x + 30;
      m.targetZ = base.z + 3;
      game.step(DT);
    }
    expect(game.world.req(still, Veiled).hidden).toBe(true);
    expect(game.world.req(walking, Veiled).hidden).toBe(false);
  });
});

describe('Veil base', () => {
  it('Veil builds smoke stacks that keep smoke over the base', () => {
    const s = defaultSettings();
    s.factions.forEach((f, i) => (f.doctrine = (['veil', 'armour'] as const)[i] ?? f.doctrine));
    const game = new Game(4, { settings: s });
    run(game, 15);
    const stacks = [...game.world.query(Building, Faction)].find((e) => game.world.req(e, Faction).id === 0 && game.world.req(e, Building).def.id === DOCTRINES.veil.signature);
    expect(stacks).toBeDefined();
    expect(game.ctx.smoke.count).toBeGreaterThan(0);
  }, 30000);
});
