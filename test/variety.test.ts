import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { DOCTRINE_IDS } from '../src/game/doctrines';
import { FACTIONS } from '../src/game/factions';
import { defaultSettings, factionDefs, LIMITS } from '../src/game/settings';
import { MAP_STYLES, rollBattle, SECOND_IDENTITIES } from '../src/game/variety';
import { settingsFromParams } from '../src/ui/settingsUrl';

describe('variety between battles', () => {
  it('changes nothing when nothing is picked', () => {
    const s = defaultSettings();
    const roll = rollBattle(s, new Rng(1));
    expect(roll.settings).toEqual(s);
    expect(roll.label).toBe('');
  });

  it('re-rolls only what is picked', () => {
    const s = defaultSettings();
    s.variety.roll.biome = true;
    s.map.water = 0.9;
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const r = rollBattle(s, new Rng(k)).settings;
      seen.add(r.map.biome);
      expect(r.map.water).toBe(0.9);
      expect(r.map.size).toBe(s.map.size);
      expect(r.factions).toEqual(s.factions);
    }
    expect(seen.size).toBe(4);
  });

  it('map styles stay within the settings’ ranges', () => {
    const s = defaultSettings();
    s.variety.roll.style = true;
    s.variety.roll.size = true;
    for (let k = 0; k < 60; k++) {
      const { settings: r, label } = rollBattle(s, new Rng(k));
      expect(MAP_STYLES.some((m) => label.startsWith(m.label))).toBe(true);
      for (const key of ['water', 'hills', 'forest', 'shape'] as const) {
        expect(r.map[key]).toBeGreaterThanOrEqual(LIMITS[key].min);
        expect(r.map[key]).toBeLessThanOrEqual(LIMITS[key].max);
      }
    }
  });

  it('rolls the number of sides in range, with teams as asked', () => {
    const s = defaultSettings();
    s.variety.roll.sides = true;
    s.variety.sidesMin = 3;
    s.variety.sidesMax = 5;
    s.variety.teams = 'two';
    s.map.placed.bases = [{ x: 0, z: 0 }, { x: 0.5, z: 0 }];
    for (let k = 0; k < 30; k++) {
      const r = rollBattle(s, new Rng(k)).settings;
      expect(r.factions.length).toBeGreaterThanOrEqual(3);
      expect(r.factions.length).toBeLessThanOrEqual(5);
      expect(new Set(r.factions.map((f) => f.team))).toEqual(new Set([0, 1]));
      expect(r.map.placed.bases).toBeNull();
    }
    s.variety.teams = 'ffa';
    const r = rollBattle(s, new Rng(3)).settings;
    expect(r.factions.map((f) => f.team)).toEqual(r.factions.map((_, i) => i));
  });

  it('draws doctrines from the pool, each once before repeats, with matching names and colours', () => {
    const s = defaultSettings();
    s.variety.roll.sides = true;
    s.variety.roll.doctrines = true;
    s.variety.sidesMin = 4;
    s.variety.sidesMax = 4;
    s.variety.repeats = false;
    s.variety.doctrines = ['legion', 'skyline', 'tidewater', 'talon'];
    for (let k = 0; k < 20; k++) {
      const r = rollBattle(s, new Rng(k)).settings;
      expect(r.factions.map((f) => f.doctrine).sort()).toEqual(['legion', 'skyline', 'talon', 'tidewater']);
      for (const f of r.factions) {
        const home = FACTIONS[DOCTRINE_IDS.indexOf(f.doctrine)];
        expect(f.name).toBe(home.name);
        expect(f.color).toBe(home.primary);
      }
      // The trim colour follows the hull colour.
      for (const d of factionDefs(r)) expect(d.secondary).toBe(FACTIONS.find((x) => x.primary === d.primary)!.secondary);
    }
  });

  it('gives duplicate doctrines distinct colours, and keeps custom names', () => {
    const s = defaultSettings();
    s.factions[0].name = 'My Lot';
    s.factions[0].color = 0x123456;
    s.variety.roll.sides = true;
    s.variety.roll.doctrines = true;
    s.variety.sidesMin = 6;
    s.variety.sidesMax = 6;
    s.variety.repeats = false;
    s.variety.doctrines = ['armour', 'bastion'];
    const r = rollBattle(s, new Rng(7)).settings;
    expect(r.factions[0].name).toBe('My Lot');
    expect(r.factions[0].color).toBe(0x123456);
    expect(new Set(r.factions.map((f) => f.color)).size).toBe(6);
    expect(r.factions.filter((f) => f.doctrine === 'armour').length).toBe(3);
  });

  it('splits sides into two uneven teams when asked', () => {
    const s = defaultSettings();
    s.variety.roll.sides = true;
    s.variety.sidesMin = 3;
    s.variety.sidesMax = 7;
    s.variety.teams = 'uneven';
    for (let k = 0; k < 40; k++) {
      const r = rollBattle(s, new Rng(k)).settings;
      const sizes = [0, 1].map((t) => r.factions.filter((f) => f.team === t).length);
      expect(sizes[0] + sizes[1]).toBe(r.factions.length);
      expect(sizes[0]).toBeGreaterThanOrEqual(1);
      expect(sizes[0]).toBeLessThan(sizes[1]);
    }
  });

  it('can repeat a doctrine, giving the repeat its own name and colour', () => {
    const s = defaultSettings();
    s.variety.roll.sides = true;
    s.variety.roll.doctrines = true;
    s.variety.sidesMin = 5;
    s.variety.sidesMax = 5;
    s.variety.doctrines = ['legion', 'armour'];
    let seen = false;
    for (let k = 0; k < 20; k++) {
      const r = rollBattle(s, new Rng(k)).settings;
      expect(new Set(r.factions.map((f) => f.color)).size).toBe(5);
      expect(new Set(r.factions.map((f) => f.name)).size).toBe(5);
      for (const f of r.factions) {
        const second = SECOND_IDENTITIES.find((d) => d.primary === f.color);
        if (second) {
          seen = true;
          expect(f.name).toBe(second.name);
        }
      }
    }
    expect(seen).toBe(true);
  });

  it('round-trips through the URL', () => {
    const s = settingsFromParams(new URLSearchParams('vary=biome,doctrines,weather,junk&vsides=7-3&vteams=ffa&vdocs=raiders,nope,legion&vafter=15'));
    expect(s.variety.roll).toEqual({ size: false, biome: true, style: false, sides: false, doctrines: true, weather: true });
    expect([s.variety.sidesMin, s.variety.sidesMax]).toEqual([3, 7]);
    expect(s.variety.teams).toBe('ffa');
    expect(s.variety.doctrines).toEqual(['raiders', 'legion']);
    expect(s.variety.after).toBe(15);
  });
});
