import { NEUTRAL } from '../game/components';
import { GameEvents } from '../game/context';
import { Game } from '../game/game';
import { BiomeId } from '../world/biomes';
import { Activity, choose, Cue, Listener, place } from './mixer';
import { AudioPrefs, CATEGORIES, loadAudioPrefs, saveAudioPrefs, SoundCategory } from './prefs';
import { LOOP_IDS, LoopId, renderLoop, renderReverb, renderSound, SOUND_IDS, SoundId, variantsOf } from './synth';
import type { FromAudioWorker } from './audioWorker';

/** How loud each sound is next to the others, before any settings. */
const LOUDNESS: Record<SoundId, number> = {
  rifle: 0.32,
  flame: 0.3,
  cannon: 0.55,
  missile: 0.4,
  launch: 0.6,
  thud: 0.42,
  blast: 0.95,
  wreck: 0.65,
  collapse: 0.75,
  build: 0.3,
  dig: 0.3,
  quake: 1,
  chimeCapture: 0.5,
  chimeFell: 0.5,
  chimeRazed: 0.55,
  chimeOut: 0.55,
  chimeWin: 0.6,
  chimeGod: 0.4,
};

/** How much each kind of thing stirs the overall war level (see Activity). */
const STIR = { bullet: 0.06, flame: 0.05, shell: 0.35, missile: 0.3, artillery: 0.9, blast: 1.6, wreck: 0.8, collapse: 2 };

/** How windy each biome sounds, 0 to 1. */
const WIND: Record<BiomeId, number> = { temperate: 0.45, desert: 0.7, snow: 0.85, forest: 0.3 };

/** Cut-off of the muffled path that far-away sounds go through, in Hz (recorded distant blasts have almost nothing above 1 kHz). */
const FAR_CUTOFF = 600;
/** Cut-off of the "near" path, zoomed in and zoomed out: air takes the top off even close sounds seen from up high. */
const AIR_IN = 7000;
const AIR_OUT = 3200;
/** How much of a voice's wet share reaches the reverb. */
const WET = 0.55;
/** Seconds alert chimes are kept apart, so a flurry of captures doesn't jangle. */
const ALERT_GAP = 0.9;
/** How much quieter it all is while the setup screen is up over the backdrop battle. */
const BEHIND_SETUP = 0.35;

interface Bus {
  near: GainNode;
  far: GainNode;
  wet: GainNode;
}

/** Per-session counters for the P stats overlay and for checking performance. */
export interface AudioStats {
  /** Sounds the battle asked for, voices actually started, and those dropped for budget or being too quiet. */
  cues: number;
  started: number;
  dropped: number;
  /** Voices playing now. */
  playing: number;
  /** Main-thread milliseconds spent on audio, all told. */
  ms: number;
  /** The war level the beds follow, 0 to 1. */
  level: number;
}

/**
 * The battle's sound: procedural one-shots for shots, blasts and alerts, and
 * looping beds of wind and distant war, all made in synth.ts. It listens to
 * the same game events the effects do and places each sound by where the
 * camera is looking (see mixer.place). It lives as long as the page; attach()
 * moves it to each new battle.
 *
 * The browser only allows sound after the player has clicked or pressed a
 * key, so nothing is built until then.
 */
export class BattleAudio {
  readonly prefs: AudioPrefs = loadAudioPrefs();
  readonly stats: AudioStats = { cues: 0, started: 0, dropped: 0, playing: 0, ms: 0, level: 0 };
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<SoundCategory, Bus>();
  private buffers = new Map<SoundId, AudioBuffer[]>();
  private beds = new Map<LoopId, GainNode>();
  private air: BiquadFilterNode | null = null;
  private reverb: ConvolverNode | null = null;
  private game: Game | null = null;
  private cues: Cue[] = [];
  private playing: Record<SoundCategory, number> = { gunfire: 0, cannons: 0, explosions: 0, buildings: 0, alerts: 0, ambience: 0 };
  private voices = 0;
  private readonly activity = new Activity();
  /** Gunfire alone, for the distant-gunfire bed. */
  private readonly fire = new Activity(2, 8);
  private alertQueue: Cue[] = [];
  private alertWait = 0;
  private listener: Listener = { x: 0, z: 0, radius: 50, rightX: 1, rightZ: 0, zoomOut: 0.5 };
  private wind = WIND.temperate;
  private ducked = false;
  private unsubscribe: (() => void)[] = [];

