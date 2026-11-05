import { describe, expect, it } from 'vitest';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { rollBattle } from '../src/game/variety';
import { Rng } from '../src/core/rng';
import { Weather, WEATHER_KINDS } from '../src/game/weather';

describe('weather', () => {
  it('is the same for the same seed, and steady when one kind is picked', () => {
    const a = new Weather(42, 'changing', 'temperate');
    const b = new Weather(42, 'changing', 'temperate');
    for (let t = 0; t < 3600; t += 37) expect(b.at(t)).toEqual(a.at(t));
    const rain = new Weather(42, 'rain', 'temperate');
    for (let t = 0; t < 3600; t += 101) {
      const w = rain.at(t);
      expect(w.kind).toBe('rain');
      expect(w.rain).toBeGreaterThan(0.6);
      expect(w.snow).toBe(0);
    }
    const clear = new Weather(42, 'clear', 'snow').at(500);
    expect([clear.rain, clear.snow, clear.fog, clear.lightning, clear.cloud]).toEqual([0, 0, 0, 0, 0]);
  });

  it('changes in spells that suit the biome, blending smoothly', () => {
    const kinds = (biome: 'desert' | 'snow' | 'temperate') => {
      const seen = new Set<string>();
      for (let seed = 1; seed < 30; seed++) for (const s of new Weather(seed, 'changing', biome).spellsUntil(4 * 3600)) seen.add(s.kind);
      return seen;
    };
    expect(kinds('desert').has('snow')).toBe(false);
    expect(kinds('snow').has('rain')).toBe(false);
    expect(kinds('snow').has('storm')).toBe(false);
    expect([...kinds('temperate')].sort()).toEqual([...WEATHER_KINDS].sort());
    // No jumps: a second apart, nothing changes by much.
    const w = new Weather(7, 'changing', 'temperate');
    let prev = w.at(0);
    for (let t = 1; t < 3600; t++) {
      const now = w.at(t);
      for (const k of ['rain', 'snow', 'fog', 'lightning', 'cloud'] as const) expect(Math.abs(now[k] - prev[k])).toBeLessThan(0.08);
      prev = now;
    }
  });

  it('changes nothing in the battle', () => {
    const play = (weather: 'clear' | 'storm') => {
      const s = defaultSettings();
      s.map.size = 'small';
      s.map.weather = weather;
      const g = new Game(5, { settings: s });
      for (let i = 0; i < 300; i++) g.step(1 / 30);
      return JSON.stringify(g.stats.sides.map((x) => [x.fielded, x.lost, x.kills]));
    };
    expect(play('storm')).toBe(play('clear'));
  });

  it('can be re-rolled between battles', () => {
    const s = defaultSettings();
    s.variety.roll.weather = true;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(rollBattle(s, new Rng(i)).settings.map.weather);
    expect(seen.size).toBeGreaterThan(3);
  });
});
