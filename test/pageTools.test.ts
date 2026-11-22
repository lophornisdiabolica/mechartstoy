import { describe, expect, it } from 'vitest';
import { modelKeys } from '../src/render/models';
import { parseDuel, runDuel, setupDuel, duelState } from '../src/sim/duel';
import { viewerList, viewerOptions } from '../src/ui/modelViewer';
import { DOCTRINE_IDS } from '../src/game/doctrines';

describe('model viewer', () => {
  it('reads its options from the link, with defaults', () => {
    const o = viewerOptions(new URLSearchParams('models&doctrine=rime&slope=20&wreck=1&pose=2&labels=0'));
    expect(o).toMatchObject({ doctrine: 'rime', slope: 20, wreck: true, pose: 2, labels: false, spin: false, aim: 0 });
    expect(viewerOptions(new URLSearchParams('models&doctrine=nope')).doctrine).toBe('armour');
  });

  it('lists every doctrine’s units and every building, all with models', () => {
    const keys = new Set(modelKeys());
    for (const d of [...DOCTRINE_IDS, 'all', 'buildings'] as const) {
      const list = viewerList(d);
      expect(list.length).toBeGreaterThan(0);
      for (const m of list) expect(keys.has(m.def.model), `${d}: ${m.def.id}`).toBe(true);
    }
  });
});

describe('arena', () => {
  it('reads line-ups with a comma as well as "vs"', () => {
    expect(parseDuel('reaver*4,lancer*4')).toMatchObject({ a: [{ unit: 'reaver', count: 4 }], b: [{ unit: 'lancer', count: 4 }] });
    expect(parseDuel('tank*2 vs trooper*6').b).toEqual([{ unit: 'trooper', count: 6 }]);
  });

  it('lays out the same round the duel tool plays', () => {
    const duel = parseDuel('tank*3 vs tank*3');
    const setup = setupDuel(duel, 2);
    expect(setup.units).toEqual([3, 3]);
    expect(duelState(setup)).toMatchObject({ left: [3, 3], health: [1, 1] });
    const a = runDuel(duel, 2, { seconds: 20 });
    expect(a.sides.map((s) => s.units)).toEqual([3, 3]);
  });
});
