import { System } from '../core/ecs';
import { SimContext } from './context';
import { MAP_SIZES, rampFor } from './settings';

/**
 * The tide of battle. Each side alternates between building up (defending,
 * massing troops at its rally point) and surging (out-producing the enemy and
 * attacking in force). Teams are spread evenly round the cycle (two teams sit
 * in opposite phase), so the front swings: one army pushes into an enemy
 * base, gets thrown back, and then another side has its turn. Allies share a
 * phase, so they attack together. The `phase` arguments below are a side's
 * offset into the cycle, 0..1 (see Sides.phase).
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

/**
 * The tide for a map `cols` cells long. Bigger maps need longer tides: an
 * attack window is half the cycle, and on a large map a tide tuned for medium
 * ends while the attackers are still crossing the middle. So the cycle
 * stretches with the map's length past the medium size the defaults are tuned
 * on (it never shrinks; small maps are fine as they are).
 */
export function tideForMap(t: TideSettings, cols: number): TideSettings {
  return { tideStrength: t.tideStrength, tidePeriod: t.tidePeriod * Math.max(1, cols / MAP_SIZES.medium.cols) };
}

/** Seconds over which the ramp adds its rate once. */
export const RAMP_INTERVAL = 300;
/** The ramp stops growing at this level, so Eternal battles level off. */
export const RAMP_MAX = 2;

/**
 * Advance an escalation level by one tick. A level starts at 0 and grows by
 * its ramp rate every RAMP_INTERVAL seconds, up to RAMP_MAX. There are two,
 * set separately (see RampSettings):
 * - tide: the tide swings (1 + level) times as hard, so late in a battle the
 *   surging side floods the field while the other side is starved;
 * - siege: hits on buildings do (1 + level) times the damage, so a won field
 *   turns into a won battle.
 *
 * Overall production deliberately doesn't grow: more units for both sides
 * favours the defender, whose reinforcements roll straight out of the door
 * while the attacker's have to cross the map (measured: it made Conquest
 * battles longer, not shorter).
 *
 * Levels are integrated tick by tick (rather than computed from the clock) so
 * changing a ramp mid-battle only changes how fast it grows from here.
 */
export function escalate(level: number, ramp: number, dt: number): number {
  return Math.min(RAMP_MAX, level + (ramp * dt) / RAMP_INTERVAL);
}

/**
 * Cycles over which the swing fades in at the start of a battle. Without it,
 * whichever team surges first meets an enemy at the bottom of its tide and
 * wins the opening clash, and in Conquest that decided the battle (11 times
 * in 12). Fading in makes the opening fair: the first surger now wins about
 * half the time.
 */
const TIDE_FADE_IN = 1;

/** The lowest the tide can push production, once the ramp swings it past 1. */
const TIDE_FLOOR = 0.1;

/** Production multiplier for a side at a given time, around 1. `level` is the tide ramp's level. */
export function tide(time: number, phase: number, t: TideSettings = DEFAULT_TIDE, level = 0): number {
  const strength = t.tideStrength * (1 + level) * Math.min(1, time / (t.tidePeriod * TIDE_FADE_IN));
  return Math.max(TIDE_FLOOR, 1 + strength * Math.sin((time / t.tidePeriod + phase) * Math.PI * 2));
}

/**
 * Whether a faction is on the offensive. Attacks start a little after the
 * production surge begins, so there's an army to attack with.
 */
export function isAttacking(time: number, phase: number, t: TideSettings = DEFAULT_TIDE): boolean {
  const at = (((time / t.tidePeriod + phase) % 1) + 1) % 1;
  return at > ATTACK_START && at < ATTACK_END;
}

/**
 * Which attack a faction is on or building up to. It ticks over when an
 * attack ends, so the build-up and the attack that follows share a number.
 */
export function attackNumber(time: number, phase: number, t: TideSettings = DEFAULT_TIDE): number {
  return Math.floor(time / t.tidePeriod + phase - ATTACK_END);
}

/** Advances the battle's escalation levels. */
export function escalationSystem(ctx: SimContext): System {
  return {
    name: 'escalation',
    update(_world, dt) {
      const ramp = rampFor(ctx.settings);
      ctx.escalation.tide = escalate(ctx.escalation.tide, ramp.tide, dt);
      ctx.escalation.siege = escalate(ctx.escalation.siege, ramp.siege, dt);
    },
  };
}
