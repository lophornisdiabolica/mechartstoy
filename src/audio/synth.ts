/**
 * Every sound in the game, made from nothing: noise, sine waves, envelopes
 * and a few filters, rendered once into sample arrays when audio starts.
 * Nothing here touches Web Audio, so it runs (and is tested) in Node too, and
 * `npm run sounds` writes each one out as a WAV to listen to.
 *
 * Playing a pre-rendered buffer is the cheapest thing Web Audio can do, so a
 * big battle costs a handful of buffer players rather than a synthesizer per
 * shot. Each sound has a few variants (different noise, slightly different
 * pitch and length) and is played back at a jittered rate, so a long battle
 * doesn't hear the same gunshot a thousand times.
 */

export type SoundId =
  | 'rifle'
  | 'flame'
  | 'cannon'
  | 'missile'
  | 'launch'
  | 'thud'
  | 'blast'
  | 'wreck'
  | 'collapse'
  | 'build'
  | 'dig'
  | 'quake'
  | 'chimeCapture'
  | 'chimeFell'
  | 'chimeRazed'
  | 'chimeOut'
  | 'chimeWin'
  | 'chimeGod';

/** Looping beds that play all the time under everything else. */
export type LoopId = 'wind' | 'rumble' | 'distantFire';

/** How many variants each one-shot sound gets. */
export const VARIANTS = 3;

/** Small seeded generator, so a sound renders the same every time (and in tests). */
export function noiseSource(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  };
}

// ---------------------------------------------------------------- building blocks

/** One-pole low-pass, in place. `cutoff` in Hz, constant or per sample. */
function lowpass(buf: Float32Array, rate: number, cutoff: number | ((i: number) => number)): Float32Array {
  let y = 0;
  const fixed = typeof cutoff === 'number' ? 1 - Math.exp((-2 * Math.PI * cutoff) / rate) : 0;
  for (let i = 0; i < buf.length; i++) {
    const a = typeof cutoff === 'number' ? fixed : 1 - Math.exp((-2 * Math.PI * cutoff(i)) / rate);
    y += a * (buf[i] - y);
    buf[i] = y;
  }
  return buf;
}

/** One-pole high-pass, in place. */
function highpass(buf: Float32Array, rate: number, cutoff: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoff) / rate);
  let x0 = 0;
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = a * (y + buf[i] - x0);
    x0 = buf[i];
    buf[i] = y;
  }
  return buf;
}

/** Resonant band-pass (an RBJ biquad), in place. Centre in Hz (constant or per sample), q its sharpness. */
function bandpass(buf: Float32Array, rate: number, centre: number | ((i: number) => number), q: number): Float32Array {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let b0 = 0;
  let a1 = 0;
  let a2 = 0;
  const coeffs = (f: number) => {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    b0 = alpha / a0;
    a1 = (-2 * Math.cos(w)) / a0;
    a2 = (1 - alpha) / a0;
  };
  if (typeof centre === 'number') coeffs(centre);
  for (let i = 0; i < buf.length; i++) {
    // Recomputing every 32 samples is plenty for a sweep and much cheaper.
    if (typeof centre !== 'number' && i % 32 === 0) coeffs(centre(i));
    const x = buf[i];
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

function white(n: number, rnd: () => number): Float32Array {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = rnd();
  return b;
}

/** Brown(ish) noise: integrated white noise, leaky so it doesn't wander off. Deep and rumbly. */
function brown(n: number, rnd: () => number): Float32Array {
  const b = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = y * 0.995 + rnd() * 0.1;
    b[i] = y;
  }
  return b;
}

/** A sine whose pitch glides exponentially from f0 to f1 over the buffer. */
function sweep(n: number, rate: number, f0: number, f1: number): Float32Array {
  const b = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(f1 / f0, i / n);
    phase += (2 * Math.PI * f) / rate;
    b[i] = Math.sin(phase);
  }
  return b;
}

/** Multiply by an envelope: a linear attack of `attack` seconds, then exponential decay with time constant `decay`. */
function envelope(buf: Float32Array, rate: number, attack: number, decay: number): Float32Array {
  const a = Math.max(1, attack * rate);
  for (let i = 0; i < buf.length; i++) {
    const t = i / rate;
    const up = i < a ? i / a : 1;
    buf[i] *= up * Math.exp(-Math.max(0, t - attack) / decay);
  }
  return buf;
}

