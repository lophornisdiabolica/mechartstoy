import { Rng } from '../core/rng';
import { DOCTRINE_IDS, DoctrineId } from './doctrines';
import { BattleSettings, defaultFaction } from './settings';
import { assignIdentities, rollBattle, Roll } from './variety';

/**
 * Tournament mode (a between-battles option): the toy runs a knockout
 * bracket of doctrines, one 1v1 battle per match. The settings say how many
 * entrants (2 to 16, eight by default), drawn at random from the
 * between-battles doctrine pool: each doctrine once while the pool lasts,
 * and if it's smaller than the field, some come in twice (or more), the
 * second as a made-up side of the same doctrine. A field that isn't 2, 4, 8
 * or 16 gives some entrants a bye through the first round. The winner of
 * each match goes through; a bracket card between battles shows where it
 * stands. After the final a new bracket is drawn.
 */

/** Minutes an Eternal-mode match lasts when the settings set no time limit (the stronger army goes through). */
export const ETERNAL_MATCH = 15;

/** Entrants in a bracket unless the settings say otherwise, and the most it takes. */
export const BRACKET_SIZE = 8;
export const MOST_ENTRANTS = 16;

export interface Bracket {
  /** Which tournament this is (1, 2, ...). */
  number: number;
  /**
   * The doctrines in their draw order: the first match is entrants 0 and 1,
   * the next 2 and 3, and so on. A null is a bye: whoever it's drawn
   * against goes straight through.
   */
  entrants: (DoctrineId | null)[];
  /** Each round's winners so far, in match order (null until the match is played). */
  rounds: (DoctrineId | null)[][];
  /** Which of each match's two went through (0 the first-listed, 1 the second), as rounds; the same doctrine can meet itself. */
  through: (0 | 1 | null)[][];
}

export interface Match {
  round: number;
  /** Which match of the round, from 0. */
  index: number;
  a: DoctrineId;
  b: DoctrineId;
}

/**
 * Draw a new bracket of `size` entrants from `pool` (all doctrines if
 * empty): each doctrine once, at random, then (if the pool runs out) again,
 * as few times each as will fill the field. Byes go to entrants spread
 * through the draw.
 */
export function drawBracket(pool: readonly DoctrineId[], rng: Rng, number = 1, size = BRACKET_SIZE): Bracket {
  const from = [...new Set(pool.length > 0 ? pool : DOCTRINE_IDS)];
  const n = Math.max(2, Math.min(MOST_ENTRANTS, Math.round(size)));
  const shuffle = <T>(list: T[]): T[] => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  };
  // Each doctrine once per pass through the pool, in a fresh random order each pass.
  const picked: DoctrineId[] = [];
  while (picked.length < n) picked.push(...shuffle([...from]).slice(0, n - picked.length));
  shuffle(picked);
  let slots = 2;
  while (slots < n) slots *= 2;
  const matches = slots / 2;
  const byes = slots - n;
  // The first-round matches that are byes, spread through the draw.
  const byeAt = new Set(Array.from({ length: byes }, (_, k) => Math.floor((k * matches) / byes)));
  const entrants: (DoctrineId | null)[] = [];
  for (let m = 0; m < matches; m++) {
    entrants.push(picked.shift()!);
    entrants.push(byeAt.has(m) ? null : picked.shift()!);
  }
  // A doctrine drawn twice shouldn't meet itself in the first round if a swap can help it.
  for (let m = 0; m < matches; m++) {
    const [a, b] = [entrants[m * 2], entrants[m * 2 + 1]];
    if (b === null || a !== b) continue;
    for (let k = 0; k < entrants.length; k++) {
      const other = entrants[k];
      const partner = entrants[k ^ 1];
      if (other === null || other === a || Math.floor(k / 2) === m || partner === a || partner === null) continue;
      entrants[k] = b;
      entrants[m * 2 + 1] = other;
      break;
    }
  }
  const rounds: (DoctrineId | null)[][] = [];
  const through: (0 | 1 | null)[][] = [];
  for (let k = matches; k >= 1; k /= 2) {
    rounds.push(new Array<DoctrineId | null>(k).fill(null));
    through.push(new Array<0 | 1 | null>(k).fill(null));
  }
  // A bye puts its entrant straight through.
  for (const m of byeAt) {
    rounds[0][m] = entrants[m * 2];
    through[0][m] = 0;
  }
  return { number, entrants, rounds, through };
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

/** Put the winner of the next match through: its first-listed side (0, a) or its second (1, b). */
export function recordWinner(b: Bracket, side: 0 | 1): void {
  const m = nextMatch(b);
  if (!m) return;
  b.rounds[m.round][m.index] = side === 1 ? m.b : m.a;
  b.through[m.round][m.index] = side;
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
