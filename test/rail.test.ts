import { describe, expect, it } from 'vitest';
import { Ai, Faction, Health, Transform, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { buildOutpost, capture } from '../src/game/outposts';
import { Rng } from '../src/core/rng';
import { BattleSettings, battlefieldConfig, defaultFaction, defaultSettings } from '../src/game/settings';
import { generateBattlefield } from '../src/world/battlefield';
import { railLength, railNearest } from '../src/world/traits';

const DT = 1 / 30;

function settings(seed = 0): BattleSettings {
  const s = defaultSettings();
  s.map.size = 'large';
  s.map.traits = ['rail'];
  s.factions = [defaultFaction(0), defaultFaction(1)];
  void seed;
  return s;
}

function run(game: Game, seconds: number, each?: () => void): void {
  for (let i = 0; i < seconds / DT; i++) {
    game.step(DT);
    each?.();
  }
}

function trains(game: Game): number[] {
  return [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Unit).def.id === 'armouredTrain');
}

describe('rail line trait', () => {
  it('lays a track most of the way across between the sides, on dry ground, with stations by it', () => {
    let laid = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const field = generateBattlefield(new Rng(seed), battlefieldConfig(settings()));
      const rail = field.traits.rail;
      if (!rail) continue;
      laid++;
      expect(railLength(rail)).toBeGreaterThan(Math.min(field.width, field.depth) * 0.45);
      for (const p of rail.points) {
        expect(field.isWater(p.x, p.z)).toBe(false);
        for (const b of field.baseSites) expect(Math.hypot(p.x - b.x, p.z - b.z)).toBeGreaterThan(b.radius);
      }
      // A gentle bed: no step between neighbouring points steeper than a ramp.
      for (let k = 1; k < rail.points.length; k++) {
        const rise = Math.abs(field.heightAt(rail.points[k].x, rail.points[k].z) - field.heightAt(rail.points[k - 1].x, rail.points[k - 1].z));
        expect(rise).toBeLessThan(0.6);
      }
      const stations = field.outpostSites.filter((o) => o.kind === 'station');
      expect(stations.length).toBeGreaterThan(0);
      for (const st of stations) expect(railNearest(rail, st.x, st.z).d).toBeLessThan(10);
    }
    expect(laid).toBeGreaterThan(3);
  });

  it('a map without it has no track', () => {
    const s = defaultSettings();
    expect(generateBattlefield(new Rng(5), battlefieldConfig(s)).traits.rail).toBeNull();
  });

  it("a station's holder gets an armoured train that runs on the track, one per side, and another after it's lost", () => {
    let tested = false;
    for (const seed of [1, 2, 3, 4]) {
      const game = new Game(seed, { settings: settings(), populate: false, autoSpawn: false });
      const rail = game.field.traits.rail;
      const station = game.ctx.outposts.find((o) => o.kind.id === 'station');
      if (!rail || !station) continue;
      tested = true;
      const rng = new Rng(1);
      for (const o of game.ctx.outposts) buildOutpost(game.world, game.ctx, o, rng);
      const launched: number[] = [];
      game.events.on('trainLaunched', (e) => launched.push(e.faction));
      // Held by its garrison: no train.
      run(game, 70);
      expect(trains(game)).toEqual([]);
      // (All of them, so the train has no garrison to stop and fight.)
      for (const o of game.ctx.outposts) capture(game.world, game.ctx, o, 0);
      run(game, 55);
      expect(trains(game)).toEqual([]);
      run(game, 10);
      expect(launched).toEqual([0]);
      const [train] = trains(game);
      expect(game.world.req(train, Faction).id).toBe(0);
      expect(game.world.has(train, Ai)).toBe(false);
      // It runs along the line, and only on it.
      const t = game.world.req(train, Transform);
      let off = 0;
      let went = 0;
      let last = { x: t.x, z: t.z };
      run(game, 20, () => {
        off = Math.max(off, railNearest(rail, t.x, t.z).d);
        went += Math.hypot(t.x - last.x, t.z - last.z);
        last = { x: t.x, z: t.z };
      });
      expect(off).toBeLessThan(1);
      expect(went).toBeGreaterThan(30);
      // One per side, however many stations it holds.
      run(game, 70);
      expect(trains(game).length).toBe(1);
      // Lost, another comes a while later.
      game.world.req(train, Health).hp = 0;
      run(game, 5);
      expect(trains(game).length).toBe(0);
      run(game, 62);
      expect(trains(game).length).toBe(1);
      expect(launched).toEqual([0, 0]);
      break;
    }
    expect(tested).toBe(true);
  });
});
