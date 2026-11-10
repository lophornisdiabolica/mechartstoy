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
export type LoopId = 'wind' | 'windHowl' | 'rumble' | 'distantFire';

/** How many variants each one-shot sound gets. */
export const VARIANTS = 4;
/** Sounds that are heard most and vary most in life get more variants. */
const EXPLOSIONS: SoundId[] = ['blast', 'wreck', 'thud', 'cannon', 'launch', 'collapse'];

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

/**
 * A smooth random curve from about `floor` to 1: a few slow sine waves at random phases
 * (`hz` their rates), for gusts and swells.
 */
function slowRandom(n: number, rate: number, rnd: () => number, hz: number[], floor: number): Float32Array {
  const out = new Float32Array(n);
  const phases = hz.map(() => rnd() * Math.PI);
  for (let i = 0; i < n; i++) {
    let v = 0;
    hz.forEach((f, k) => (v += Math.sin((2 * Math.PI * f * i) / rate + phases[k] * 2) / (k + 1)));
    out[i] = v;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < n; i++) out[i] = floor + ((out[i] - lo) / (hi - lo || 1)) * (1 - floor);
  return out;
}

/** Seconds over which a loop's end cross-fades into its start. */
const LOOP_FADE = 0.3;

/**
 * Gusts for a loop `len` samples long (rendered `n` long, for the cross-fade): slow sine waves
 * that each go round a whole number of times (`cycles`) in the loop, so the curve at its end
 * is the curve at its start. Scaled from `floor` to 1.
 */
function loopGust(n: number, len: number, rnd: () => number, cycles: number[], floor: number): Float32Array {
  const out = new Float32Array(n);
  const phases = cycles.map(() => rnd() * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    let v = 0;
    cycles.forEach((c, k) => (v += Math.sin((2 * Math.PI * c * i) / len + phases[k]) / (k + 1)));
    out[i] = v;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of out) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < n; i++) out[i] = floor + ((out[i] - lo) / (hi - lo || 1)) * (1 - floor);
  return out;
}

/** A random factor near 1, within ±amount: how far one variant of a sound strays from the recipe. */
function vary(rnd: () => number, amount: number): number {
  return 1 + rnd() * amount;
}

const NOTE = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

// ---------------------------------------------------------------- the sounds

type Render = (rate: number, rnd: () => number, v: number) => Float32Array;

