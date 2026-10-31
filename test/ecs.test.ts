import { describe, expect, it } from 'vitest';
import { defineComponent, World } from '../src/core/ecs';

const Pos = defineComponent<{ x: number }>('Pos');
const Tag = defineComponent<object>('Tag');

describe('World', () => {
  it('queries entities with all requested components', () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    w.add(a, Pos, { x: 1 });
    w.add(b, Pos, { x: 2 });
    w.add(b, Tag, {});
    expect([...w.query(Pos)]).toEqual([a, b]);
    expect([...w.query(Pos, Tag)]).toEqual([b]);
  });

  it('defers destruction to the end of the step and notifies listeners', () => {
    const w = new World();
    const e = w.create();
    w.add(e, Pos, { x: 0 });
    const destroyed: number[] = [];
    w.onDestroy((d) => destroyed.push(d));
    w.addSystem({
      name: 'killer',
      update(world) {
        for (const id of world.query(Pos)) world.destroy(id);
        expect(world.isAlive(e)).toBe(true);
      },
    });
    w.step(0.1);
    expect(w.isAlive(e)).toBe(false);
    expect(w.has(e, Pos)).toBe(false);
    expect(destroyed).toEqual([e]);
    expect(w.tick).toBe(1);
  });
});
