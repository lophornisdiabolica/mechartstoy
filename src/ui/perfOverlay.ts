import { Unit } from '../game/components';
import { Game } from '../game/game';
import { RenderProfile } from '../render/renderProfile';
import { Stage } from '../render/stage';
import { el } from './dom';
import { AudioStats } from '../audio/battleAudio';

/** Seconds between readout updates. */
const EVERY = 0.5;
/** A frame whose page work takes longer than this goes in the hitch log. */
const HITCH_MS = 25;
/** Hitches kept in the log. */
const HITCHES = 5;

/** What a stretch of frames cost, as `measure` and the cost check report it. */
export interface FrameStats {
  frames: number;
  /** Milliseconds between frames on average (vsync caps this: a fast frame still waits for the screen). */
  frameMs: number;
  /** The page's own work per frame, in total and by part. */
  pageMs: number;
  page: Record<string, number>;
  /** GPU milliseconds per frame, in total and by pass; null where the browser has no GPU timers. */
  gpuMs: number | null;
  gpu: Record<string, number> | null;
  calls: number;
  shadowCalls: number;
  triangles: number;
  modelsDrawn: number;
  models: number;
}

/** One thing the cost check turns off, and how to put it back. */
interface CostStep {
  label: string;
  off: () => () => void;
}

/**
 * Render and sim stats in a corner (P toggles it): frame time, where the
 * page's time goes each frame (units, effects, the scene and shadow draws,
 * the post chain, the sim's snapshot...), GPU time per pass where the
 * browser has GPU timers, draw calls and triangles, the sim's time per tick
 * and its slowest systems, a log of hitches (frames whose page work ran
 * long, with what took the time), and a cost check that turns each costly
 * thing off for a moment to show what it costs on this machine.
 *
 * For checking performance work in the browser, the way `npm run bench`
 * does the sim headlessly and `npm run fps` the drawing. While it's
 * showing, the sim times each system (see World.profile); with the sim in
 * its worker, those times come from there.
 */
export class PerfOverlay {
  readonly root = el('div', { id: 'perf', hidden: '' });
  private readonly text = el('div', { class: 'perf-text' });
  private readonly checkButton = el('button', { type: 'button', title: 'Turn shadows, blur, multisampling and each layer off in turn for a moment, and show what each costs on this machine' }, 'Cost check');
  private readonly report = el('div', { class: 'perf-report' });
  private frames = 0;
  private frameTime = 0;
  private worstFrame = 0;
  private ticks = 0;
  private tickTime = 0;
  private worstTick = 0;
  private timer = 0;
  private game: Game | null = null;
  /** Where frames' time goes, while the readout shows or something measures. */
  private readonly profile: RenderProfile;
  /** Things watching the profile besides the readout (measure, the cost check). */
  private watchers = 0;
  private readonly hitches: string[] = [];
  private checking = false;

  private audioMs = 0;
  private audioStarted = 0;
  private audioCues = 0;

  constructor(
    private readonly stage: Stage,
    private readonly audio: AudioStats | null = null,
  ) {
    this.profile = stage.newProfile();
    this.checkButton.addEventListener('click', () => void this.costCheck());
    this.root.append(this.text, this.checkButton, this.report);
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    this.watch();
    this.reset();
  }

  /** A new battle: profile it instead. */
  attach(game: Game): void {
    if (this.game && this.game !== game) this.game.world.profile = null;
    this.game = game;
    this.watch();
    this.reset();
  }

  /** Profile while anything is looking. */
  private watch(): void {
    const on = this.visible || this.watchers > 0;
    if (this.game) this.game.world.profile = on ? (this.game.world.profile ?? new Map()) : null;
    this.stage.profile = on ? this.profile : null;
  }

  /** The top of a frame, before the sim's snapshot is read. */
  beginFrame(): void {
    if (this.stage.profile) this.profile.start();
  }

  /** The part of the frame called `name` (outside the Stage) just finished. */
  lap(name: string): void {
    if (this.stage.profile) this.profile.lap(name);
  }

  /** Time one sim tick. */
  step(run: () => void): void {
    if (!this.visible) return run();
    const t0 = performance.now();
    run();
    const took = performance.now() - t0;
    this.ticks++;
    this.tickTime += took;
    this.worstTick = Math.max(this.worstTick, took);
  }

  /** Ticks played in the sim worker (see RemoteSim), with their times and per-system profile. */
  simFrame(ticks: number, ms: number, worst: number, profile: [string, number][] | null): void {
    if (!this.visible || ticks === 0) return;
    this.ticks += ticks;
    this.tickTime += ms;
    this.worstTick = Math.max(this.worstTick, worst);
    const p = this.game?.world.profile;
    if (p && profile) for (const [k, v] of profile) p.set(k, (p.get(k) ?? 0) + v);
  }

