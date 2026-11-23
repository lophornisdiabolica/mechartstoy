/**
 * Where a frame's time goes on the page and on the GPU, for the stats
 * readout (P) and `npm run fps`. Only kept while something is reading it:
 * Stage.profile is null otherwise, and the drawing code skips all of this.
 *
 * Page time is measured in laps: `start` at the top of a frame, then each
 * part calls `lap(name)` when it finishes, and the time since the last lap
 * goes to that name. GPU time comes from the browser's GPU timers
 * (EXT_disjoint_timer_query_webgl2, which Chrome and Edge on Windows have;
 * Firefox and Safari mostly don't), whose answers arrive a few frames late.
 */
export class RenderProfile {
  /** Page milliseconds per part, summed since `clear`. */
  readonly parts = new Map<string, number>();
  /** This frame's parts so far (for the hitch log). */
  private readonly current = new Map<string, number>();
  /** Frames since `clear`. */
  frames = 0;
  /** Draw calls since `clear`: all of them, and those in the shadow pass. */
  calls = 0;
  shadowCalls = 0;
  triangles = 0;
  /** Models drawn and models there are, summed over frames (see EntityView.cull). */
  modelsDrawn = 0;
  models = 0;
  readonly gpu: GpuTimer | null;
  private t = 0;

  constructor(gl: WebGL2RenderingContext | null) {
    this.gpu = gl ? GpuTimer.create(gl) : null;
  }

  /** A new frame begins. */
  start(): void {
    this.current.clear();
    this.frames++;
    this.t = performance.now();
  }

  /** The part called `name` just finished: it took the time since the last lap. */
  lap(name: string): void {
    const now = performance.now();
    this.add(name, now - this.t);
    this.t = now;
  }

  /** The parts of the frame under way (or just finished, until the next `start`). */
  thisFrame(): ReadonlyMap<string, number> {
    return this.current;
  }

  add(name: string, ms: number): void {
    this.parts.set(name, (this.parts.get(name) ?? 0) + ms);
    this.current.set(name, (this.current.get(name) ?? 0) + ms);
  }

  clear(): void {
    this.parts.clear();
    this.frames = this.calls = this.shadowCalls = this.triangles = this.modelsDrawn = this.models = 0;
    this.gpu?.clear();
  }
}

interface Pending {
  query: WebGLQuery;
  name: string;
  /** The last stretch of its frame: when it's in, the frame is counted. */
  last?: boolean;
}

/**
 * GPU time per named stretch of a frame. WebGL allows one timer running at
 * a time, so `begin` ends whatever was running: a frame is timed as a run
 * of stretches (scene, shadows, scene again, post), each added to its name.
 */
export class GpuTimer {
  /** GPU milliseconds per name, summed since `clear`, and how many frames' worth have come in. */
  readonly parts = new Map<string, number>();
  frames = 0;
  private running: Pending | null = null;
  private readonly pending: Pending[] = [];
  private readonly spare: WebGLQuery[] = [];

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number },
  ) {}

  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(name: string): void {
    this.end();
    const query = this.spare.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.running = { query, name };
  }

  end(): void {
    if (!this.running) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.running);
    this.running = null;
  }

  /** The frame's last stretch is done: collect any answers that have come in. */
  endFrame(): void {
    this.end();
    if (this.pending.length > 0) this.pending[this.pending.length - 1].last = true;
    const gl = this.gl;
    // A disjoint (the GPU was interrupted: power state, another app) spoils every answer in flight.
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    let done = 0;
    while (done < this.pending.length && gl.getQueryParameter(this.pending[done].query, gl.QUERY_RESULT_AVAILABLE)) done++;
    for (const p of this.pending.splice(0, done)) {
      if (!disjoint) {
        const ms = (gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number) / 1e6;
        this.parts.set(p.name, (this.parts.get(p.name) ?? 0) + ms);
        if (p.last) this.frames++;
      }
      this.spare.push(p.query);
    }
    // Answers that never come (a lost context) mustn't pile up.
    if (this.pending.length > 64) for (const p of this.pending.splice(0, this.pending.length - 64)) this.spare.push(p.query);
  }

  clear(): void {
    this.parts.clear();
    this.frames = 0;
  }
}
