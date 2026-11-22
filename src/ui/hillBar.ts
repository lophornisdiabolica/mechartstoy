import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { hillOf, teamHeld } from '../game/hill';
import { el, hex } from './dom';

/**
 * King of the hill's scoreboard, top middle: one bar per team filling as it
 * holds the hill, in its first side's colour, with the time left. The
 * holder's bar is marked, and dims while enemies in the ring stop its clock.
 */
export class HillBar {
  readonly root = el('div', { id: 'hillbar', hidden: '' });
  private game: Game | null = null;
  private rows: { team: number; fill: HTMLElement; time: HTMLElement; row: HTMLElement }[] = [];

  constructor() {
    document.body.append(this.root);
  }

  attach(game: Game, factions: readonly FactionDef[]): void {
    this.game = game;
    this.root.replaceChildren();
    this.rows = [];
    this.root.hidden = !game.ctx.hill;
    if (!game.ctx.hill) return;
    this.root.append(el('div', { class: 'title' }, 'The hill'));
    for (const team of game.ctx.sides.teamList) {
      const members = factions.filter((f) => game.ctx.sides.teams[f.id] === team);
      const row = el('div', { class: 'row' });
      const name = el('span', { class: 'name' }, members.map((f) => f.name).join(' & '));
      const bar = el('span', { class: 'bar' });
      const fill = el('span', { class: 'fill' });
      fill.style.background = hex(members[0].primary);
      bar.append(fill);
      const time = el('span', { class: 'time' });
      row.append(name, bar, time);
      this.root.append(row);
      this.rows.push({ team, fill, time, row });
    }
  }

  /** Each frame. */
  update(hidden: boolean): void {
    const game = this.game;
    if (!game?.ctx.hill) return;
    this.root.hidden = hidden;
    const goal = game.settings.armies.hillHold;
    const hill = hillOf(game.ctx)!;
    const holder = hill.owner >= 0 ? game.ctx.sides.teams[hill.owner] : null;
    const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    for (const r of this.rows) {
      const held = Math.min(goal, teamHeld(game.ctx, r.team));
      r.fill.style.width = `${(held / goal) * 100}%`;
      r.time.textContent = clock(goal - held);
      const holding = r.team === holder;
      r.row.classList.toggle('holding', holding);
      r.row.classList.toggle('contested', holding && game.ctx.hill.contested);
    }
  }
}
