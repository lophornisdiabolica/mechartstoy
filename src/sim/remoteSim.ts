import { Game } from '../game/game';
import { BattleSettings } from '../game/settings';
import { Frame, FromSim, SimView, ToSim } from './mirror';

/** Most ticks asked for at once; if the worker falls further behind than this, the battle slows down instead. */
const MAX_BATCH = 16;

/**
 * The page's end of the sim worker (see simWorker.ts and mirror.ts). The
 * worker plays the battle; this keeps a view Game in step with it for the
 * renderer and UI.
 *
 * Each animation frame asks for the ticks that came due since the last
 * one and shows the answer to the previous ask, so the worker plays the
 * next ticks while the page draws. What's on screen is one frame behind,
 * and drawn with the interpolation alpha that went with it, so motion stays
 * smooth. If the worker hasn't answered by the next frame, the due ticks
 * wait for the next ask.
 */
export class RemoteSim {
  private readonly worker: Worker;
  private battle = 0;
  private view: SimView | null = null;
  private waiting = false;
  private due = 0;
  private inbox: Frame | null = null;
  private sentAlpha = 0;
  private shownAlpha = 0;
  /** After a frame is shown: the ticks it covered, how long they took in all, the slowest, and the per-system profile if asked for. */
  onFrame: ((frame: Frame) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromSim>) => {
      const m = ev.data;
      if (m.type === 'error') {
        console.error(`Sim worker: ${m.message}`);
        return;
      }
      // An answer for a battle that's since been replaced.
      if (m.battle !== this.battle) return;
      this.inbox = m.frame;
      this.waiting = false;
    };
    this.worker.onerror = (e) => console.error('Sim worker failed:', e.message);
  }

  /** Start a battle in the worker. Returns the view to render and read. */
  start(seed: number, settings: BattleSettings): Game {
    this.battle++;
    const game = new Game(seed, { settings, view: true });
    const battle = this.battle;
    game.forward = (command) => this.post({ type: 'command', battle, command });
    this.view = new SimView(game);
    this.post({ type: 'start', battle, seed, settings });
    this.waiting = false;
    this.due = 0;
    this.inbox = null;
    this.shownAlpha = this.sentAlpha = 0;
    return game;
  }

  /** The battle's settings changed live (the control panel): pass them on. */
  settings(settings: BattleSettings): void {
    this.post({ type: 'settings', battle: this.battle, settings });
  }

  /** One more tick came due (FixedLoop's step). */
  step(): void {
    this.due = Math.min(MAX_BATCH, this.due + 1);
  }

  /**
   * Before drawing: show the newest answer and ask for the ticks due now.
   * Returns the interpolation alpha to draw the shown state with.
   */
  sync(alpha: number): number {
    if (!this.view) return alpha;
    if (this.inbox) {
      const frame = this.inbox;
      this.inbox = null;
      this.view.apply(frame);
      this.shownAlpha = this.sentAlpha;
      this.onFrame?.(frame);
    }
    if (!this.waiting) {
      this.post({ type: 'step', battle: this.battle, steps: this.due, profile: this.view.game.world.profile !== null });
      this.waiting = true;
      this.due = 0;
      this.sentAlpha = alpha;
    }
    return this.shownAlpha;
  }

  private post(m: ToSim): void {
    this.worker.postMessage(m);
  }
}
