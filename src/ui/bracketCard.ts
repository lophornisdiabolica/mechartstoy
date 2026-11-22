import { canonicalDoctrine, DOCTRINE_IDS, DOCTRINES, DoctrineId } from '../game/doctrines';
import { FACTIONS } from '../game/factions';
import { Bracket, champion, matchName, nextMatch } from '../game/tournament';
import { el, textHex } from './dom';

/** A doctrine's name in its own faction's colour. */
function entrant(d: DoctrineId | null, state: 'won' | 'lost' | 'upcoming' | ''): HTMLElement {
  if (d === null) return el('div', { class: 'entrant tbd' }, '—');
  const node = el('div', { class: `entrant ${state}` }, DOCTRINES[d].name);
  const home = FACTIONS[DOCTRINE_IDS.indexOf(canonicalDoctrine(d))];
  if (home) node.style.color = textHex(home.primary);
  return node;
}

/**
 * The tournament's bracket, for the banner between battles: a column per
 * round, each match's two doctrines with the winner marked and the loser
 * struck through, and the next match picked out.
 */
export function bracketCard(b: Bracket): HTMLElement {
  const card = el('div', { class: 'bracket' });
  const next = nextMatch(b);
  const won = champion(b);
  card.append(el('div', { class: 'heading' }, won ? `${DOCTRINES[won].name} won tournament ${b.number}` : next ? `Tournament ${b.number} · next: ${matchName(b, next)}` : `Tournament ${b.number}`));
  const grid = el('div', { class: 'rounds' });
  for (let round = 0; round < b.rounds.length; round++) {
    const col = el('div', { class: 'round' });
    const fieldOf = round === 0 ? b.entrants : b.rounds[round - 1];
    b.rounds[round].forEach((winner, index) => {
      const m = el('div', { class: 'match' });
      const isNext = next !== null && next.round === round && next.index === index;
      if (isNext) m.classList.add('upcoming');
      for (const d of [fieldOf[index * 2], fieldOf[index * 2 + 1]]) {
        m.append(entrant(d, winner === null ? (isNext ? 'upcoming' : '') : d === winner ? 'won' : 'lost'));
      }
      col.append(m);
    });
    grid.append(col);
  }
  card.append(grid);
  return card;
}
