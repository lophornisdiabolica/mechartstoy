import { describe, expect, it } from 'vitest';
import { Ai, Armed, Mover, Transform } from '../src/game/components';
import { defaultSettings } from '../src/game/settings';
import { plantForest } from '../src/game/god';
import { aimPoint, traceShot } from '../src/game/lineOfFire';
import { Rng } from '../src/core/rng';
import * as D from '../src/core/dmath';
import { BUILDING_DEFS } from '../src/game/buildings';
import { FROZEN } from '../src/game/frost';
import { Game } from '../src/game/game';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

describe("Verdant's tangle", () => {
  it('a glasshouse vine grows tangle under an enemy, and it drags them', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.glasshouse, 0, base.x, base.z, 0, false);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    game.world.remove(tank, Ai);
    game.world.req(tank, Armed).cooldown = Infinity;
    let tangled = false;
    for (let i = 0; i < 20 / DT && !tangled; i++) {
      game.step(DT);
      const t = game.world.req(tank, Transform);
      tangled = game.ctx.tangle.at(t.x, t.z) > FROZEN;
    }
    expect(tangled).toBe(true);
    const t = game.world.req(tank, Transform);
    // Slower in it than on frost, and it never touches the vine's own side.
    expect(game.ctx.tangle.paceAt(game.ctx, t.x, t.z, 1)).toBeLessThan(0.5);
    expect(game.ctx.tangle.paceAt(game.ctx, t.x, t.z, 0)).toBe(1);
  });

  it('withers away in a few seconds', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    game.ctx.tangle.add(base.x, base.z, 1.1, 5, 0);
    expect(game.ctx.tangle.at(base.x, base.z)).toBeGreaterThan(FROZEN);
    for (let i = 0; i < 12 / DT; i++) game.step(DT);
    expect(game.ctx.tangle.at(base.x, base.z)).toBeLessThan(FROZEN);
  });
});

describe("Verdant at home in the woods (DoctrineDef.woodland)", () => {
  /** A game with side 0 on `doctrine`, a tank of its standing in the middle of a big thicket. */
  function inTheWoods(doctrine: 'verdant' | 'armour') {
    const settings = defaultSettings();
    settings.factions[0] = { ...settings.factions[0], doctrine };
    const game = new Game(11, { populate: false, autoSpawn: false, settings });
    const base = game.field.baseSites[0];
    const other = game.field.baseSites[1];
    const d = D.hypot(other.x - base.x, other.z - base.z);
    const ux = (other.x - base.x) / d;
    const uz = (other.z - base.z) / d;
    const x = base.x + ux * 30;
    const z = base.z + uz * 30;
    plantForest(game.world, game.ctx, x, z, 9, new Rng(3), false);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, x - ux * 5, z - uz * 5);
    game.world.remove(tank, Ai);
    return { game, tank, x, z, ux, uz };
  }

  it('walks through dense forest at full speed without knocking it down', () => {
    const run = (doctrine: 'verdant' | 'armour') => {
      const { game, tank, x, z, ux, uz } = inTheWoods(doctrine);
      const standing = () => game.field.woods.trees.filter((t) => t.fell === null).length;
      const before = standing();
      const m = game.world.req(tank, Mover);
      m.targetX = x + ux * 5;
      m.targetZ = z + uz * 5;
      let time = 0;
      while (m.targetX !== null && time < 30) {
        game.step(DT);
        time += DT;
      }
      return { time, felled: before - standing() };
    };
    const verdant = run('verdant');
    const armour = run('armour');
    expect(verdant.felled).toBe(0);
    expect(armour.felled).toBeGreaterThan(0);
    expect(verdant.time).toBeLessThan(armour.time * 0.8);
  });

  it('shoots between the trees', () => {
    const shot = (doctrine: 'verdant' | 'armour') => {
      const { game, tank, x, z, ux, uz } = inTheWoods(doctrine);
      const enemy = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, x + ux * 6, z + uz * 6);
      game.world.remove(enemy, Ai);
      game.step(DT);
      const t = game.world.req(tank, Transform);
      const from = { x: t.x, y: t.y + 1.2, z: t.z };
      return traceShot(game.world, game.ctx, from, aimPoint(game.world, enemy), 20, tank, 0, enemy).stoppedBy;
    };
    expect(shot('armour')).toBe('tree');
    expect(shot('verdant')).not.toBe('tree');
  });
});
