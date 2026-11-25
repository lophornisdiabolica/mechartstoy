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

describe('component stores over a long battle', () => {
  it('find every component after ids have run far past the first ones, and keep query order', () => {
    const w = new World();
    const C = defineComponent<{ v: number }>('LongC');
    const keep: number[] = [];
    // A few long-lived entities from the start and from mid-battle, among many short-lived ones.
    for (let n = 0; n < 60000; n++) {
      const e = w.create();
      w.add(e, C, { v: e });
      if (n < 5 || n % 9973 === 0) keep.push(e);
      else w.destroy(e);
      if (n % 100 === 0) w.step(1 / 30);
    }
    w.step(1 / 30);
    for (const e of keep) expect(w.get(e, C)?.v).toBe(e);
    expect([...w.query(C)]).toEqual(keep);
    expect(w.has(keep[keep.length - 1] + 1, C)).toBe(false);
    w.remove(keep[0], C);
    expect(w.has(keep[0], C)).toBe(false);
    expect([...w.query(C)]).toEqual(keep.slice(1));
  });
});