  /** After each rendered frame. */
  frame(frameSeconds: number): void {
    if (this.stage.profile) this.noteHitch();
    if (!this.visible || frameSeconds <= 0) return;
    this.frames++;
    this.frameTime += frameSeconds;
    this.worstFrame = Math.max(this.worstFrame, frameSeconds);
    this.timer += frameSeconds;
    if (this.timer < EVERY || this.checking) return;
    this.text.textContent = this.readout();
    this.reset();
  }

  /** Log the frame just finished if its page work ran long, with the parts that took the time. */
  private noteHitch(): void {
    const parts = [...this.profile.thisFrame()];
    const total = parts.reduce((s, [, v]) => s + v, 0);
    if (total < HITCH_MS) return;
    const top = parts.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
    const t = this.game?.world.time ?? 0;
    const clock = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    this.hitches.unshift(`${clock} ${total.toFixed(0)} ms (${top})`);
    if (this.hitches.length > HITCHES) this.hitches.pop();
    console.info(`[perf] hitch at ${clock}: ${total.toFixed(1)} ms of page work (${top})`);
  }

  private reset(): void {
    this.frames = this.frameTime = this.worstFrame = 0;
    this.ticks = this.tickTime = this.worstTick = 0;
    this.timer = 0;
    this.game?.world.profile?.clear();
    if (!this.checking) this.profile.clear();
  }

  /** The profile's totals since it was last cleared, per frame. */
  private stats(): FrameStats {
    const p = this.profile;
    const n = Math.max(1, p.frames);
    const page = Object.fromEntries([...p.parts].map(([k, v]) => [k, v / n]));
    const g = p.gpu;
    const gpu = g && g.frames > 0 ? Object.fromEntries([...g.parts].map(([k, v]) => [k, v / g.frames])) : null;
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    return {
      frames: p.frames,
      frameMs: this.frames > 0 ? (this.frameTime / this.frames) * 1000 : 0,
      pageMs: sum(page),
      page,
      gpuMs: gpu ? sum(gpu) : null,
      gpu,
      calls: p.calls / n,
      shadowCalls: p.shadowCalls / n,
      triangles: p.triangles / n,
      modelsDrawn: p.modelsDrawn / n,
      models: p.models / n,
    };
  }