/** Add `src` into `dst` at a sample offset, scaled. */
function mix(dst: Float32Array, src: Float32Array, gain = 1, at = 0): Float32Array {
  for (let i = 0; i < src.length && at + i < dst.length; i++) dst[at + i] += src[i] * gain;
  return dst;
}

/** Fade the last `seconds` to silence so nothing clicks off. */
function tail(buf: Float32Array, rate: number, seconds = 0.03): Float32Array {
  const n = Math.min(buf.length, Math.round(seconds * rate));
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

/** Scale so the loudest sample is `peak`. */
export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] *= peak / m;
  return buf;
}

/** Soft clipping: rounds off peaks the way an overdriven speaker would, which makes booms feel heavier. */
function saturate(buf: Float32Array, drive: number): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / k;
  return buf;
}

/** Sparse random clicks (debris, crackling), each a tiny decaying noise burst. */
function crackle(n: number, rate: number, rnd: () => number, perSecond: number, density: (t: number) => number, length = 0.004): Float32Array {
  const b = new Float32Array(n);
  const len = Math.round(length * rate);
  for (let i = 0; i < n; i++) {
    if ((rnd() * 0.5 + 0.5) * rate < perSecond * density(i / n)) {
      const g = 0.3 + (rnd() * 0.5 + 0.5) * 0.7;
      for (let j = 0; j < len && i + j < n; j++) b[i + j] += rnd() * g * (1 - j / len);
    }
  }
  return b;
}

/**
 * A struck bell: a few sine partials at bell-like (slightly inharmonic) ratios,
 * the higher ones dying faster. `f` is the fundamental.
 */
function bell(n: number, rate: number, f: number, decay: number, partials = [1, 2.01, 2.76, 4.07, 5.43], soft = 0): Float32Array {
  const b = new Float32Array(n);
  partials.forEach((ratio, k) => {
    const g = 1 / (1 + k * (1.4 + soft));
    const d = decay / (1 + k * 0.8);
    const w = (2 * Math.PI * f * ratio) / rate;
    for (let i = 0; i < n; i++) b[i] += Math.sin(w * i) * g * Math.exp(-i / rate / d);
  });
  // A few milliseconds of attack, so it's struck rather than clicked.
  const a = Math.round(0.004 * rate);
  for (let i = 0; i < a && i < n; i++) b[i] *= i / a;
  return b;
}

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

// ---------------------------------------------------------------- the sounds

type Render = (rate: number, rnd: () => number, v: number) => Float32Array;

