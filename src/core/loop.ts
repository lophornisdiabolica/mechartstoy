/**
 * Fixed-timestep simulation with variable-rate rendering.
 *
 * The simulation always advances in exact `stepSeconds` increments, which keeps
 * combat deterministic and independent of frame rate. Rendering gets an `alpha`
 * in [0, 1) describing how far we are between the last two sim states, so it
 * can interpolate positions smoothly.
 */
export interface LoopCallbacks {
  step(dt: number): void;
  render(alpha: number, frameSeconds: number): void;
}

export class FixedLoop {
  /** Multiplier on simulation speed (0 = paused). */
  timeScale = 1;

  private accumulator = 0;
  private lastTime = -1;
  private rafId = 0;

  constructor(
    readonly stepSeconds: number,
    private readonly callbacks: LoopCallbacks,
    /** Cap on sim steps per frame, so a long stall doesn't spiral. */
    private readonly maxStepsPerFrame = 8,
  ) {}

  start(): void {
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      this.advance(now / 1000);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
    this.lastTime = -1;
  }

  /** Exposed for tests; normally driven by requestAnimationFrame. Returns steps run. */
  advance(nowSeconds: number): number {
    const frameSeconds = this.lastTime < 0 ? 0 : Math.min(nowSeconds - this.lastTime, 0.25);
    this.lastTime = nowSeconds;
    this.accumulator += frameSeconds * this.timeScale;

    let steps = 0;
    while (this.accumulator >= this.stepSeconds && steps < this.maxStepsPerFrame) {
      this.callbacks.step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      steps++;
    }
    if (steps === this.maxStepsPerFrame) this.accumulator = Math.min(this.accumulator, this.stepSeconds);

    this.callbacks.render(this.accumulator / this.stepSeconds, frameSeconds);
    return steps;
  }
}