  /**
   * What the next `seconds` of frames cost (for `npm run fps` and the cost
   * check): page time by part, GPU time by pass, frame time, draw calls.
   */
  async measure(seconds: number): Promise<FrameStats> {
    this.watchers++;
    this.watch();
    this.profile.clear();
    // Count frame time here too, whether or not the readout is showing.
    let frames = 0;
    let frameTime = 0;
    let last = performance.now();
    const stop = performance.now() + seconds * 1000;
    await new Promise<void>((done) => {
      const tick = () => {
        const now = performance.now();
        frames++;
        frameTime += now - last;
        last = now;
        if (now >= stop) done();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(() => {
        last = performance.now();
        requestAnimationFrame(tick);
      });
    });
    // GPU answers come in a few frames late: give the last ones a moment.
    await new Promise((r) => setTimeout(r, 100));
    const s = this.stats();
    s.frameMs = frames > 0 ? frameTime / frames : 0;
    this.watchers--;
    this.watch();
    return s;
  }

  /**
   * Turn each costly thing off in turn for a moment, on whatever the camera
   * is looking at, and report what each saved on this machine: the page's
   * time and (where the browser has GPU timers) the GPU's.
   */
  async costCheck(seconds = 1.5): Promise<string> {
    if (this.checking) return this.report.textContent ?? '';
    this.checking = true;
    this.checkButton.disabled = true;
    const stage = this.stage;
    const hide = (...objects: (THREE_Object | undefined)[]) => () => {
      const was = objects.map((o) => o?.visible ?? false);
      objects.forEach((o) => o && (o.visible = false));
      return () => objects.forEach((o, i) => o && (o.visible = was[i]));
    };
    const steps: CostStep[] = [
      {
        label: 'shadows',
        off: () => {
          const was = stage.shadows;
          stage.shadows = 'off';
          return () => (stage.shadows = was);
        },
      },
      {
        label: 'tilt-shift blur',
        off: () => {
          const ts = stage.tiltShift;
          const was = ts.settings.enabled;
          ts.settings.enabled = false;
          ts.apply();
          return () => {
            ts.settings.enabled = was;
            ts.apply();
          };
        },
      },
      {
        label: 'multisampling',
        off: () => {
          stage.multisample = false;
          return () => (stage.multisample = true);
        },
      },
      {
        label: 'half the pixels',
        off: () => {
          const was = stage.renderScale;
          stage.renderScale = was * Math.SQRT1_2;
          return () => (stage.renderScale = was);
        },
      },
      { label: 'terrain', off: hide(stage.layer('terrain')) },
      { label: 'woods and props', off: hide(stage.layer('woods'), stage.layer('props')) },
      { label: 'wreckage heaps', off: hide(stage.layer('wreckage')) },
      { label: 'units and buildings', off: hide(stage.layer('batches')) },
      { label: 'effects and smoke', off: hide(stage.layer('effects'), stage.layer('smoke-clouds')) },
    ];
    const ms = (v: number) => v.toFixed(1);
    const lines: string[] = [];
    const show = (extra = '') => (this.report.textContent = [...lines, extra].filter(Boolean).join('\n'));
    try {
      show('Cost check: measuring with everything on...');
      // Settle, then the baseline; it's taken again at the end and averaged, in case things drifted.
      await this.measure(0.4);
      const first = await this.measure(seconds);
      const rows: { label: string; s: FrameStats }[] = [];
      for (const step of steps) {
        show(`Cost check: ${step.label} off...`);
        const undo = step.off();
        await this.measure(0.4);
        rows.push({ label: step.label, s: await this.measure(seconds) });
        undo();
      }
      await this.measure(0.4);
      const again = await this.measure(seconds);
      const base = (k: 'pageMs' | 'frameMs') => (first[k] + again[k]) / 2;
      const gpuBase = first.gpuMs !== null && again.gpuMs !== null ? (first.gpuMs + again.gpuMs) / 2 : null;
      lines.push(`Cost check (each thing off in turn; what it saved per frame)`);
      lines.push(`with everything on: page ${ms(base('pageMs'))} ms${gpuBase !== null ? ` · GPU ${ms(gpuBase)} ms` : ''} · frame ${ms(base('frameMs'))} ms`);
      for (const { label, s } of rows) {
        const gpu = gpuBase !== null && s.gpuMs !== null ? ` · GPU ${ms(gpuBase - s.gpuMs)}` : '';
        lines.push(`${label}: page ${ms(base('pageMs') - s.pageMs)}${gpu} · frame ${ms(base('frameMs') - s.frameMs)}`);
      }
      if (gpuBase === null) lines.push('(no GPU timers in this browser: the frame column is the closest to GPU cost, and vsync hides savings below the screen rate)');
      show();
      console.info(`[perf] ${lines.join('\n')}`);
      return lines.join('\n');
    } finally {
      this.checking = false;
      this.checkButton.disabled = false;
      this.reset();
    }
  }

  private readout(): string {
    const ms = (v: number) => v.toFixed(1);
    const s = this.stats();
    const fps = this.frameTime > 0 ? Math.round(this.frames / this.frameTime) : 0;
    const top = (r: Record<string, number>, n: number) =>
      Object.entries(r)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => `${k} ${ms(v)}`)
        .join(' · ');
    const lines = [
      `frame ${ms((this.frameTime / Math.max(1, this.frames)) * 1000)} ms (worst ${ms(this.worstFrame * 1000)}) · ${fps} fps`,
      `page ${ms(s.pageMs)} ms/frame: ${top(s.page, 5)}`,
      s.gpu ? `GPU ${ms(s.gpuMs!)} ms/frame: ${top(s.gpu, 4)}` : 'GPU timers: not available in this browser',
      `draw calls ${Math.round(s.calls)} (shadows ${Math.round(s.shadowCalls)}) · triangles ${Math.round(s.triangles / 1000)}k · models drawn ${Math.round(s.modelsDrawn)} of ${Math.round(s.models)}`,
      `entity batches ${this.stage.entities?.batches ?? 0} · wreckage pieces ${this.stage.wreckage?.pieces ?? 0} · pixels ${this.stage.pixels()}`,
    ];
    const w = this.game?.world;
    if (w) {
      lines.push(`entities ${w.entityCount} · units ${w.count(Unit)}`);
      if (this.ticks > 0) lines.push(`sim ${ms(this.tickTime / this.ticks)} ms/tick (worst ${ms(this.worstTick)}) · ${this.ticks} ticks`);
      if (w.profile && this.ticks > 0) {
        const t = [...w.profile].sort((a, b) => b[1] - a[1]).slice(0, 5);
        lines.push(t.map(([k, v]) => `${k} ${(v / this.ticks).toFixed(2)}`).join(' · '));
      }
    }
    const a = this.audio;
    if (a && a.cues > 0) {
      const per = (v: number) => Math.round(v / this.frameTime);
      lines.push(
        `audio ${ms((a.ms - this.audioMs) / this.frames)} ms/frame · ${per(a.cues - this.audioCues)} sounds/s asked, ${per(a.started - this.audioStarted)} played · ${a.playing} voices · war level ${Math.round(a.level * 100)}%`,
      );
      this.audioMs = a.ms;
      this.audioStarted = a.started;
      this.audioCues = a.cues;
    }
    if (this.hitches.length > 0) lines.push(`hitches (page work over ${HITCH_MS} ms): ${this.hitches.join(' · ')}`);
    return lines.join('\n');
  }
}

type THREE_Object = { visible: boolean };
