import { describe, expect, it } from 'vitest';
import { Armed, Faction, Health, Transform, Unit, Wreck } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function unitCount(game: Game, faction: number): number {
  let n = 0;
  for (const e of game.world.query(Unit, Faction)) if (game.world.req(e, Faction).id === faction) n++;
  return n;
}

/** A game with the opening armies cleared, for controlled scenarios. */
function emptyGame(seed = 11): Game {
  const game = new Game(seed);
  for (const e of game.world.query(Unit)) game.world.destroy(e);
  game.step(DT);
  return game;
}

describe('combat', () => {
  it('a tank destroys a lone trooper in range', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x, base.z);
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, base.x + 8, base.z);
    let destroyed = 0;
    game.events.on('unitDestroyed', (ev) => {
      if (ev.entity === trooper) destroyed++;
    });
    run(game, 15);
    expect(destroyed).toBe(1);
    expect(game.world.isAlive(trooper)).toBe(false);
    expect(game.world.req(tank, Health).hp).toBeGreaterThan(0);
  });

  it('turrets rotate toward targets', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x, base.z);
    // Put an enemy directly "behind" the tank relative to its starting heading.
    const heading = game.world.req(tank, Transform).heading;
    spawnUnit(game.world, game.ctx, UNIT_DEFS.titan, 1, base.x - Math.cos(heading) * 10, base.z + Math.sin(heading) * 10);
    run(game, 3);
    const aim = game.world.req(tank, Armed).aim;
    const diff = Math.abs(Math.atan2(Math.sin(aim - heading), Math.cos(aim - heading)));
    expect(diff).toBeGreaterThan(2);
  });

  it('destroyed vehicles leave wrecks that are later removed', () => {
    const game = emptyGame();
    const base = game.field.baseSites[0];
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x, base.z);
    game.world.req(tank, Health).hp = 0;
    game.step(DT);
    expect(game.world.has(tank, Wreck)).toBe(true);
    expect(game.world.has(tank, Unit)).toBe(false);
    run(game, UNIT_DEFS.tank.wreckTime + 1);
    expect(game.world.isAlive(tank)).toBe(false);
  });

  it('keeps fighting indefinitely without either side being wiped out', () => {
    for (const seed of [5, 6, 7]) {
      const game = new Game(seed);
      const kills = [0, 0];
      game.events.on('unitDestroyed', (ev) => kills[ev.faction]++);
      let samplesWithBothSides = 0;
      for (let s = 0; s < 20; s++) {
        run(game, 15);
        if (unitCount(game, 0) > 0 && unitCount(game, 1) > 0) samplesWithBothSides++;
      }
      expect(kills[0]).toBeGreaterThan(50);
      expect(kills[1]).toBeGreaterThan(50);
      expect(samplesWithBothSides).toBeGreaterThanOrEqual(18);
    }
  }, 30000);

  it('is deterministic for a seed', () => {
    const snapshot = (g: Game) =>
      [...g.world.query(Unit, Transform)].map((e) => {
        const t = g.world.req(e, Transform);
        return [e, t.x.toFixed(4), t.z.toFixed(4)];
      });
    const a = new Game(77);
    const b = new Game(77);
    run(a, 30);
    run(b, 30);
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('never leaves ground units standing in water', () => {
    const game = new Game(3);
    run(game, 120);
    for (const e of game.world.query(Unit, Transform)) {
      const t = game.world.req(e, Transform);
      expect(game.field.heightAt(t.x, t.z)).toBeGreaterThan(game.field.seaLevel - 0.3);
    }
  });
});
