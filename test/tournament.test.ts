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
      recordWinner(b, m.a);
    }
    expect(names).toEqual(['Quarter-final 1', 'Quarter-final 2', 'Quarter-final 3', 'Quarter-final 4', 'Semi-final 1', 'Semi-final 2', 'Final']);
    expect(champion(b)).toBe(b.entrants[0]);
  });

  it('shrinks to four or two with a small pool', () => {
    expect(drawBracket(['armour', 'legion', 'veil', 'rime', 'sabre'], new Rng(1)).entrants.length).toBe(4);
    const two = drawBracket(['armour', 'legion', 'veil'], new Rng(1));
    expect(two.entrants.length).toBe(2);
    expect(matchName(two, nextMatch(two)!)).toBe('Final');
  });

  it('puts the right side through', () => {
    const b = drawBracket(DOCTRINE_IDS, new Rng(9));
    const m = nextMatch(b)!;
    recordWinner(b, m.b);
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
