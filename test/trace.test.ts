import { describe, expect, it } from 'vitest';
import { linkSettings, traceBattle } from '../src/sim/trace';

describe('battle trace', () => {
  it('reads a battle from its link, whole or just the query', () => {
    const a = linkSettings('http://localhost:5173/?seed=abc&mode=hill&size=small&doc1=legion#x');
    const b = linkSettings('seed=abc&mode=hill&size=small&doc1=legion');
    expect(a).toEqual(b);
    expect(a.seed).toBe('abc');
    expect(a.mode).toBe('hill');
    expect(a.factions[0].doctrine).toBe('legion');
    expect(() => linkSettings('mode=hill')).toThrow(/seed/);
  });

  it("writes down each side's plan and army as the battle goes, the same every time", () => {
    const link = '?seed=trace1&mode=hill&size=small';
    const text = traceBattle(link, { every: 30, minutes: 2 });
    expect(text).toContain('Tracing seed trace1');
    expect(text).toMatch(/^0:00 {2}hill: nobody/m);
    expect(text).toMatch(/^1:00 /m);
    expect(text).toMatch(/units \(strength \d+\): /);
    expect(text).toMatch(/massing \d+%/);
    expect(text.trim().split('\n').at(-1)).toMatch(/won after|No winner by 2:00/);
    expect(traceBattle(link, { every: 30, minutes: 2 })).toBe(text);
  }, 60_000);
});
