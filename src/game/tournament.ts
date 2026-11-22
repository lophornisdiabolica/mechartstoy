import { Rng } from '../core/rng';
import { DOCTRINE_IDS, DoctrineId } from './doctrines';
import { BattleSettings, defaultFaction } from './settings';
import { assignIdentities, rollBattle, Roll } from './variety';

/**
 * Tournament mode (a between-battles option): the toy runs a knockout
 * bracket of doctrines, one 1v1 battle per match. Eight doctrines, drawn at
 * random from the between-battles doctrine pool, meet in quarter-finals,
 * semi-finals and a final (fewer if the pool is smaller: four, or two); the
 * winner of each match goes through. A bracket card between battles shows
 * where it stands. After the final a new bracket is drawn.
 */

/** Minutes an Eternal-mode match lasts when the settings set no time limit (the stronger army goes through). */
export const ETERNAL_MATCH = 15;

/** The most doctrines in a bracket. */
export const BRACKET_SIZE = 8;

export interface Bracket {
  /** Which tournament this is (1, 2, ...). */
  number: number;
  /** The doctrines in their draw order: the first match is entrants 0 and 1, the next 2 and 3, and so on. */
  entrants: DoctrineId[];
  /** Each round's winners so far, in match order (null until the match is played). */
  rounds: (DoctrineId | null)[][];
}

export interface Match {
  round: number;
  /** Which match of the round, from 0. */
  index: number;
  a: DoctrineId;
  b: DoctrineId;
}

/** Draw a new bracket from `pool` (all doctrines if empty): the biggest of 8, 4 or 2 that the pool fills without repeats. */
export function drawBracket(pool: readonly DoctrineId[], rng: Rng, number = 1): Bracket {
  const from = [...new Set(pool.length > 0 ? pool : DOCTRINE_IDS)];
  const size = from.length >= 8 ? 8 : from.length >= 4 ? 4 : 2;
  for (let i = from.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [from[i], from[j]] = [from[j], from[i]];
  }
  // A pool of one plays itself.
  const entrants = Array.from({ length: size }, (_, i) => from[i % from.length]);
  const rounds: (DoctrineId | null)[][] = [];
  for (let n = size / 2; n >= 1; n /= 2) rounds.push(new Array<DoctrineId | null>(n).fill(null));
  return { number, entrants, rounds };
}

/** Who meets in a round: the entrants for the first, the last round's winners after. */
function field(b: Bracket, round: number): (DoctrineId | null)[] {
  return round === 0 ? b.entrants : b.rounds[round - 1];
}

/** The next match to play, or null once the final is decided. */
export function nextMatch(b: Bracket): Match | null {
  for (let round = 0; round < b.rounds.length; round++) {
    const index = b.rounds[round].indexOf(null);
    if (index < 0) continue;
    const meet = field(b, round);
    return { round, index, a: meet[index * 2]!, b: meet[index * 2 + 1]! };
  }
  return null;
}

/** Put the winner of the next match through. */
export function recordWinner(b: Bracket, winner: DoctrineId): void {
  const m = nextMatch(b);
  if (!m) return;
  b.rounds[m.round][m.index] = winner === m.b ? m.b : m.a;
}

/** The champion, once the final is played. */
export function champion(b: Bracket): DoctrineId | null {
  return b.rounds[b.rounds.length - 1][0];
}

/** "Quarter-final 2", "Semi-final 1", "Final". */
export function matchName(b: Bracket, m: Match): string {
  const fromEnd = b.rounds.length - 1 - m.round;
  const name = ['Final', 'Semi-final', 'Quarter-final'][fromEnd] ?? `Round ${m.round + 1}`;
  return fromEnd === 0 ? name : `${name} ${m.index + 1}`;
}

/**
 * The settings for a match: whatever else the between-battles options
 * re-roll (map style, biome, size), with two sides, one for each doctrine,
 * on their doctrines' own names and colours.
 */
export function matchSettings(base: BattleSettings, m: Match, rng: Rng): Roll {
  const s = structuredClone(base);
  s.variety.roll.sides = false;
  s.variety.roll.doctrines = false;
  const roll = rollBattle(s, rng);
  const out = roll.settings;
  // Plain sides, so each takes its doctrine's own name and colour (see assignIdentities).
  out.factions = [m.a, m.b].map((doctrine, i) => ({ ...defaultFaction(i), team: i, doctrine, style: base.factions[i]?.style ?? 'balanced' }));
  out.map.placed.bases = null;
  if (out.map.outposts === 'auto') out.map.placed.outposts = null;
  assignIdentities(out, rng.fork(0x7e57));
  out.variety = structuredClone(base.variety);
  // An Eternal war never ends by itself: give a match a time limit if the settings don't.
  if (out.mode === 'eternal' && out.variety.after === 0) out.variety.after = ETERNAL_MATCH;
  return roll;
}
