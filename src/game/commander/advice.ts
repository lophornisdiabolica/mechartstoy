import { UnitDef } from '../units';
import { ANTI_AIR } from './roles';
import type { SidePicture } from './commander';

/*
 * Production advice and styles (Commander step 4).
 *
 * Advice: within a doctrine's own production table, the Commander leans each
 * pick toward what the battle needs, by at most the advice setting (30% by
 * default) either way. Short of anti-air against the enemy's aircraft, it
 * builds more of what can shoot them (and less when the enemy has none);
 * against an enemy that's mostly armour, more of what hits hard; against
 * one that's mostly infantry, more of what sprays. Armour stays Armour: a
 * doctrine only ever builds from its own table.
 *
 * Styles: a per-side temperament that pulls the Commander's levers.
 */

export type Style = 'cautious' | 'balanced' | 'aggressive' | 'raider';
export const STYLE_IDS: Style[] = ['balanced', 'cautious', 'aggressive', 'raider'];

export interface StyleDef {
  name: string;
  blurb: string;
  /** Multiplies the share of the army it sends on task forces (see taskForces.ts). */
  forces: number;
  /** Multiplies the army it wants over the enemy's defence before a team attack (readiness timing, see offensive.ts). */
  margin: number;
  /** Multiplies how much distance puts it off an outpost (low: it goes far afield). */
  distance: number;
  /** Lean toward fast units in production, -1 to 1 (within the advice limit). */
  fast: number;
}

export const STYLES: Record<Style, StyleDef> = {
  balanced: { name: 'Balanced', blurb: 'The standard Commander', forces: 1, margin: 1, distance: 1, fast: 0 },
  cautious: { name: 'Cautious', blurb: 'Keeps its army together and attacks only with a clear edge', forces: 0.5, margin: 1.25, distance: 1.5, fast: 0 },
  aggressive: { name: 'Aggressive', blurb: 'Attacks sooner and sends more out to take outposts', forces: 1.3, margin: 0.8, distance: 1, fast: 0 },
  raider: { name: 'Raider', blurb: 'Sends lots of small forces after far-off outposts, and builds fast units', forces: 1.7, margin: 1, distance: 0.35, fast: 0.6 },
};

export function isStyle(v: unknown): v is Style {
  return typeof v === 'string' && v in STYLES;
}

/** What a side's army is short of, each -1 (has plenty) to 1 (badly short). */
export interface Needs {
  /** Anti-air against the enemy's aircraft. */
  antiAir: number;
  /** Hard hitters against armour; its negative is the call for weapons that spray infantry. */
  antiArmour: number;
}

/** Strength of anti-air that counts as plenty against no aircraft at all. */
const AIR_PAD = 100;

/** A side's needs from its picture of the battle. */
export function needsOf(side: SidePicture): Needs {
  const enemyAir = side.enemyMix.air > 0 ? side.enemyAir : 0;
  const antiAir = clamp((enemyAir - side.antiAir) / (enemyAir + side.antiAir + AIR_PAD));
  // Weight by what a unit is worth: an infantry squad is about three soldiers, a super unit about three vehicles.
  const armour = side.enemyMix.vehicle + side.enemyMix.super * 3;
  const infantry = side.enemyMix.infantry / 3;
  const antiArmour = armour + infantry > 0 ? clamp(((armour - infantry) / (armour + infantry)) * 0.8) : 0;
  return { antiAir, antiArmour };
}

/** How much a unit answers each need: flak fully, other guns that can shoot aircraft half. */
function answers(def: UnitDef): { antiAir: number; antiArmour: number; antiInfantry: number; fast: number } {
  const w = def.weapon;
  return {
    antiAir: ANTI_AIR.has(def.id) ? 1 : w.targets !== 'ground' ? 0.5 : 0,
    antiArmour: w.damage >= 35 ? 1 : 0,
    antiInfantry: (w.splash >= 1 && w.damage < 35) || w.damage <= 8 ? 1 : 0,
    fast: def.speed >= 3.4 ? 1 : 0,
  };
}

/** The factor on a production entry's weight: 1 ± up to `limit`. */
export function adviceFactor(def: UnitDef, needs: Needs, style: StyleDef, limit: number): number {
  if (limit <= 0) return 1;
  const a = answers(def);
  const score = a.antiAir * needs.antiAir + a.antiArmour * needs.antiArmour - a.antiInfantry * needs.antiArmour + a.fast * style.fast;
  return 1 + limit * clamp(score);
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
