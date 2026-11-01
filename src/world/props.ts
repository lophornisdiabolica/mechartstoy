import { Rng } from '../core/rng';
import { Battlefield } from './battlefield';

/** Static scenery. Kept as data so later systems (pathing, destruction) can use it. */
export type PropKind = 'tree' | 'rock';

export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

export function scatterProps(field: Battlefield, rng: Rng, count = 420): Prop[] {
  const props: Prop[] = [];
  const b = field.bounds;
  let attempts = 0;
  while (props.length < count && attempts++ < count * 10) {
    const x = rng.range(b.minX + 1, b.maxX - 1);
    const z = rng.range(b.minZ + 1, b.maxZ - 1);
    const y = field.heightAt(x, z);
    if (y < field.seaLevel + 0.3) continue;
    if ([...field.baseSites, ...field.townSites, ...field.outpostSites].some((s) => Math.hypot(x - s.x, z - s.z) < s.radius * 1.1)) continue;
    const slope = field.slopeAt(x, z);
    // Trees cluster on gentle slopes, rocks on steeper ground.
    const kind: PropKind = slope > 0.6 || rng.chance(0.18) ? 'rock' : 'tree';
    if (kind === 'tree' && slope > 0.8) continue;
    props.push({ kind, x, y, z, scale: rng.range(0.7, 1.3), rotation: rng.range(0, Math.PI * 2) });
  }
  return props;
}
