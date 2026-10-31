/**
 * The tide of battle. Each side alternates between building up (defending,
 * massing troops at its rally point) and surging (out-producing the enemy and
 * attacking in force). The two sides are in opposite phase, so the front
 * swings: one army pushes into the enemy base, gets thrown back, and then
 * the other side has its turn.
 */
export const TIDE_PERIOD = 150;
export const TIDE_STRENGTH = 0.6;

/** Production multiplier for a faction at a given time, around 1. */
export function tide(time: number, faction: number): number {
  return 1 + TIDE_STRENGTH * Math.sin((time / TIDE_PERIOD) * Math.PI * 2 + faction * Math.PI);
}

/**
 * Whether a faction is on the offensive. Attacks start a little after the
 * production surge begins, so there's an army to attack with.
 */
export function isAttacking(time: number, faction: number): boolean {
  const phase = (((time / TIDE_PERIOD + (faction === 1 ? 0.5 : 0)) % 1) + 1) % 1;
  return phase > 0.12 && phase < 0.62;
}
