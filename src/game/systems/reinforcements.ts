import { System, World } from '../../core/ecs';
import { Construction, Faction, Producer } from '../components';
import { SimContext } from '../context';
import { newSquad, spawnUnit } from '../spawn';
import { UnitId } from '../units';
import { countUnits, outnumbered } from './production';

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

/** `advance` (0..1) moves the muster point from the base toward the map centre. */
export function spawnWave(world: World, ctx: SimContext, faction: number, picks: number, advance = 0): void {
  const base = ctx.field.baseSites[faction];
  const cx = base.x * (1 - advance);
  const cz = base.z * (1 - advance);
  for (let i = 0; i < picks; i++) {
    const entry = pickEntry(ctx);
    // Each pick forms up as a group at a random spot on the base pad.
    const a = ctx.rng.range(0, Math.PI * 2);
    const r = ctx.rng.range(0, base.radius * 0.6);
    const gx = cx + Math.cos(a) * r;
    const gz = cz + Math.sin(a) * r;
    const def = ctx.units[entry.unit];
    const squad = newSquad(ctx);
    for (let n = 0; n < entry.count; n++) {
      // Find a spot with room for the unit (not in water, not wedged between buildings).
      for (let tries = 0; tries < 6; tries++) {
        const spread = 1.5 + tries;
        const x = gx + ctx.rng.range(-spread, spread);
        const z = gz + ctx.rng.range(-spread, spread);
        if (ctx.field.contains(x, z, 1) && ctx.nav.fitsAt(x, z, def.radius)) {
          spawnUnit(world, ctx, def, faction, x, z, squad);
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
      for (let faction = 0; faction < nextWaveAt.length; faction++) {
        if (world.time < nextWaveAt[faction]) continue;
        // Ratio > 1 means this side is outnumbered.
        const ratio = outnumbered(ctx, alive, faction);
        nextWaveAt[faction] = world.time + (config.interval * ctx.rng.range(0.8, 1.2)) / Math.min(2, Math.max(0.6, ratio));
        if (producing[faction] || alive[faction] >= ctx.sides.unitCap(faction, ctx.settings.armies.unitCap)) continue;
        const picks = Math.round(config.picksPerWave * Math.min(3, Math.max(0.5, ratio)));
        spawnWave(world, ctx, faction, Math.max(1, picks), 0.12);
      }
    },
  };
}
