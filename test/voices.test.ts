import { describe, expect, it } from 'vitest';
import { DOCTRINE_IDS } from '../src/game/doctrines';
import { VOICE_MOMENTS, voiceLine, voicedDoctrines } from '../src/ui/voices';

describe('commander voices', () => {
  it('every doctrine has its own voice, with a line for every moment', () => {
    expect(new Set(voicedDoctrines())).toEqual(new Set(DOCTRINE_IDS));
    for (const d of DOCTRINE_IDS) {
      for (const m of VOICE_MOMENTS) {
        const line = voiceLine(d, m, 0, { enemy: 'Crimson Brigade', where: 'the supply depot', unit: 'Titan' });
        expect(line).not.toMatch(/[{}]/);
        expect(line[0]).toBe(line[0].toUpperCase());
      }
    }
  });

  it('fills the gaps and varies the line', () => {
    expect(voiceLine('armour', 'attack', 0, { enemy: 'Crimson Brigade' })).toContain('Crimson Brigade');
    expect(voiceLine('armour', 'attack', 0, {})).not.toBe(voiceLine('armour', 'attack', 1, {}));
    expect(voiceLine('veil', 'took', 0, { where: 'the airstrip' })).toMatch(/^The airstrip/);
  });

  it('a doctrine variant speaks with its doctrine’s voice', () => {
    expect(voiceLine('bastionSpider', 'regroup', 0, {})).toBe(voiceLine('bastion', 'regroup', 0, {}));
  });
});