/** v is the variant, 0..VARIANTS-1, for small differences in pitch and length. */
const SOUNDS: Record<SoundId, Render> = {
  // Small arms: a sharp crack of bright noise, a short papery body, a quick tail.
  rifle: (rate, rnd, v) => {
    const n = Math.round(0.28 * rate);
    const crack = envelope(highpass(white(n, rnd), rate, 2200 + v * 300), rate, 0.0005, 0.008);
    const body = envelope(bandpass(white(n, rnd), rate, 950 + v * 150, 1.2), rate, 0.001, 0.03);
    const thump = envelope(sweep(n, rate, 220, 110), rate, 0.001, 0.015);
    const out = mix(mix(crack, body, 1.4), thump, 0.18);
    mix(out, envelope(lowpass(white(n, rnd), rate, 900), rate, 0.01, 0.08), 0.25);
    return tail(saturate(normalize(out), 1.5), rate);
  },
  // Flamers: a breathy roar with crackle, swelling in and out.
  flame: (rate, rnd, v) => {
    const n = Math.round(0.7 * rate);
    const roar = bandpass(white(n, rnd), rate, 500 + v * 80, 0.7);
    for (let i = 0; i < n; i++) roar[i] *= Math.sin((Math.PI * i) / n) ** 1.5;
    const pops = crackle(n, rate, rnd, 60, (t) => Math.sin(Math.PI * t), 0.003);
    return tail(normalize(mix(roar, highpass(pops, rate, 1500), 0.5)), rate);
  },
  // Tank guns: a hard transient, a pitched-down thump and a rolling noise tail.
  cannon: (rate, rnd, v) => {
    const n = Math.round(1.1 * rate);
    const thump = envelope(sweep(n, rate, 110 - v * 8, 42), rate, 0.002, 0.12);
    const crack = envelope(bandpass(white(n, rnd), rate, 1800, 0.8), rate, 0.0005, 0.012);
    const roll = envelope(lowpass(white(n, rnd), rate, (i) => 1600 * Math.exp(-i / rate / 0.2) + 180), rate, 0.004, 0.28);
    const out = mix(mix(thump, crack, 0.7), roll, 1.1);
    return tail(normalize(saturate(normalize(out), 2.2)), rate, 0.1);
  },
  // Rockets: a hissing whoosh that rises in pitch as it leaves.
  missile: (rate, rnd, v) => {
    const n = Math.round(0.9 * rate);
    const hiss = bandpass(white(n, rnd), rate, (i) => 500 * Math.pow(6 + v, i / n), 2.5);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      hiss[i] *= Math.min(1, t * 25) * Math.pow(1 - t, 1.6);
    }
    const kick = envelope(lowpass(white(n, rnd), rate, 400), rate, 0.002, 0.05);
    return tail(normalize(mix(hiss, kick, 0.6)), rate);
  },
  // Artillery firing: a deep, slightly muffled boom (it's usually far from the camera).
  launch: (rate, rnd, v) => {
    const n = Math.round(1.8 * rate);
    const boom = envelope(sweep(n, rate, 100 - v * 6, 45), rate, 0.004, 0.22);
    const body = envelope(lowpass(lowpass(white(n, rnd), rate, 650), rate, 650), rate, 0.006, 0.4);
    const out = mix(boom, normalize(body), 1.3);
    return tail(normalize(saturate(normalize(out), 3)), rate, 0.2);
  },
  // A shell or rocket landing: a dull crump.
  thud: (rate, rnd, v) => {
    const n = Math.round(0.7 * rate);
    const low = envelope(sweep(n, rate, 140 - v * 15, 55), rate, 0.002, 0.07);
    const dirt = envelope(lowpass(white(n, rnd), rate, 1100), rate, 0.002, 0.1);
    const grit = envelope(highpass(crackle(n, rate, rnd, 300, (t) => 1 - t), rate, 1200), rate, 0.01, 0.12);
    return tail(normalize(saturate(normalize(mix(mix(low, dirt, 0.9), grit, 0.3)), 1.8)), rate, 0.08);
  },
  // Big blasts: heavy shells, bombs, big wrecks. Crack, sub drop, a long rumbling cloud and falling debris.
  blast: (rate, rnd, v) => {
    const n = Math.round(2.6 * rate);
    const crack = envelope(bandpass(white(n, rnd), rate, 1400, 0.6), rate, 0.0005, 0.02);
    const sub = envelope(sweep(n, rate, 110 - v * 6, 35), rate, 0.003, 0.3);
    const cloud = lowpass(white(n, rnd), rate, (i) => 2500 * Math.exp(-i / rate / 0.3) + 280);
    envelope(cloud, rate, 0.01, 0.7);
    // The cloud rolls: slow random swells in its loudness.
    let swell = 1;
    for (let i = 0; i < n; i++) {
      if (i % 2000 === 0) swell = 0.6 + (rnd() * 0.5 + 0.5) * 0.6;
      cloud[i] *= swell;
    }
    lowpass(cloud, rate, 1500);
    const debris = highpass(crackle(n, rate, rnd, 120, (t) => (t > 0.15 ? Math.exp(-(t - 0.15) * 4) : 0), 0.006), rate, 900);
    const out = mix(mix(mix(crack, sub, 0.7), normalize(cloud), 1.5), debris, 0.25);
    return tail(normalize(saturate(normalize(out), 3.2)), rate, 0.3);
  },
  // A vehicle going up: a smaller blast with more metal in it.
  wreck: (rate, rnd, v) => {
    const n = Math.round(1.4 * rate);
    const pop = envelope(sweep(n, rate, 150 - v * 10, 40), rate, 0.002, 0.12);
    const fire = envelope(lowpass(white(n, rnd), rate, (i) => 2500 * Math.exp(-i / rate / 0.15) + 250), rate, 0.002, 0.3);
    const clank = envelope(bell(n, rate, 310 + v * 47, 0.25, [1, 2.43, 3.9, 5.7]), rate, 0, 0.2);
    const out = mix(mix(pop, fire, 1.2), clank, 0.18);
    return tail(normalize(saturate(normalize(out), 2)), rate, 0.15);
  },
  // A building coming down: a long grinding rumble with crunches in it.
  collapse: (rate, rnd, v) => {
    const n = Math.round(3.2 * rate);
    const rumble = lowpass(lowpass(white(n, rnd), rate, 380 + v * 60), rate, 500);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      rumble[i] *= Math.min(1, t * 8) * Math.pow(1 - t, 1.3);
    }
    const crunch = lowpass(crackle(n, rate, rnd, 40, (t) => Math.pow(1 - t, 2), 0.03), rate, 2500);
    return tail(normalize(saturate(normalize(mix(normalize(rumble), normalize(crunch), 0.7)), 1.8)), rate, 0.2);
  },
  // Construction starting: a few metallic knocks, like a frame going up.
  build: (rate, rnd, v) => {
    const n = Math.round(0.9 * rate);
    const out = new Float32Array(n);
    const hits = 3 + v;
    for (let k = 0; k < hits; k++) {
      const at = Math.round((0.05 + k * 0.17 + (rnd() * 0.5 + 0.5) * 0.04) * rate);
      const knock = envelope(bell(Math.round(0.25 * rate), rate, 520 + (rnd() * 0.5 + 0.5) * 220, 0.06, [1, 2.7, 4.1]), rate, 0, 0.05);
      mix(out, knock, 0.7 - k * 0.1, at);
    }
    return tail(normalize(out), rate);
  },
  // Engineers digging: a dry scrape and spill of earth.
  dig: (rate, rnd, v) => {
    const n = Math.round(0.8 * rate);
    const scrape = bandpass(white(n, rnd), rate, (i) => 900 - (i / n) * 400 + v * 60, 1.5);
    for (let i = 0; i < n; i++) scrape[i] *= Math.sin((Math.PI * i) / n) ** 2;
    const spill = lowpass(crackle(n, rate, rnd, 200, (t) => (t > 0.4 ? 1 - t : 0), 0.008), rate, 1800);
    return tail(normalize(mix(scrape, spill, 0.8)), rate);
  },
  // Earthquakes: a very low, shuddering roar.
  quake: (rate, rnd) => {
    const n = Math.round(4 * rate);
    const roar = lowpass(lowpass(white(n, rnd), rate, 220), rate, 220);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      roar[i] *= Math.min(1, t * 4) * Math.pow(1 - t, 1.2) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t * 4));
    }
    return tail(normalize(saturate(normalize(roar), 3)), rate, 0.3);
  },
  // ---- Alerts: soft synthesized bells, short and quiet so they inform without nagging.
  // An outpost changes hands: two rising notes.
  chimeCapture: (rate) => {
    const n = Math.round(1.4 * rate);
    const out = mix(bell(n, rate, NOTE(7), 0.5), bell(n, rate, NOTE(12), 0.6), 0.9, Math.round(0.13 * rate));
    return tail(normalize(out, 0.7), rate, 0.2);
  },
  // A super unit falls: two low falling notes.
  chimeFell: (rate) => {
    const n = Math.round(1.8 * rate);
    const out = mix(bell(n, rate, NOTE(-2), 0.7), bell(n, rate, NOTE(-7), 0.8), 0.9, Math.round(0.2 * rate));
    return tail(normalize(out, 0.7), rate, 0.2);
  },
  // A production building or HQ razed: one low gong.
  chimeRazed: (rate) => {
    const n = Math.round(2.2 * rate);
    const out = bell(n, rate, NOTE(-12), 1.0, [1, 1.47, 2.09, 2.56, 3.2], 0.3);
    return tail(normalize(out, 0.7), rate, 0.3);
  },
  // A side is knocked out: three falling notes.
  chimeOut: (rate) => {
    const n = Math.round(2.2 * rate);
    const out = bell(n, rate, NOTE(3), 0.6);
    mix(out, bell(n, rate, NOTE(-2), 0.6), 0.9, Math.round(0.22 * rate));
    mix(out, bell(n, rate, NOTE(-9), 0.9), 0.9, Math.round(0.44 * rate));
    return tail(normalize(out, 0.7), rate, 0.3);
  },
  // The battle is won: a rising major arpeggio.
  chimeWin: (rate) => {
    const n = Math.round(3 * rate);
    const out = new Float32Array(n);
    [0, 4, 7, 12].forEach((s, k) => mix(out, bell(n, rate, NOTE(s + 3), 1.1), 0.8, Math.round(k * 0.16 * rate)));
    return tail(normalize(out, 0.75), rate, 0.3);
  },
  // A god power: a glassy shimmer.
  chimeGod: (rate, rnd) => {
    const n = Math.round(1.6 * rate);
    const out = new Float32Array(n);
    for (let k = 0; k < 6; k++) mix(out, bell(n, rate, NOTE(15 + [0, 4, 7, 11, 14, 19][k]) * (1 + rnd() * 0.004), 0.5, [1, 3.01]), 0.5, Math.round(k * 0.05 * rate));
    return tail(normalize(out, 0.6), rate, 0.2);
  },
};

