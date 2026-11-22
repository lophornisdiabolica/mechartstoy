import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { DOCTRINE_IDS } from '../src/game/doctrines';
import { FACTIONS } from '../src/game/factions';
import { defaultSettings } from '../src/game/settings';
import { champion, drawBracket, ETERNAL_MATCH, matchName, matchSettings, nextMatch, recordWinner } from '../src/game/tournament';

describe('tournament', () => {
  it('draws eight different doctrines and plays quarter-finals, semi-finals and a final', () => {
    const b = drawBracket(DOCTRINE_IDS, new Rng(4));
    expect(b.entrants.length).toBe(8);
    expect(new Set(b.entrants).size).toBe(8);
    const names: string[] = [];
    for (let m = nextMatch(b); m; m = nextMatch(b)) {
      names.push(matchName(b, m));
      // The first-listed side always wins here.
      recordWinner(b, 0);
    }
    expect(names).toEqual(['Quarter-final 1', 'Quarter-final 2', 'Quarter-final 3', 'Quarter-final 4', 'Semi-final 1', 'Semi-final 2', 'Final']);
    expect(champion(b)).toBe(b.entrants[0]);
  });

  it('fills the field from a small pool with repeats, each doctrine as evenly as it can', () => {
    const b = drawBracket(['armour', 'legion', 'veil'], new Rng(1), 1, 8);
    expect(b.entrants.length).toBe(8);
    const counts = new Map<string, number>();
    for (const d of b.entrants) counts.set(d!, (counts.get(d!) ?? 0) + 1);
    expect([...counts.values()].sort()).toEqual([2, 3, 3]);
    const two = drawBracket(DOCTRINE_IDS, new Rng(1), 1, 2);
    expect(two.entrants.length).toBe(2);
    expect(matchName(two, nextMatch(two)!)).toBe('Final');
  });

  it('keeps a doctrine drawn twice from meeting itself in the first round', () => {
    for (let seed = 0; seed < 30; seed++) {
      const b = drawBracket(['armour', 'legion', 'veil'], new Rng(seed), 1, 6);
      for (let m = 0; m < b.rounds[0].length; m++) expect(b.entrants[m * 2] === b.entrants[m * 2 + 1]).toBe(false);
    }
  });

  it('gives byes to fill a field that isn’t a power of two', () => {
    const b = drawBracket(DOCTRINE_IDS, new Rng(3), 1, 6);
    expect(b.entrants.filter((d) => d !== null).length).toBe(6);
    expect(new Set(b.entrants.filter((d) => d !== null)).size).toBe(6);
    expect(b.entrants.length).toBe(8);
    // Two byes already through; four first-round matches less two to play.
    expect(b.rounds[0].filter((d) => d !== null).length).toBe(2);
    let played = 0;
    for (let m = nextMatch(b); m; m = nextMatch(b)) {
      expect(m.a).not.toBeNull();
      expect(m.b).not.toBeNull();
      recordWinner(b, 1);
      played++;
    }
    expect(played).toBe(5);
    expect(champion(b)).not.toBeNull();
  });

  it('knows which side of a mirror match went through', () => {
    const b = drawBracket(['legion'], new Rng(2), 1, 2);
    expect(b.entrants).toEqual(['legion', 'legion']);
    recordWinner(b, 1);
    expect(b.through[0][0]).toBe(1);
    expect(champion(b)).toBe('legion');
  });

  it('puts the right side through', () => {
    const b = drawBracket(DOCTRINE_IDS, new Rng(9));
    const m = nextMatch(b)!;
    recordWinner(b, 1);
    expect(b.rounds[0][0]).toBe(m.b);
    expect(nextMatch(b)!.index).toBe(1);
  });

  it('sets a match up 1v1 in the doctrines’ own colours, with a time limit for Eternal', () => {
    const base = defaultSettings();
    base.variety.tournament = true;
    const m = { round: 0, index: 0, a: 'legion' as const, b: 'veil' as const };
    const s = matchSettings(base, m, new Rng(2)).settings;
    expect(s.factions.map((f) => f.doctrine)).toEqual(['legion', 'veil']);
    expect(s.factions.map((f) => f.team)).toEqual([0, 1]);
    expect(s.factions[0].color).toBe(FACTIONS[DOCTRINE_IDS.indexOf('legion')].primary);
    expect(s.variety.after).toBe(ETERNAL_MATCH);
    expect(base.variety.after).toBe(0);
  });
});
