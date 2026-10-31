import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../src/core/spatialGrid';

describe('SpatialGrid', () => {
  it('finds entities within a radius across cells and negative coords', () => {
    const g = new SpatialGrid(4);
    g.insert(1, 0, 0);
    g.insert(2, -3, -3);
    g.insert(3, 10, 10);
    g.insert(4, 5, 0);
    const found: number[] = [];
    g.forEachNear(0, 0, 5, (e) => found.push(e));
    expect(found.sort()).toEqual([1, 2, 4]);
    g.clear();
    const after: number[] = [];
    g.forEachNear(0, 0, 50, (e) => after.push(e));
    expect(after).toEqual([]);
  });
});
