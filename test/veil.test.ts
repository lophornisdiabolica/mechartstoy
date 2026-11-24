import { describe, expect, it } from 'vitest';
import { Ai, Armed, Building, Faction, Health, Mover, Veiled } from '../src/game/components';
import { DOCTRINES } from '../src/game/doctrines';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS, UnitDef } from '../src/game/units';
import { hazeSpread, THICK } from '../src/game/smoke';

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

  it("shots through another side's haze go wild, but not through its own", () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    game.ctx.smoke.add(base.x + 10, base.z, 3, 5, 2);
    expect(hazeSpread(game.ctx, base.x, base.z, base.x + 10, base.z, 0)).toBeGreaterThan(0.05);
    expect(hazeSpread(game.ctx, base.x, base.z, base.x + 10, base.z, 2)).toBe(0);
    // Off to one side of it, nothing.
    expect(hazeSpread(game.ctx, base.x, base.z + 12, base.x + 10, base.z + 12, 0)).toBe(0);
  });

  it('a tank in haze is still shot at, but most shots miss', () => {
    const hurt = (haze: boolean) => {
      const game = emptyGame();
      const base = game.field.baseSites[0];
      const enemy = dummy(game, { ...UNIT_DEFS.tank, hp: 100000 }, 1, base.x + 13, base.z);
      const shooter = standing(game, UNIT_DEFS.tank, 0, base.x, base.z);
      for (let i = 0; i < 40 / DT; i++) {
        if (haze) game.ctx.smoke.add(base.x + 13, base.z, 3, 0.5, 2);
        game.step(DT);
      }
      expect(game.world.req(shooter, Armed).target).toBe(enemy);
      return 100000 - game.world.req(enemy, Health).hp;
    };
    const clear = hurt(false);
    expect(clear).toBeGreaterThan(0);
    expect(hurt(true)).toBeLessThan(clear * 0.6);
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

  it('shades vanish in cover, moving or not, and not in the open', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const open = dummy(game, UNIT_DEFS.shadeTrooper, 0, base.x, base.z);
    const hazed = dummy(game, UNIT_DEFS.shadeTrooper, 0, base.x, base.z + 6);
    const m = game.world.req(hazed, Mover);
    for (let i = 0; i < 4 / DT; i++) {
      // Veil's own haze round it, and it keeps walking through it.
      game.ctx.smoke.add(base.x + 4, base.z + 6, 7, 0.5, 0);
      m.targetX = base.x + 30;
      m.targetZ = base.z + 6;
      game.step(DT);
    }
    expect(game.world.req(open, Veiled).hidden).toBe(false);
    expect(game.world.req(hazed, Veiled).hidden).toBe(true);
    // In a forest, too.
    for (let k = 0; k < 4; k++) game.field.woods.add(base.x + (k % 2) * 0.5, base.z + Math.floor(k / 2) * 0.5, 1);
    run(game, 0.2);
    expect(game.world.req(open, Veiled).hidden).toBe(true);
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

describe('Veil: smoke screens', () => {
  it('a smoke truck lays its haze on its own tank closing on the enemy, not on the enemy', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    standing(game, UNIT_DEFS.smokeTruck, 2, base.x, base.z);
    standing(game, { ...UNIT_DEFS.ghostTank, hp: 100000 }, 2, base.x + 12, base.z);
    dummy(game, { ...UNIT_DEFS.tank, hp: 100000 }, 1, base.x + 26, base.z);
    let own = 0;
    let theirs = 0;
    for (let i = 0; i < 8 / DT; i++) {
      game.step(DT);
      own = Math.max(own, game.ctx.smoke.at(base.x + 13, base.z));
      theirs = Math.max(theirs, game.ctx.smoke.at(base.x + 26, base.z));
    }
    expect(own).toBeGreaterThan(THICK);
    expect(theirs).toBeLessThan(THICK);
  });

  it('a ghost tank in its own haze stays out of sight even as it fires', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const ghost = standing(game, UNIT_DEFS.ghostTank, 2, base.x, base.z);
    dummy(game, { ...UNIT_DEFS.tank, hp: 100000 }, 1, base.x + 12, base.z);
    game.ctx.smoke.add(base.x, base.z, 3, 10, 2);
    let fired = false;
    let shown = false;
    for (let i = 0; i < 6 / DT; i++) {
      game.step(DT);
      if (game.world.req(ghost, Armed).firedAt > 0.5) fired = true;
      if (fired && !game.world.req(ghost, Veiled).hidden) shown = true;
    }
    expect(fired).toBe(true);
    expect(shown).toBe(false);
  });
});
