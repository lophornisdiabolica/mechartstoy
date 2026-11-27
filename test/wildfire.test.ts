import { describe, expect, it } from 'vitest';
import { Health, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { BattleSettings, defaultFaction, defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { LIT } from '../src/game/fire';
import { wildfireOn } from '../src/game/wildfire';
import { groundCode } from '../src/world/ground';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    each?.();
  }
}

function settings(wildfire: number): BattleSettings {
  const s = defaultSettings();
  s.map.forest = 0.6;
  s.map.wildfire = wildfire;
  s.factions = [defaultFaction(0), defaultFaction(1)];
  return s;
}

/** A standing tree well inside the woods (most of the cells round it have trees too). */
function deepTree(game: Game): { x: number; z: number } {
  const woods = game.field.woods;
  let best = woods.trees[0];
  let most = -1;
  for (const t of woods.trees) {
    if (t.fell !== null) continue;
    let n = 0;
    for (let dz = -3; dz <= 3; dz += 1.5) for (let dx = -3; dx <= 3; dx += 1.5) if (woods.hasTreesAt(t.x + dx, t.z + dz)) n++;
    if (n > most) {
      most = n;
      best = t;
    }
  }
  return best;
}

function burntCells(game: Game): number {
  const code = groundCode('burnt');
  let n = 0;
  for (const g of game.field.ground) if (g === code) n++;
  return n;
}

describe('wildfire', () => {
  it('is off by default', () => {
    expect(defaultSettings().map.wildfire ?? 0).toBe(0);
    const game = new Game(3, { settings: defaultSettings(), populate: false, autoSpawn: false });
    expect(wildfireOn(game.ctx)).toBe(false);
    expect(settingsToParams(defaultSettings()).has('wildfire')).toBe(false);
    const s = settings(0.7);
    expect(settingsFromParams(settingsToParams(s)).map.wildfire).toBe(0.7);
  });

  it('a fire in the woods spreads slowly through them, fells the trees and leaves burnt ground', () => {
    const game = new Game(3, { settings: settings(1), populate: false, autoSpawn: false });
    expect(wildfireOn(game.ctx)).toBe(true);
    const tree = deepTree(game);
    const standing = () => game.field.woods.trees.filter((t) => t.fell === null).length;
    const before = standing();
    // A flamer's fire, side 0's.
    game.ctx.fire.add(tree.x, tree.z, 1, 1.2, 0, 'flameTrooper');
    let most = 0;
    run(game, 8, () => {
      let n = 0;
      game.ctx.fire.forEach((_k, heat) => {
        if (heat >= LIT) n++;
      });
      most = Math.max(most, n);
    });
    // Slow: after a few seconds it's still a small fire.
    expect(most).toBeLessThan(30);
    run(game, 70, () => {
      let n = 0;
      game.ctx.fire.forEach((_k, heat) => {
        if (heat >= LIT) n++;
      });
      most = Math.max(most, n);
    });
    expect(most).toBeGreaterThan(4);
    expect(standing()).toBeLessThan(before);
    expect(burntCells(game)).toBeGreaterThan(2);
  });

  it('with Wildfire off, the same fire stays where it was poured', () => {
    const game = new Game(3, { settings: settings(0), populate: false, autoSpawn: false });
    const tree = deepTree(game);
    game.ctx.fire.add(tree.x, tree.z, 1, 1.2, 0, 'flameTrooper');
    run(game, 40);
    expect(burntCells(game)).toBe(0);
  });

  it('everyone routes round it, and a unit caught in it gets out', () => {
    const game = new Game(3, { settings: settings(1), populate: false, autoSpawn: false });
    const tree = deepTree(game);
    game.ctx.fire.add(tree.x, tree.z, 2.5, 1.5, 0, 'flameTrooper');
    run(game, 3);
    expect(game.ctx.navs.land.costAt(tree.x, tree.z)).toBeGreaterThan(10);
    // Even side 0's own tank, since the woods' fire is nobody's.
    const soldier = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, tree.x, tree.z);
    const hp = game.world.req(soldier, Health).hp;
    run(game, 6);
    const t = game.world.req(soldier, Transform);
    expect(Math.hypot(t.x - tree.x, t.z - tree.z)).toBeGreaterThan(1.5);
    expect(!game.world.isAlive(soldier) || game.world.req(soldier, Health).hp <= hp).toBe(true);
  });
});
