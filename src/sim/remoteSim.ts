import { Entity } from '../core/ecs';
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
 * one, and copies in the newest answer, so the worker plays the next
 * ticks while the page draws. If the worker hasn't answered by the next
 * frame, the due ticks wait for the next ask, so a busy worker answers
 * less often with more ticks at a time.
 *
 * Drawing follows its own clock rather than the answers: answers carry
 * every tick's positions (see mirror.ts), and the view is drawn at the
 * clock's time along that path, a little behind the newest tick. When the
 * worker can't keep up, the clock slows down, so the battle plays a little
 * slower but stays smooth, instead of standing still and then jumping.
 */
export class RemoteSim {
  private readonly worker: Worker;
  private battle = 0;
  private view: SimView | null = null;
  private waiting = false;
  private due = 0;
  private inbox: Frame | null = null;
  private clock = new DrawClock();
  /** Entities not to draw yet (see SimView.unborn). */
  get hidden(): ReadonlySet<Entity> | null {
    return this.view?.unborn ?? null;
  }

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
    this.clock = new DrawClock();
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
   * Before drawing: advance the drawing clock (`simSeconds` is the frame's
   * time scaled by the speed), copy in the newest answer and ask for the
   * ticks due now. Returns the interpolation alpha to draw with.
   */
  sync(simSeconds: number): number {
    if (!this.view) return 1;
    this.clock.advance(simSeconds);
    if (this.inbox) {
      const frame = this.inbox;
      this.inbox = null;
      this.view.apply(frame);
      this.clock.arrived(frame.time);
      this.onFrame?.(frame);
    }
    const alpha = this.view.pose(this.clock.time);
    if (!this.waiting) {
      this.post({ type: 'step', battle: this.battle, steps: this.due, profile: this.view.game.world.profile !== null });
      this.waiting = true;
      this.due = 0;
    }
    return alpha;
  }

  private post(m: ToSim): void {
    this.worker.postMessage(m);
  }
}

/**
 * The sim time to draw (see RemoteSim): a clock that runs at the battle's
 * speed, but slows when the next answer is late and speeds up a little
 * when answers bunch up, staying about one answer behind the newest state.
 */
export class DrawClock {
  /** The sim time to draw. */
  time = 0;
  /** The newest sim time there's a state for. */
  private newest = 0;
  /** Sim seconds each answer moves on, on average. */
  private lead = 0;

  /** A frame went by (`simSeconds` of battle time at the current speed). */
  advance(simSeconds: number): void {
    const gap = this.newest - this.time;
    const pace = this.lead > 0 ? Math.min(1.5, Math.max(0.25, gap / this.lead)) : 1;
    this.time = Math.min(this.newest, this.time + simSeconds * pace);
  }

  /** A state for sim time `time` arrived. */
  arrived(time: number): void {
    if (time <= this.newest) return;
    const step = time - this.newest;
    this.lead = this.lead > 0 ? this.lead + (step - this.lead) * 0.2 : step;
    this.newest = time;
  }
}
