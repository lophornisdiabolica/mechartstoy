/**
 * The tide of battle. Each side alternates between building up (defending,
 * massing troops at its rally point) and surging (out-producing the enemy and
 * attacking in force). The two sides are in opposite phase, so the front
 * swings: one army pushes into the enemy base, gets thrown back, and then
 * the other side has its turn.
 */
export interface TideSettings {
  /** How hard production swings, 0 (steady) to 1. */
  tideStrength: number;
  /** Seconds for one full cycle. */
  tidePeriod: number;
}

/** The attack window, as a fraction of the tide cycle. */
const ATTACK_START = 0.12;
const ATTACK_END = 0.62;

export const DEFAULT_TIDE: TideSettings = { tideStrength: 0.6, tidePeriod: 150 };

/** Production multiplier for a faction at a given time, around 1. */
export function tide(time: number, faction: number, t: TideSettings = DEFAULT_TIDE): number {
  return 1 + t.tideStrength * Math.sin((time / t.tidePeriod) * Math.PI * 2 + faction * Math.PI);
}

/**
 * Whether a faction is on the offensive. Attacks start a little after the
 * production surge begins, so there's an army to attack with.
 */
export function isAttacking(time: number, faction: number, t: TideSettings = DEFAULT_TIDE): boolean {
  const phase = (((time / t.tidePeriod + (faction === 1 ? 0.5 : 0)) % 1) + 1) % 1;
  return phase > ATTACK_START && phase < ATTACK_END;
}

/**
 * Which attack a faction is on or building up to. It ticks over when an
 * attack ends, so the build-up and the attack that follows share a number.
 */
export function attackNumber(time: number, faction: number, t: TideSettings = DEFAULT_TIDE): number {
  return Math.floor(time / t.tidePeriod + (faction === 1 ? 0.5 : 0) - ATTACK_END);
}
