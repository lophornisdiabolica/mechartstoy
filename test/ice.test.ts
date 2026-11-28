import { describe, expect, it } from 'vitest';
import { Health, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { BattleSettings, battlefieldConfig, defaultFaction, defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { generateBattlefield } from '../src/world/battlefield';
import { Rng } from '../src/core/rng';

const DT = 1 / 30;

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    each?.();
  }
}

function settings(): BattleSettings {
  const s = defaultSettings();
  s.map.water = 0.7;
  s.map.traits = ['frozen'];
  s.factions = [defaultFaction(0), defaultFaction(1)];
  return s;
}

function iceGame(): Game {
  for (let seed = 1; ; seed++) {
    const game = new Game(seed, { settings: settings(), populate: false, autoSpawn: false });
    if (game.ctx.ice) return game;
  }
}

/** The middle of the ice patch furthest from the lake's shore (most ice round it). */
function deepIce(game: Game): { x: number; z: number; cell: number } {
  const ice = game.ctx.ice!;
  const cols = game.field.config.cols;
  const cs = game.field.config.cellSize;
  let best = ice.cells[0];
  let most = -1;
  for (const c of ice.cells) {
    let n = 0;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) if (ice.slot[c + dj * cols + di] >= 0) n++;
    if (n > most) {
      most = n;
      best = c;
    }
  }
  return { x: game.field.bounds.minX + ((best % cols) + 0.5) * cs, z: game.field.bounds.minZ + (Math.floor(best / cols) + 0.5) * cs, cell: best };
}

/** Hold a unit where it is. */
function hold(game: Game, e: number, x: number, z: number): void {
  if (!game.world.get(e, Health)) return;
  const t = game.world.req(e, Transform);
  t.x = x;
  t.z = z;
}

describe('frozen lake trait', () => {
  it('freezes a lake over, a way across on dry ice', () => {
    let laid = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const field = generateBattlefield(new Rng(seed), battlefieldConfig(settings()));
      const ice = field.traits.ice;
      if (!ice) continue;
      laid++;
      ice.verts.forEach((k, n) => {
        expect(field.heights[k]).toBeGreaterThan(field.seaLevel);
        expect(ice.bed[n]).toBeLessThan(field.seaLevel);
      });
    }
    expect(laid).toBeGreaterThan(3);
    expect(generateBattlefield(new Rng(1), battlefieldConfig(defaultSettings())).traits.ice).toBeNull();
    const game = iceGame();
    const p = deepIce(game);
    expect(game.field.isWater(p.x, p.z)).toBe(false);
    expect(game.ctx.navs.land.terrainAllowsAt(p.x, p.z)).toBe(true);
    // Heavy classes go round it where they can.
    expect(game.ctx.navs.for('walker').costAt(p.x, p.z)).toBeGreaterThan(game.ctx.navs.for('foot').costAt(p.x, p.z));
  });

  it("cuts a city's roads off a lake it freezes over, rather than leaving them across the ice", () => {
    let lakes = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const s = settings();
      s.map.city = 'sprawl';
      const field = generateBattlefield(new Rng(seed), battlefieldConfig(s));
      const sheet = field.traits.ice;
      if (!sheet) continue;
      lakes++;
      const stride = field.config.cols + 1;
      const ice = sheet.verts.map((k) => ({ x: field.vertexX(k % stride), z: field.vertexZ(Math.floor(k / stride)) }));
      for (const r of field.roads) {
        expect(r.points.length).toBeGreaterThanOrEqual(2);
        for (let q = 1; q < r.points.length; q++) {
          const a = r.points[q - 1];
          const b = r.points[q];
          for (let t = 0; t <= 1; t += 0.1) {
            const x = a.x + (b.x - a.x) * t;
            const z = a.z + (b.z - a.z) * t;
            for (const v of ice) expect(Math.hypot(v.x - x, v.z - z)).toBeGreaterThan(r.width / 2);
          }
        }
      }
      for (const j of field.junctions) for (const k of j.roads) expect(field.roads[k]).toBeDefined();
    }
    expect(lakes).toBeGreaterThan(2);
  });

  it("holds soldiers, gives way under a heavy machine standing on it, and freezes over again", () => {
    const game = iceGame();
    const ice = game.ctx.ice!;
    const p = deepIce(game);
    const broke: number[] = [];
    game.events.on('iceBroke', (e) => broke.push(e.drowned));
    const soldiers = [0, 1, 2].map((n) => spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, p.x + n * 0.2, p.z));
    run(game, 20, () => soldiers.forEach((e, n) => hold(game, e, p.x + n * 0.2, p.z)));
    expect(ice.holeAt(p.cell)).toBe(false);
    for (const e of soldiers) expect(game.world.get(e, Health)!.hp).toBeGreaterThan(0);
    const crawler = spawnUnit(game.world, game.ctx, UNIT_DEFS.crawler, 0, p.x, p.z);
    run(game, 8, () => hold(game, crawler, p.x, p.z));
    expect(ice.holeAt(p.cell)).toBe(true);
    expect(game.field.isWater(p.x, p.z)).toBe(true);
    expect(game.world.get(crawler, Health)?.hp ?? 0).toBe(0);
    expect(broke.length).toBe(1);
    // Freezes over again once it's empty.
    run(game, 100);
    expect(ice.holeAt(p.cell)).toBe(false);
    expect(game.field.isWater(p.x, p.z)).toBe(false);
  });

  it('a tank parked on it goes through in the end; shelling and fire break it too', () => {
    const game = iceGame();
    const ice = game.ctx.ice!;
    const p = deepIce(game);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, p.x, p.z);
    run(game, 15, () => hold(game, tank, p.x, p.z));
    expect(ice.holeAt(p.cell)).toBe(false);
    run(game, 45, () => hold(game, tank, p.x, p.z));
    expect(ice.holeAt(p.cell)).toBe(true);
    // Shells.
    const other = iceGame();
    const q = deepIce(other);
    for (let n = 0; n < 6; n++) other.ctx.ice!.blast(other.ctx, q.x, q.z, 60, 2);
    run(other, 1);
    expect(other.ctx.ice!.holeAt(q.cell)).toBe(true);
    // Fire.
    const third = iceGame();
    const f = deepIce(third);
    third.ctx.fire.add(f.x, f.z, 1, 1.5, 0, 'flameTrooper');
    run(third, 3);
    expect(third.ctx.ice!.holeAt(f.cell)).toBe(true);
  });
});
