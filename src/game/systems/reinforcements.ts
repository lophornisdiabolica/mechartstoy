import { System, World } from '../../core/ecs';
import { Construction, Faction, Producer } from '../components';
import { SimContext } from '../context';
import { newSquad, spawnUnit } from '../spawn';
import { UnitId } from '../units';
import { countUnits, outnumbered } from './production';
import { armyCap, canBuild, CategoryCounts, countByCategory } from '../caps';

/** One pick from the wave table: what to spawn and how many at once. */
interface WaveEntry {
  unit: UnitId;
  weight: number;
  count: number;
}

const WAVE_TABLE: WaveEntry[] = [
  { unit: 'trooper', weight: 5, count: 5 },
  { unit: 'strider', weight: 3, count: 2 },
  { unit: 'tank', weight: 2.5, count: 1 },
  { unit: 'howitzer', weight: 1, count: 1 },
  { unit: 'titan', weight: 0.6, count: 1 },
];

export interface ReinforcementConfig {
  /** Seconds between waves, per faction. */
  interval: number;
  /** Picks from the wave table per wave. */
  picksPerWave: number;
}

export const DEFAULT_REINFORCEMENTS: ReinforcementConfig = {
  interval: 20,
  picksPerWave: 2,
};

function pickEntry(ctx: SimContext): WaveEntry {
  const total = WAVE_TABLE.reduce((s, w) => s + w.weight, 0);
  let roll = ctx.rng.range(0, total);
  for (const entry of WAVE_TABLE) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return WAVE_TABLE[0];
}

/**
 * Where a side's new units form up: `forward` (0..1) of the way from its
 * base to the point where its army masses before the next attack (in front
 * of the base, toward the enemy it's about to attack), and no further out
 * than the edge of the base.
 */
export function musterPoint(ctx: SimContext, faction: number, time: number, forward: number): { x: number; z: number } {
  const base = ctx.field.baseSites[faction];
  const target = ctx.sides.target(faction, ctx.offensive.attack(faction, time));
  const rally = target !== null ? ctx.lanes.rally(faction, target, 0) : { x: 0, z: 0 };
  // Never further out than the edge of the base pad (an attack on a far enemy rallies further out).
  const d = Math.hypot(rally.x - base.x, rally.z - base.z);
  const k = d > 0 ? Math.min(d * forward, base.radius) / d : 0;
  return { x: base.x + (rally.x - base.x) * k, z: base.z + (rally.z - base.z) * k };
}

/** Spawn `picks` groups from the wave table. Picks whose category is full (see caps.ts) are skipped. */
export function spawnWave(world: World, ctx: SimContext, faction: number, picks: number, forward = 0, counts: CategoryCounts[] = countByCategory(world, ctx.sides.count)): void {
  const base = ctx.field.baseSites[faction];
  const { x: cx, z: cz } = musterPoint(ctx, faction, world.time, forward);
  for (let i = 0; i < picks; i++) {
    const entry = pickEntry(ctx);
    const def = ctx.units[entry.unit];
    if (!canBuild(ctx, counts, faction, def)) continue;
    // Each pick forms up as a group at a random spot on the base pad.
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(0, base.radius * 0.6);
    const gx = cx + Math.cos(a) * r;
    const gz = cz + Math.sin(a) * r;
    const squad = newSquad(ctx);
    for (let n = 0; n < entry.count; n++) {
      // Find a spot with room for the unit (not in water, not wedged between buildings).
      for (let tries = 0; tries < 6; tries++) {
        const spread = 1.5 + tries;
        const x = gx + ctx.rng.range(-spread, spread);
        const z = gz + ctx.rng.range(-spread, spread);
        if (ctx.field.contains(x, z, 1) && ctx.nav.fitsAt(x, z, def.radius)) {
          spawnUnit(world, ctx, def, faction, x, z, squad);
          counts[faction][def.category]++;
          break;
        }
      }
    }
  }
}

/**
 * Fallback for a faction whose production buildings are all destroyed: timed,
 * rubber-banded waves from its base keep it in the fight until it rebuilds.
 * Conquest has no rebuilding (losing production loses the battle), so this
 * only runs in Eternal mode.
 */
export function reinforcementSystem(ctx: SimContext, config = DEFAULT_REINFORCEMENTS): System {
  const nextWaveAt = ctx.field.baseSites.map(() => ctx.rng.range(config.interval * 0.5, config.interval));
  return {
    name: 'reinforcements',
    update(world) {
      if (ctx.settings.mode !== 'eternal') return;
      const producing = nextWaveAt.map(() => false);
      for (const e of world.query(Producer, Faction)) {
        if (!world.has(e, Construction)) producing[world.req(e, Faction).id] = true;
      }
      const alive = countUnits(world, ctx.sides.count);
      const counts = countByCategory(world, ctx.sides.count);
      for (let faction = 0; faction < nextWaveAt.length; faction++) {
        if (world.time < nextWaveAt[faction]) continue;
        // Ratio > 1 means this side is outnumbered.
        const ratio = outnumbered(ctx, alive, faction);
        nextWaveAt[faction] = world.time + (config.interval * ctx.rng.range(0.8, 1.2)) / Math.min(2, Math.max(0.6, ratio));
        if (producing[faction] || alive[faction] >= armyCap(ctx, faction)) continue;
        const picks = Math.round(config.picksPerWave * Math.min(3, Math.max(0.5, ratio)));
        spawnWave(world, ctx, faction, Math.max(1, picks), 0.5, counts);
      }
    },
  };
}
