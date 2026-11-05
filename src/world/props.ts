import { Rng } from '../core/rng';
import { Battlefield } from './battlefield';
import { BIOMES, PropKind } from './biomes';
import * as D from '../core/dmath';

export type { PropKind } from './biomes';

/** Static scenery. Kept as data so later systems (pathing, destruction) can use it. */
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

/** Ground steeper than this gets the biome's steep-ground scenery (rocks, mostly). */
const STEEP = 0.6;

/** A kind from weighted choices. */
function weighted(rng: Rng, weights: Partial<Record<PropKind, number>>): PropKind {
  const entries = Object.entries(weights) as [PropKind, number][];
  let roll = rng.range(0, entries.reduce((s, [, w]) => s + w, 0));
  for (const [kind, w] of entries) if ((roll -= w) <= 0) return kind;
  return entries[0][0];
}

/**
 * Scatter the biome's scenery over open ground: off the water, the bases,
 * towns, outposts and bridges, with trees on gentle slopes and rocks on
 * steep ones. How much depends on the biome and the map's area.
 */
export function scatterProps(field: Battlefield, rng: Rng): Prop[] {
  const biome = BIOMES[field.config.biome];
  const count = Math.round((biome.props.density * field.width * field.depth) / 1000);
  const props: Prop[] = [];
  const b = field.bounds;
  let attempts = 0;
  while (props.length < count && attempts++ < count * 10) {
    const x = rng.range(b.minX + 1, b.maxX - 1);
    const z = rng.range(b.minZ + 1, b.maxZ - 1);
    const y = field.heightAt(x, z);
    if (y < field.seaLevel + 0.3) continue;
    if ([...field.baseSites, ...field.townSites, ...field.outpostSites].some((s) => D.hypot(x - s.x, z - s.z) < s.radius * 1.1)) continue;
    // Roads stay clear, and dense forest has trees of its own (see woods.ts).
    if (field.deckAt(x, z) !== null || field.groundAt(x, z).id !== 'plain') continue;
    const slope = field.slopeAt(x, z);
    const kind = weighted(rng, slope > STEEP ? biome.props.steep : biome.props.gentle);
    if (kind !== 'rock' && slope > 0.8) continue;
    props.push({ kind, x, y, z, scale: rng.range(0.7, 1.3), rotation: rng.range(0, Math.PI * 2) });
  }
  return props;
}