/** v is the variant, 0..VARIANTS-1, for small differences in pitch and length. */
const SOUNDS: Record<SoundId, Render> = {
  // Small arms. Real gunshots carry about 40% of their energy below 250 Hz (the muzzle blast);
  // the crack is brief and the body broad, never a narrow ring. Measured against recordings,
  // see docs/audio.md.
  rifle: (rate, rnd, v) => {
    const n = Math.round(0.9 * rate);
    const punch = envelope(sweep(n, rate, 110 - v * 10, 42), rate, 0.001, 0.035);
    const blast = envelope(lowpass(lowpass(white(n, rnd), rate, 350), rate, 350), rate, 0.001, 0.045);
    const crack = envelope(lowpass(white(n, rnd), rate, 5000), rate, 0.0003, 0.006);
    const body = envelope(highpass(lowpass(white(n, rnd), rate, 1800 + v * 200), rate, 300), rate, 0.0008, 0.03);
    // The report: outdoors a shot doesn't stop dead, it rolls away for half a second or so,
    // darkening and swelling a little as it comes back off the land. Recorded rifles outdoors
    // keep 20-40% of their energy after the first tenth of a second; without it a shot is a tap.
    const report = lowpass(white(n, rnd), rate, (i) => 900 * Math.exp(-i / rate / 0.25) + 220);
    const swell = slowRandom(n, rate, rnd, [3, 5.5, 9], 0.45);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      report[i] *= swell[i] * Math.min(1, t / 0.025) * Math.exp(-t / 0.22);
    }
    const out = mix(mix(mix(mix(punch, normalize(blast), 0.9), normalize(crack), 0.75), normalize(body), 1.4), normalize(report), 0.95);
    for (let i = 0; i < n; i++) out[i] -= punch[i] * 0.6;
    return tail(saturate(normalize(out), 1.3), rate, 0.1);
  },
  // Flamers: a soft, low roar with a little crackle, swelling in and out.
  flame: (rate, rnd, v) => {
    const n = Math.round(0.7 * rate);
    const roar = lowpass(lowpass(white(n, rnd), rate, 650 + v * 80), rate, 900);
    const under = lowpass(brown(n, rnd), rate, 160);
    mix(normalize(roar), normalize(under), 0.6);
    for (let i = 0; i < n; i++) roar[i] *= Math.sin((Math.PI * i) / n) ** 1.5;
    const pops = lowpass(crackle(n, rate, rnd, 40, (t) => Math.sin(Math.PI * t), 0.003), rate, 3500);
    return tail(normalize(mix(normalize(roar), pops, 0.25)), rate);
  },
  // Tank guns: mostly a deep thump and a rolling low body; the crack is short and dark.
  cannon: (rate, rnd) => {
    const n = Math.round(1.4 * vary(rnd, 0.1) * rate);
    const thump = envelope(sweep(n, rate, 70 * vary(rnd, 0.12), 26 * vary(rnd, 0.1)), rate, 0.003, 0.14 * vary(rnd, 0.2));
    const body = envelope(lowpass(lowpass(white(n, rnd), rate, 250 * vary(rnd, 0.2)), rate, 250), rate, 0.004, 0.25 * vary(rnd, 0.2));
    const crack = envelope(lowpass(white(n, rnd), rate, 3000 * vary(rnd, 0.2)), rate, 0.0005, 0.01);
    const roll = envelope(lowpass(white(n, rnd), rate, (i) => 900 * Math.exp(-i / rate / 0.25) + 120), rate, 0.02, 0.35 * vary(rnd, 0.25));
    const out = mix(mix(mix(thump, normalize(body), 1.5), crack, 0.3 * vary(rnd, 0.3)), normalize(roll), 0.6 * vary(rnd, 0.25));
    return tail(normalize(saturate(normalize(out), 1.4)), rate, 0.15);
  },
  // Rockets: a thump of ignition, then a low, fluttering motor roar that darkens as it leaves.
  // Recorded launches sit at 120-500 Hz; a rising whoosh read as wind.
  missile: (rate, rnd, v) => {
    const n = Math.round(1.2 * rate);
    const ignite = envelope(sweep(n, rate, 95, 45), rate, 0.002, 0.06);
    mix(ignite, envelope(lowpass(white(n, rnd), rate, 500), rate, 0.002, 0.05), 0.8);
    const roar = lowpass(lowpass(white(n, rnd), rate, (i) => 700 - (350 * i) / n + v * 40), rate, 600);
    // Flutter: the motor's rough burn, a fast random wobble in loudness.
    let flutter = 1;
    const step = Math.round(rate / 45);
    for (let i = 0; i < n; i++) {
      if (i % step === 0) flutter = 0.6 + (rnd() * 0.5 + 0.5) * 0.4;
      const t = i / n;
      roar[i] *= flutter * Math.min(1, t * 30) * Math.pow(1 - t, 1.4);
    }
    const out = mix(normalize(roar), normalize(ignite), 0.7);
    return tail(normalize(saturate(normalize(out), 1.2)), rate);
  },
  // Artillery firing: a deep, heavy boom with only a little presence above it.
  launch: (rate, rnd) => {
    const n = Math.round(1.8 * vary(rnd, 0.12) * rate);
    const boom = envelope(sweep(n, rate, 70 * vary(rnd, 0.12), 26 * vary(rnd, 0.1)), rate, 0.004, 0.3 * vary(rnd, 0.2));
    const body = envelope(lowpass(lowpass(white(n, rnd), rate, 180 * vary(rnd, 0.2)), rate, 180), rate, 0.006, 0.45 * vary(rnd, 0.2));
    const edge = envelope(lowpass(white(n, rnd), rate, 900 * vary(rnd, 0.25)), rate, 0.002, 0.05);
    const out = mix(mix(boom, normalize(body), vary(rnd, 0.2)), edge, 0.2 * vary(rnd, 0.3));
    return tail(normalize(saturate(normalize(out), 1.5)), rate, 0.2);
  },
  // A shell or rocket landing: a dull crump of earth.
  thud: (rate, rnd) => {
    const n = Math.round(0.8 * vary(rnd, 0.12) * rate);
    const low = envelope(sweep(n, rate, 80 * vary(rnd, 0.15), 32 * vary(rnd, 0.1)), rate, 0.002, 0.07 * vary(rnd, 0.2));
    const dirt = envelope(lowpass(white(n, rnd), rate, 600 * vary(rnd, 0.25)), rate, 0.002, 0.12 * vary(rnd, 0.25));
    const grit = envelope(lowpass(crackle(n, rate, rnd, 250 * vary(rnd, 0.5), (t) => 1 - t), rate, 2500), rate, 0.01, 0.12);
    return tail(normalize(saturate(normalize(mix(mix(low, normalize(dirt), 1.8 * vary(rnd, 0.2)), grit, 0.2 * vary(rnd, 0.4))), 1.3)), rate, 0.1);
  },
  // Big blasts: heavy shells, bombs, big wrecks. A dark crack, a deep drop, a long rolling cloud, debris.
  blast: (rate, rnd) => {
    const n = Math.round(2.8 * vary(rnd, 0.15) * rate);
    const crack = envelope(lowpass(white(n, rnd), rate, 2500 * vary(rnd, 0.2)), rate, 0.0005, 0.015);
    const sub = envelope(sweep(n, rate, 70 * vary(rnd, 0.12), 22 * vary(rnd, 0.1)), rate, 0.003, 0.45 * vary(rnd, 0.2));
    const bright = 1200 * vary(rnd, 0.2);
    const fade = 0.3 * vary(rnd, 0.2);
    const cloud = lowpass(white(n, rnd), rate, (i) => bright * Math.exp(-i / rate / fade) + 150);
    envelope(cloud, rate, 0.01, 0.8 * vary(rnd, 0.2));
    // The cloud rolls: slow random swells in its loudness, at a pace that differs blast to blast.
    let swell = 1;
    const every = Math.round(2000 * vary(rnd, 0.3));
    for (let i = 0; i < n; i++) {
      if (i % every === 0) swell = 0.6 + (rnd() * 0.5 + 0.5) * 0.6;
      cloud[i] *= swell;
    }
    lowpass(cloud, rate, 900);
    const debris = lowpass(crackle(n, rate, rnd, 100 * vary(rnd, 0.5), (t) => (t > 0.15 ? Math.exp(-(t - 0.15) * 4) : 0), 0.006), rate, 3000);
    const out = mix(mix(mix(crack, sub, 1.4 * vary(rnd, 0.2)), normalize(cloud), 2.4), debris, 0.12 * vary(rnd, 0.5));
    // Now and then something inside goes up a moment later: a smaller second thump.
    if (rnd() > 0.2) {
      const at = Math.round((0.18 + (rnd() * 0.5 + 0.5) * 0.35) * rate);
      const len = Math.round(0.6 * rate);
      const second = envelope(lowpass(white(len, rnd), rate, 500), rate, 0.004, 0.09);
      mix(second, envelope(sweep(len, rate, 90, 35), rate, 0.002, 0.08), 0.8);
      mix(out, normalize(second), 0.35 * vary(rnd, 0.3), at);
    }
    return tail(normalize(saturate(normalize(out), 1.6)), rate, 0.3);
  },
  // A vehicle going up: a smaller blast, a burst of fire and a little falling debris.
  wreck: (rate, rnd) => {
    const n = Math.round(1.5 * vary(rnd, 0.15) * rate);
    const pop = envelope(sweep(n, rate, 110 * vary(rnd, 0.15), 35 * vary(rnd, 0.1)), rate, 0.002, 0.14 * vary(rnd, 0.2));
    const bright = 1400 * vary(rnd, 0.25);
    const fire = envelope(lowpass(white(n, rnd), rate, (i) => bright * Math.exp(-i / rate / 0.15) + 180), rate, 0.002, 0.35 * vary(rnd, 0.25));
    const debris = lowpass(crackle(n, rate, rnd, 60 * vary(rnd, 0.5), (t) => (t > 0.1 ? 1 - t : 0), 0.01), rate, 2000);
    const out = mix(mix(pop, normalize(fire), 2 * vary(rnd, 0.2)), debris, 0.2 * vary(rnd, 0.4));
    // Sometimes the fuel or ammunition catches a beat later.
    if (rnd() > 0.3) {
      const at = Math.round((0.12 + (rnd() * 0.5 + 0.5) * 0.3) * rate);
      const len = Math.round(0.4 * rate);
      mix(out, normalize(envelope(lowpass(white(len, rnd), rate, 700), rate, 0.003, 0.06)), 0.3 * vary(rnd, 0.3), at);
    }
    return tail(normalize(saturate(normalize(out), 1.4)), rate, 0.15);
  },
  // A building coming down: a long grinding rumble with crunches in it.
  collapse: (rate, rnd) => {
    const n = Math.round(3.2 * vary(rnd, 0.15) * rate);
    const rumble = lowpass(lowpass(white(n, rnd), rate, 320 * vary(rnd, 0.2)), rate, 400);
    const settle = 1.3 * vary(rnd, 0.25);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      rumble[i] *= Math.min(1, t * 8) * Math.pow(1 - t, settle);
    }
    const crunch = lowpass(crackle(n, rate, rnd, 40 * vary(rnd, 0.4), (t) => Math.pow(1 - t, 2), 0.03), rate, 1800);
    return tail(normalize(saturate(normalize(mix(normalize(rumble), normalize(crunch), 0.5 * vary(rnd, 0.3))), 1.4)), rate, 0.2);
  },
  // Construction starting: a few heavy, dull knocks of beams going into place.
  build: (rate, rnd, v) => {
    const n = Math.round(0.9 * rate);
    const out = new Float32Array(n);
    const hits = 3 + v;
    for (let k = 0; k < hits; k++) {
      const at = Math.round((0.05 + k * 0.17 + (rnd() * 0.5 + 0.5) * 0.04) * rate);
      const len = Math.round(0.25 * rate);
      const knock = envelope(bell(len, rate, 170 + (rnd() * 0.5 + 0.5) * 90, 0.05, [1, 1.7]), rate, 0, 0.04);
      mix(knock, normalize(envelope(lowpass(white(len, rnd), rate, 1200), rate, 0.0005, 0.012)), 0.6);
      mix(out, knock, 0.7 - k * 0.1, at);
    }
    return tail(normalize(lowpass(out, rate, 1800)), rate);
  },
  // Engineers digging: a dry scrape and spill of earth.
  dig: (rate, rnd, v) => {
    const n = Math.round(0.8 * rate);
    const scrape = bandpass(white(n, rnd), rate, (i) => 600 - (i / n) * 300 + v * 50, 0.8);
    for (let i = 0; i < n; i++) scrape[i] *= Math.sin((Math.PI * i) / n) ** 2;
    const spill = lowpass(crackle(n, rate, rnd, 200, (t) => (t > 0.4 ? 1 - t : 0), 0.008), rate, 1200);
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
    // Equal-power: the two ends are different noise, so a straight fade would dip ~3 dB mid-way.
    const k = (i / f) * (Math.PI / 2);
    out[i] = buf[n + i] * Math.cos(k) + buf[i] * Math.sin(k);
  }
  return out;
}