/** Join a loop's end smoothly onto its start: the last `fade` seconds cross-fade into the first. */
function seamless(buf: Float32Array, rate: number, fade = 0.5): Float32Array {
  const f = Math.round(fade * rate);
  const n = buf.length - f;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf[i];
  for (let i = 0; i < f; i++) {
    const k = i / f;
    out[i] = buf[n + i] * (1 - k) + buf[i] * k;
  }
  return out;
}

const LOOPS: Record<LoopId, (rate: number, rnd: () => number) => Float32Array> = {
  // Wind: brown noise through a band-pass that wanders slowly, so it gusts.
  wind: (rate, rnd) => {
    const n = Math.round(10.5 * rate);
    const phase = rnd() * 6;
    const air = bandpass(brown(n, rnd), rate, (i) => 380 + 220 * Math.sin((2 * Math.PI * i) / n * 2 + phase) + 120 * Math.sin((2 * Math.PI * i) / n * 5), 0.9);
    for (let i = 0; i < n; i++) air[i] *= 0.65 + 0.35 * Math.sin((2 * Math.PI * i) / n * 3 + phase * 2);
    return normalize(seamless(air, rate), 0.5);
  },
  // A far-off war: a deep rumble with distant thumps rolling in it.
  rumble: (rate, rnd) => {
    const n = Math.round(8.5 * rate);
    const bed = lowpass(lowpass(white(n, rnd), rate, 200), rate, 260);
    normalize(bed, 0.4);
    for (let k = 0; k < 14; k++) {
      const at = Math.round((rnd() * 0.5 + 0.5) * (n - rate));
      const boom = envelope(lowpass(lowpass(white(Math.round(1.2 * rate), rnd), rate, 320), rate, 320), rate, 0.03, 0.3);
      mix(bed, normalize(boom, 0.3 + (rnd() * 0.5 + 0.5) * 0.5), 1, at);
    }
    return normalize(seamless(saturate(normalize(lowpass(bed, rate, 380)), 1.5), rate), 0.6);
  },
  // Gunfire somewhere far away: muffled pops in irregular bursts.
  distantFire: (rate, rnd) => {
    const n = Math.round(9.5 * rate);
    const out = new Float32Array(n);
    const pop = (seed: number) => envelope(lowpass(white(Math.round(0.08 * rate), noiseSource(seed)), rate, 1200), rate, 0.001, 0.015);
    let t = 0;
    while (t < 9) {
      // A burst of 2-7 shots, then a gap.
      const shots = 2 + Math.floor((rnd() * 0.5 + 0.5) * 6);
      const gap = 0.06 + (rnd() * 0.5 + 0.5) * 0.08;
      for (let s = 0; s < shots; s++) mix(out, pop(Math.floor(t * 1000) + s), 0.4 + (rnd() * 0.5 + 0.5) * 0.6, Math.round((t + s * gap) * rate));
      t += shots * gap + 0.1 + (rnd() * 0.5 + 0.5) * 0.9;
    }
    return normalize(seamless(lowpass(out, rate, 1500), rate, 0.3), 0.6);
  },
};

export const SOUND_IDS = Object.keys(SOUNDS) as SoundId[];
export const LOOP_IDS = Object.keys(LOOPS) as LoopId[];

/** Render one variant of a sound at a sample rate. Same inputs, same samples. */
export function renderSound(id: SoundId, rate: number, variant = 0): Float32Array {
  return SOUNDS[id](rate, noiseSource(hash(id) + variant * 7919), variant);
}

/** How many variants a sound has: one for the chimes and the quake (rare, and meant to be recognised), VARIANTS for the rest. */
export function variantsOf(id: SoundId): number {
  return id.startsWith('chime') || id === 'quake' ? 1 : VARIANTS;
}

export function renderLoop(id: LoopId, rate: number): Float32Array {
  return LOOPS[id](rate, noiseSource(hash(id)));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