  constructor() {
    // Sound may only start from a click or key press.
    const unlock = () => {
      this.start();
      if (this.ctx?.state === 'running') {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
      }
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => this.suspendIfIdle());
  }

  /** Whether the browser is letting it play yet. */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Listen to a new battle's events (the old battle's stop counting). */
  attach(game: Game): void {
    for (const off of this.unsubscribe) off();
    this.game = game;
    this.cues = [];
    this.alertQueue = [];
    this.wind = WIND[game.settings.map.biome] ?? WIND.temperate;
    const ev = game.events;
    const on = <K extends keyof GameEvents>(type: K, handler: (e: GameEvents[K]) => void) =>
      this.unsubscribe.push(
        ev.on(type, (e) => {
          if (!this.live()) return;
          const t0 = performance.now();
          handler(e);
          this.stats.ms += performance.now() - t0;
        }),
      );
    this.unsubscribe = [];
    on('fired', (e) => this.fired(e));
    on('impact', (e) => this.impact(e));
    on('unitDestroyed', (e) => {
      if (e.def.category === 'infantry') return;
      const big = e.def.radius >= 1.6;
      this.activity.add(big ? STIR.blast : STIR.wreck);
      this.cue(big ? 'blast' : 'wreck', 'explosions', e.x, e.z, big ? 1 : 0.7 + e.def.radius * 0.2);
      if (e.def.category === 'super') this.alert('chimeFell', e.x, e.z);
    });
    on('buildingDestroyed', (e) => {
      this.activity.add(STIR.collapse);
      this.cue('collapse', 'buildings', e.x, e.z, Math.min(1.2, 0.5 + e.def.radius * 0.15));
      if (e.faction >= 0 && e.faction !== NEUTRAL && (e.def.production || e.def.id === 'hq')) this.alert('chimeRazed', e.x, e.z);
    });
    on('constructionStarted', (e) => this.cue('build', 'buildings', e.x, e.z, 1));
    on('earthwork', (e) => this.cue('dig', 'buildings', e.x, e.z, 1));
    on('span', (e) => this.cue(e.down ? 'collapse' : 'build', 'buildings', e.x, e.z, e.down ? 0.6 : 1));
    on('outpostCaptured', (e) => e.faction >= 0 && this.alert('chimeCapture', e.x, e.z));
    on('sideEliminated', () => this.alert('chimeOut', this.listener.x, this.listener.z));
    on('battleOver', () => this.alert('chimeWin', this.listener.x, this.listener.z));
    on('godUsed', (e) => e.power.kind !== 'terrain' && e.power.kind !== 'forest' && this.alert('chimeGod', e.x, e.z));
    on('power', (e) => {
      if (e.kind === 'quake') {
        this.activity.add(STIR.blast * 2);
        this.cue('quake', 'explosions', e.x, e.z, Math.min(1.3, 0.5 + (e.strength ?? 1) * 0.3), false);
      } else if (e.kind === 'bigBomb') this.cue('quake', 'explosions', e.x, e.z, 1.4, false);
    });
  }

  /** Each frame: where the camera is, then start this frame's chosen sounds and move the beds. */
  update(frameSeconds: number, listener: Listener, behindSetup: boolean): void {
    this.listener = listener;
    this.ducked = behindSetup;
    if (!this.live()) {
      this.cues.length = 0;
      return;
    }
    const t0 = performance.now();
    const ctx = this.ctx!;
    const chosen = choose(this.cues, this.playing, this.voices);
    this.stats.dropped += this.cues.length - chosen.length;
    this.cues.length = 0;
    for (const c of chosen) this.voice(c);

    this.alertWait -= frameSeconds;
    if (this.alertWait <= 0 && this.alertQueue.length > 0) {
      const c = this.alertQueue.shift()!;
      if (this.playing.alerts < 2) this.voice(c);
      this.alertWait = ALERT_GAP;
    }

    this.activity.update(frameSeconds);
    this.fire.update(frameSeconds);
    const level = this.activity.level;
    this.stats.level = level;
    this.stats.playing = this.voices;
    // Zoomed out, the beds carry more of the war; zoomed in, the single sounds do.
    const out = listener.zoomOut;
    const now = ctx.currentTime;
    const windLevel = this.wind * (0.25 + out * 0.2) * (1 - level * 0.4);
    this.beds.get('wind')?.gain.setTargetAtTime(windLevel, now, 0.5);
    this.beds.get('windHowl')?.gain.setTargetAtTime(windLevel * 0.8, now, 0.5);
    this.beds.get('rumble')?.gain.setTargetAtTime(level * (0.35 + out * 0.5), now, 0.6);
    this.beds.get('distantFire')?.gain.setTargetAtTime(this.fire.level * (0.25 + out * 0.45), now, 0.4);
    this.master!.gain.setTargetAtTime(this.masterGain(), now, 0.1);
    this.air?.frequency.setTargetAtTime(AIR_IN + (AIR_OUT - AIR_IN) * out, now, 0.3);
    this.stats.ms += performance.now() - t0;
  }

  /** Apply changed settings (from the panel) and remember them. */
  changed(): void {
    saveAudioPrefs(this.prefs);
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const { id } of CATEGORIES) {
      const bus = this.buses.get(id)!;
      bus.near.gain.setTargetAtTime(this.prefs.mix[id], now, 0.05);
      bus.far.gain.setTargetAtTime(this.prefs.mix[id], now, 0.05);
      bus.wet.gain.setTargetAtTime(this.prefs.mix[id], now, 0.05);
    }
    this.master!.gain.setTargetAtTime(this.masterGain(), now, 0.05);
    if (this.prefs.muted || this.prefs.volume <= 0) this.suspendIfIdle();
    else this.start();
  }

  /** Play one sound now regardless of the battle, e.g. to try a category's level. */
  preview(category: SoundCategory): void {
    this.start();
    if (!this.running) return;
    const sound: Record<SoundCategory, SoundId> = { gunfire: 'rifle', cannons: 'cannon', explosions: 'blast', buildings: 'collapse', alerts: 'chimeCapture', ambience: 'chimeGod' };
    if (category === 'ambience') return;
    this.voice({ sound: sound[category], category, gain: LOUDNESS[sound[category]], far: 0.25, wet: 0.45, pan: 0, rate: 1 });
  }

  // ------------------------------------------------------------ events to cues

  private fired(e: GameEvents['fired']): void {
    switch (e.kind) {
      case 'bullet':
        this.fire.add(1);
        this.activity.add(STIR.bullet);
        return this.cue('rifle', 'gunfire', e.x, e.z, 1);
      case 'flame':
        this.fire.add(0.5);
        this.activity.add(STIR.flame);
        return this.cue('flame', 'gunfire', e.x, e.z, 1);
      case 'shell':
        this.activity.add(STIR.shell);
        return this.cue('cannon', 'cannons', e.x, e.z, 1);
      case 'missile':
        this.activity.add(STIR.missile);
        return this.cue('missile', 'cannons', e.x, e.z, 1);
      case 'artillery':
        this.activity.add(STIR.artillery);
        return this.cue('launch', 'explosions', e.x, e.z, 1);
    }
  }

  private impact(e: GameEvents['impact']): void {
    if (e.kind === 'bullet' || e.kind === 'flame') return;
    if (e.splash >= 1.8) {
      this.activity.add(STIR.blast);
      this.cue('blast', 'explosions', e.x, e.z, Math.min(1.2, 0.6 + e.splash * 0.12));
    } else {
      this.activity.add(STIR.shell * 0.5);
      this.cue('thud', 'cannons', e.x, e.z, 0.8 + e.splash * 0.2);
    }
  }

  /** Ask for a sound at a place; update() picks which of the frame's asks get played. */
  private cue(sound: SoundId, category: SoundCategory, x: number, z: number, loud: number, jitter = true): void {
    this.stats.cues++;
    const p = place(x, z, this.listener, this.prefs.focus);
    // Zoomed right out, single sounds step back so the beds can carry the battle.
    const gain = LOUDNESS[sound] * loud * p.gain * (1 - this.listener.zoomOut * 0.35);
    this.cues.push({ sound, category, gain, far: p.far, wet: p.wet, pan: p.pan, rate: jitter ? 0.9 + Math.random() * 0.2 : 1 });
  }

  private alert(sound: SoundId, x: number, z: number): void {
    this.stats.cues++;
    const p = place(x, z, this.listener, this.prefs.alertsEverywhere ? 0 : this.prefs.focus);
    // Chimes are never muffled: they're there to tell you something.
    const gain = LOUDNESS[sound] * (this.prefs.alertsEverywhere ? 1 : p.gain);
    if (this.alertQueue.length >= 3) this.alertQueue.shift();
    this.alertQueue.push({ sound, category: 'alerts', gain, far: 0, wet: 0.25, pan: p.pan * 0.5, rate: 1 });
  }

  // ------------------------------------------------------------ Web Audio

  private live(): boolean {
    return this.ctx !== null && this.ctx.state === 'running' && !this.prefs.muted && this.prefs.volume > 0 && this.game !== null;
  }

  private masterGain(): number {
    // Squared, so the slider feels even to the ear.
    return this.prefs.muted ? 0 : this.prefs.volume * this.prefs.volume * (this.ducked ? BEHIND_SETUP : 1);
  }

  /** Build everything on the first click or key press, or resume after a pause. */
  private start(): void {
    if (this.prefs.muted || this.prefs.volume <= 0 || document.hidden) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'playback' });
    this.ctx = ctx;
    // A gentle compressor at the end keeps a big blast from clipping and lifts quiet ambience a little.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.masterGain();
    this.master.connect(comp);
    // One shared muffling filter for everything far away, instead of one per voice.
    const farFilter = ctx.createBiquadFilter();
    farFilter.type = 'lowpass';
    farFilter.frequency.value = FAR_CUTOFF;
    farFilter.Q.value = 0.5;
    farFilter.connect(this.master);
    // Air: a gentle shared roll-off on the near path too, darker the higher the camera.
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = AIR_IN;
    this.air.Q.value = 0.5;
    this.air.connect(this.master);
    // One outdoor reverb for everything (see renderReverb); its impulse arrives from the worker.
    this.reverb = ctx.createConvolver();
    this.reverb.connect(this.master);
    for (const { id } of CATEGORIES) {
      const near = ctx.createGain();
      const far = ctx.createGain();
      const wet = ctx.createGain();
      near.gain.value = far.gain.value = wet.gain.value = this.prefs.mix[id];
      near.connect(this.air);
      far.connect(farFilter);
      wet.connect(this.reverb);
      this.buses.set(id, { near, far, wet });
    }
    this.render(ctx);
    if (ctx.state === 'suspended') void ctx.resume();
  }

  /**
   * Make the sounds: in a worker if there is one, so the page doesn't stall,
   * else on the page a sound per moment. Each is usable as soon as it's back;
   * until then cues for it are skipped.
   */
  private render(ctx: AudioContext): void {
    const t0 = performance.now();
    const rate = ctx.sampleRate;
    // Beds: wind and the war's rumble under ambience; distant gunfire under gunfire (muffled).
    const bedBus: Record<LoopId, AudioNode> = { wind: this.buses.get('ambience')!.near, windHowl: this.buses.get('ambience')!.near, rumble: this.buses.get('ambience')!.near, distantFire: this.buses.get('gunfire')!.far };
    let left = 2 + LOOP_IDS.length + SOUND_IDS.reduce((n, id) => n + variantsOf(id), 0);
    const impulse: Float32Array[] = [];
    const arrived = (m: FromAudioWorker) => {
      const b = ctx.createBuffer(1, m.data.length, rate);
      b.copyToChannel(m.data as Float32Array<ArrayBuffer>, 0);
      if (m.kind === 'reverb') {
        impulse[m.variant] = m.data;
        if (impulse[0] && impulse[1]) {
          const ir = ctx.createBuffer(2, impulse[0].length, rate);
          ir.copyToChannel(impulse[0] as Float32Array<ArrayBuffer>, 0);
          ir.copyToChannel(impulse[1] as Float32Array<ArrayBuffer>, 1);
          this.reverb!.buffer = ir;
        }
      } else if (m.kind === 'loop') {
        const id = m.id as LoopId;
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const g = ctx.createGain();
        g.gain.value = 0;
        src.connect(g).connect(bedBus[id]);
        if (id === 'wind') {
          // Keep the reverb busy from the start. A convolver whose input has been silent for
          // longer than its impulse switches itself off, and the browser switches it back on
          // when a sound arrives. At a battle's start the first scattered sounds keep doing that,
          // and the wind cutting out right as the first sound of a battle plays points at that
          // restart costing the audio thread its deadline. A trickle of wind, far too quiet to hear
          // (about -75 dB), keeps it running at a steady cost instead.
          const awake = ctx.createGain();
          awake.gain.value = 0.002;
          src.connect(awake).connect(this.reverb!);
        }
        src.start();
        this.beds.set(id, g);
      } else {
        const id = m.id as SoundId;
        const list = this.buffers.get(id) ?? [];
        list[m.variant] = b;
        this.buffers.set(id, list);
      }
      if (--left === 0 && import.meta.env?.DEV) console.info(`Audio ready: sounds rendered in ${Math.round(performance.now() - t0)} ms at ${rate} Hz`);
    };
    const total = left;
    const onPage = () => {
      const queue: (() => FromAudioWorker)[] = [
        ...[0, 1].map((ch) => () => ({ kind: 'reverb' as const, id: 'reverb', variant: ch, data: renderReverb(rate)[ch] })),
        ...LOOP_IDS.map((id) => () => ({ kind: 'loop' as const, id, variant: 0, data: renderLoop(id, rate) })),
        ...SOUND_IDS.flatMap((id) => Array.from({ length: variantsOf(id) }, (_, v) => () => ({ kind: 'sound' as const, id, variant: v, data: renderSound(id, rate, v) }))),
      ];
      const next = () => {
        const job = queue.shift();
        if (!job) return;
        arrived(job());
        setTimeout(next, 0);
      };
      next();
    };
    if (typeof Worker === 'undefined') return onPage();
    try {
      const worker = new Worker(new URL('./audioWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<FromAudioWorker>) => {
        arrived(ev.data);
        if (left === 0) worker.terminate();
      };
      // A worker that can't load: render on the page instead.
      worker.onerror = () => {
        worker.terminate();
        if (left === total) onPage();
      };
      worker.postMessage({ rate });
    } catch {
      onPage();
    }
  }

  /** Start one voice: buffer → gain → panner → near and far paths of its category. */
  private voice(c: Cue): void {
    const ctx = this.ctx!;
    const variants = this.buffers.get(c.sound)?.filter(Boolean);
    if (!variants || variants.length === 0) return;
    const src = ctx.createBufferSource();
    src.buffer = variants[Math.floor(Math.random() * variants.length)];
    src.playbackRate.value = c.rate;
    const pan = ctx.createStereoPanner();
    pan.pan.value = c.pan;
    const near = ctx.createGain();
    near.gain.value = c.gain * (1 - c.far);
    const bus = this.buses.get(c.category)!;
    src.connect(pan);
    pan.connect(near).connect(bus.near);
    let far: GainNode | null = null;
    if (c.far > 0.02) {
      far = ctx.createGain();
      // Muffled sound loses its highs, so give it back a little level.
      far.gain.value = c.gain * c.far * 1.3;
      pan.connect(far).connect(bus.far);
    }
    let wet: GainNode | null = null;
    if (c.wet > 0.02) {
      wet = ctx.createGain();
      wet.gain.value = c.gain * c.wet * WET;
      pan.connect(wet).connect(bus.wet);
    }
    this.voices++;
    this.playing[c.category]++;
    this.stats.started++;
    src.onended = () => {
      this.voices--;
      this.playing[c.category]--;
      src.disconnect();
      pan.disconnect();
      near.disconnect();
      far?.disconnect();
      wet?.disconnect();
    };
    src.start();
  }

  /** Stop the audio thread while muted or the tab is hidden; it costs nothing then. */
  private suspendIfIdle(): void {
    if (!this.ctx) return;
    if (document.hidden || this.prefs.muted || this.prefs.volume <= 0) void this.ctx.suspend();
    else void this.ctx.resume();
  }
}

/** Where the camera looks, in the shape the mixer wants. */
export function listenerFrom(rig: { target: { x: number; z: number }; viewRadius: number; zoom: number; minZoom: number; maxZoom: number; camera: { matrixWorld: { elements: ArrayLike<number> } } }): Listener {
  const m = rig.camera.matrixWorld.elements;
  // The camera's right axis, flattened onto the ground.
  const len = Math.hypot(m[0], m[2]) || 1;
  const span = Math.log(rig.maxZoom / rig.minZoom) || 1;
  return {
    x: rig.target.x,
    z: rig.target.z,
    radius: rig.viewRadius,
    rightX: m[0] / len,
    rightZ: m[2] / len,
    zoomOut: Math.max(0, Math.min(1, Math.log(rig.maxZoom / rig.zoom) / span)),
  };
}