const LOOPS: Record<LoopId, (rate: number, rnd: () => number) => Float32Array> = {
  // Wind: what makes recorded wind sound like wind is gusts (slow swells of a few dB) that move
  // everything at once: a low buffeting rumble, and narrow whistles whose pitch rises as the
  // gust builds. Broad filtered noise alone sounds like a hiss. It's two loops of different
  // lengths (37 s here, 23 s for the howls) whose gusts each fit their loop exactly, so neither
  // has a seam and together they only line up again after about 14 minutes.
  wind: (rate, rnd) => {
    const len = Math.round(37 * rate);
    const n = len + Math.round(LOOP_FADE * rate);
    const gust = loopGust(n, len, rnd, [2, 3, 5, 8], 0.5);
    const buffet = normalize(lowpass(lowpass(white(n, rnd), rate, 110), rate, 140));
    const body = normalize(lowpass(highpass(white(n, rnd), rate, 120), rate, 450));
    const rustle = normalize(lowpass(highpass(white(n, rnd), rate, 1500), rate, 4500));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = gust[i];
      out[i] = buffet[i] * 0.3 * (0.5 + g) + body[i] * 0.45 * g + rustle[i] * 0.05 * g * g;
    }
    return normalize(seamless(out, rate, LOOP_FADE), 0.5);
  },
  // The wind's howls and whistles, on a loop of their own (see wind).
  windHowl: (rate, rnd) => {
    const len = Math.round(23 * rate);
    const n = len + Math.round(LOOP_FADE * rate);
    const gust = loopGust(n, len, rnd, [2, 3, 5], 0.45);
    const gust2 = loopGust(n, len, rnd, [1, 4, 7], 0.4);
    const howl = normalize(bandpass(white(n, rnd), rate, (i) => 260 + 220 * gust[i], 9));
    const whistle = normalize(bandpass(white(n, rnd), rate, (i) => 640 + 320 * gust2[i], 14));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = howl[i] * 0.3 * gust[i] ** 1.5 + whistle[i] * 0.16 * gust2[i] ** 1.5;
    return normalize(seamless(out, rate, LOOP_FADE), 0.5);
  },
  // A far-off war: a deep rumble with distant thumps rolling in it.
  rumble: (rate, rnd) => {
    const n = Math.round(29.5 * rate);
    const bed = lowpass(lowpass(white(n, rnd), rate, 200), rate, 260);
    normalize(bed, 0.4);
    for (let k = 0; k < 48; k++) {
      const at = Math.round((rnd() * 0.5 + 0.5) * (n - rate));
      const boom = envelope(lowpass(lowpass(white(Math.round(1.2 * rate), rnd), rate, 320), rate, 320), rate, 0.03, 0.3);
      mix(bed, normalize(boom, 0.3 + (rnd() * 0.5 + 0.5) * 0.5), 1, at);
    }
    return normalize(seamless(saturate(normalize(lowpass(bed, rate, 380)), 1.5), rate), 0.6);
  },
  // Gunfire somewhere far away: muffled pops in irregular bursts.
  distantFire: (rate, rnd) => {
    const n = Math.round(19.5 * rate);
    const out = new Float32Array(n);
    const pop = (seed: number) => envelope(lowpass(white(Math.round(0.08 * rate), noiseSource(seed)), rate, 1200), rate, 0.001, 0.015);
    let t = 0;
    while (t < 19) {
      // A burst of 2-7 shots, then a gap.
      const shots = 2 + Math.floor((rnd() * 0.5 + 0.5) * 6);
      const gap = 0.06 + (rnd() * 0.5 + 0.5) * 0.08;
      for (let s = 0; s < shots; s++) mix(out, pop(Math.floor(t * 1000) + s), 0.4 + (rnd() * 0.5 + 0.5) * 0.6, Math.round((t + s * gap) * rate));
      t += shots * gap + 0.1 + (rnd() * 0.5 + 0.5) * 0.9;
    }
    return normalize(seamless(lowpass(out, rate, 1000), rate, 0.3), 0.6);
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
  if (id.startsWith('chime') || id === 'quake') return 1;
  return EXPLOSIONS.includes(id) ? 6 : VARIANTS;
}

