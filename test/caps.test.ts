import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/game/buildings';
import { capFor, countByCategory } from '../src/game/caps';
import { GARRISON, Guard } from '../src/game/components';
import { Game } from '../src/game/game';
import { BattleSettings, defaultSettings } from '../src/game/settings';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** An empty map (no bases, no town) where production runs, with the settings changed by `tweak`. */
function emptyGame(tweak: (s: BattleSettings) => void = () => {}): Game {
  const s = defaultSettings();
  tweak(s);
  return new Game(4, { settings: s, populate: false });
}

describe('unit caps per category', () => {
  it('a full category stops its own production but not the others', () => {
    const game = emptyGame((s) => {
      s.armies.caps.vehicle = 0;
    });
    const site = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.factory, 0, site.x, site.z, 0);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.barracks, 0, site.x - 8, site.z, 0);
    run(game, BUILDING_DEFS.factory.production.interval * 2.5);
    const counts = countByCategory(game.world, game.ctx.sides.count)[0];
    expect(counts.vehicle).toBe(0);
    expect(counts.infantry).toBeGreaterThan(0);
  });

  it('outpost guards are not part of the army', () => {
    const game = emptyGame();
    const site = game.field.baseSites[0];
    const guard = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, site.x, site.z);
    game.world.add(guard, Guard, { outpost: 0 });
    spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, site.x + 1, site.z);
    expect(countByCategory(game.world, game.ctx.sides.count)[0].infantry).toBe(1);
  });
});

describe('super units', () => {
  it('are only built while the side holds an outpost (on maps with outposts)', () => {
    const game = emptyGame();
    expect(game.ctx.outposts.length).toBeGreaterThan(0);
    const site = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, 0, site.x, site.z, 0);
    let titans = 0;
    game.events.on('spawned', (e) => {
      if (e.def.id === 'titan') titans++;
    });
    run(game, BUILDING_DEFS.mechbay.production.interval * 1.5);
    expect(titans).toBe(0);
    game.ctx.outposts[0].owner = 0;
    run(game, BUILDING_DEFS.mechbay.production.interval * 1.5);
    expect(titans).toBe(1);
  });

  it('are built without an outpost on maps that have none, up to the cap', () => {
    const game = emptyGame((s) => {
      s.map.outposts = 0;
      s.armies.caps.super = 1;
      s.armies.superGrowth = 'none';
    });
    const site = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, 0, site.x, site.z, 0);
    run(game, BUILDING_DEFS.mechbay.production.interval * 3.5);
    expect(countByCategory(game.world, game.ctx.sides.count)[0].super).toBe(1);
  });

  it('the cap grows with the tide ramp, up to 3× the base', () => {
    const game = emptyGame((s) => (s.armies.superGrowth = 'tide'));
    const caps = [0, 0.5, 1, 1.5, 2].map((level) => {
      game.ctx.escalation.tide = level;
      return capFor(game.ctx, 0, 'super');
    });
    expect(caps).toEqual([1, 1, 2, 2, 3]);
  });

  it('the cap grows by one for each outpost held past the first', () => {
    const game = emptyGame((s) => {
      s.map.outposts = 4;
      s.armies.superGrowth = 'outposts';
    });
    const caps = [0, 1, 2, 4].map((held) => {
      game.ctx.outposts.forEach((o, i) => (o.owner = i < held ? 0 : GARRISON));
      return capFor(game.ctx, 0, 'super');
    });
    expect(caps).toEqual([1, 1, 2, 4]);
  });

  it('a fixed cap stays put', () => {
    const game = emptyGame((s) => {
      s.armies.caps.super = 2;
      s.armies.superGrowth = 'none';
    });
    game.ctx.escalation.tide = 2;
    expect(capFor(game.ctx, 0, 'super')).toBe(2);
  });
});