/**
 * The impulse response of a wide outdoor space, for a ConvolverNode: a few early echoes off
 * the ground and nearby hills, then a two-second tail that loses its highs as it fades (air
 * absorbs them). Sending every sound a little of this is most of what makes it sound far off.
 * Two channels, different noise in each, so the space is wide.
 */
export function renderReverb(rate: number): [Float32Array, Float32Array] {
  const n = Math.round(2.6 * rate);
  const make = (seed: number) => {
    const rnd = noiseSource(seed);
    const out = new Float32Array(n);
    // Open country: the first echo comes back late (35 ms and more), then a handful of
    // separate slap-backs off buildings and hills over the next few tenths of a second.
    // Small rooms are dense, early echoes; their absence is what reads as space.
    const pre = 0.035;
    for (let k = 0; k < 6; k++) {
      const at = pre + 0.04 + (k / 6) * 0.34 + (rnd() * 0.5 + 0.5) * 0.05;
      const len = Math.round(0.02 * rate);
      const slap = envelope(lowpass(white(len, rnd), rate, 2500 - k * 300), rate, 0.002, 0.006);
      mix(out, slap, (0.55 - k * 0.06) * (0.7 + (rnd() * 0.5 + 0.5) * 0.3), Math.round(at * rate));
    }
    // Then a long, slow-building, dark diffuse tail. It is 50 dB down by 2.6 s, so the impulse
    // stops there: the convolver is most of the audio thread's work, and its cost grows with length.
    const diffuse = lowpass(white(n, rnd), rate, (i) => 3500 * Math.exp(-i / rate / 0.8) + 300);
    for (let i = 0; i < n; i++) {
      const t = i / rate - pre;
      diffuse[i] = t <= 0 ? 0 : diffuse[i] * Math.min(1, t / 0.15) * Math.exp(-t / 0.5);
    }
    mix(out, diffuse, 0.35);
    return lowpass(tail(out, rate, 0.3), rate, 5000);
  };
  return [normalize(make(101)), normalize(make(202))];
}

export function renderLoop(id: LoopId, rate: number): Float32Array {
  return LOOPS[id](rate, noiseSource(hash(id)));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
