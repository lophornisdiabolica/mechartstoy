// Renders every sound the game makes to WAV files, to listen to outside the
// game, with a spectrogram PNG of each (time across, pitch up, loudness as
// brightness, the waveform on top) and a report of each one's length,
// loudness, where its energy sits (sub/low/mid/high) and how long it took
// to render. Run with `npm run sounds` (`-- --out DIR`, `-- --rate 48000`,
// `-- --only blast,thud`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const out = resolve(opt('--out', join(root, 'sounds-out')));
const rate = Number(opt('--rate', 44100));
const only = opt('--only', '').split(',').filter(Boolean);

// ---- a minimal PNG encoder (as in map.mjs)
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(width, height, data) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- spectra
const N = 2048;
/** In-place radix-2 FFT of re/im (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(a * k);
        const wi = Math.sin(a * k);
        const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k + len / 2] = re[i + k] - xr;
        im[i + k + len / 2] = im[i + k] - xi;
        re[i + k] += xr;
        im[i + k] += xi;
      }
    }
  }
}
/** Power spectrum frames: one Float32Array of N/2 bins per hop. */
function frames(s, hop) {
  const out = [];
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let at = 0; at + N / 4 < s.length; at += hop) {
    for (let i = 0; i < N; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
      re[i] = (s[at + i] ?? 0) * w;
      im[i] = 0;
    }
    fft(re, im);
    const p = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
    out.push(p);
  }
  return out;
}
/** Share of energy below 100 Hz, 100-500, 500-2000 and above, and the spectral centroid. */
function bands(spec, rate) {
  const edges = [100, 500, 2000, Infinity];
  const e = [0, 0, 0, 0];
  let total = 0;
  let centroid = 0;
  for (const p of spec)
    for (let k = 1; k < p.length; k++) {
      const f = (k * rate) / N;
      e[edges.findIndex((x) => f < x)] += p[k];
      total += p[k];
      centroid += p[k] * f;
    }
  const pc = e.map((v) => `${Math.round((v / total) * 100)}`.padStart(3));
  return `sub/low/mid/high %${pc.join('')}  centroid ${Math.round(centroid / total)} Hz`;
}
/** A spectrogram picture: log frequency 30 Hz to 16 kHz up the side, a waveform strip on top. */
function spectrogram(s, rate) {
  const hop = Math.max(64, Math.round(s.length / 600));
  const spec = frames(s, hop);
  const W = spec.length;
  const WAVE = 50;
  const H = 200;
  const data = new Uint8Array(W * (H + WAVE) * 4);
  const put = (x, y, r, g, b) => data.set([r, g, b, 255], (y * W + x) * 4);
  for (let x = 0; x < W; x++) {
    // Waveform: peak in this column.
    let m = 0;
    for (let i = x * hop; i < Math.min(s.length, (x + 1) * hop); i++) m = Math.max(m, Math.abs(s[i]));
    for (let y = 0; y < WAVE; y++) {
      const on = Math.abs(y - WAVE / 2) <= m * (WAVE / 2);
      put(x, y, on ? 120 : 18, on ? 200 : 18, on ? 255 : 24);
    }
    for (let y = 0; y < H; y++) {
      const f = 30 * Math.pow(16000 / 30, 1 - y / H);
      const k = Math.min(N / 2 - 1, Math.round((f * N) / rate));
      const db = 10 * Math.log10(spec[x][k] + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 40) / 70));
      // Dark blue to magenta to orange to pale yellow.
      put(x, WAVE + y, Math.round(255 * Math.min(1, v * 1.6)), Math.round(255 * Math.max(0, v * 1.4 - 0.4)), Math.round(255 * (v < 0.4 ? 0.2 + v : Math.max(0, 1.1 - v * 1.4))));
    }
  }
  // Lines at 100 Hz, 1 kHz and 10 kHz.
  for (const f of [100, 1000, 10000]) {
    const y = Math.round(H * (1 - Math.log(f / 30) / Math.log(16000 / 30)));
    for (let x = 0; x < W; x += 4) put(x, WAVE + y, 90, 90, 90);
  }
  return { png: png(W, H + WAVE, data), spec };
}

/** 16-bit mono PCM WAV. */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}

/** Length, peak, RMS loudness and a rough brightness (zero crossings per second, about twice the dominant frequency). */
function describe(s, rate) {
  let peak = 0;
  let sum = 0;
  let zc = 0;
  for (let i = 0; i < s.length; i++) {
    peak = Math.max(peak, Math.abs(s[i]));
    sum += s[i] * s[i];
    if (i > 0 && (s[i - 1] < 0) !== (s[i] < 0)) zc++;
  }
  const db = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
  return `${(s.length / rate).toFixed(2)}s  peak ${db(peak)} dB  rms ${db(Math.sqrt(sum / s.length))} dB  ~${Math.round(zc / 2 / (s.length / rate))} Hz`;
}

const synth = (await runnerImport(join(root, 'src/audio/synth.ts'))).module;
mkdirSync(out, { recursive: true });
const t0 = performance.now();
const report = (name, s, ms) => {
  const pic = spectrogram(s, rate);
  writeFileSync(join(out, name.replace('.wav', '.png')), pic.png);
  console.log(`${name.padEnd(22)} ${describe(s, rate)}  ${bands(pic.spec, rate)}  ${ms.toFixed(0)} ms`);
};
let renderMs = 0;
for (const id of synth.SOUND_IDS) {
  if (only.length && !only.includes(id)) continue;
  for (let v = 0; v < synth.variantsOf(id); v++) {
    const t = performance.now();
    const s = synth.renderSound(id, rate, v);
    const ms = performance.now() - t;
    renderMs += ms;
    const name = `${id}-${v + 1}.wav`;
    writeFileSync(join(out, name), wav(s, rate));
    report(name, s, ms);
  }
}
for (const id of synth.LOOP_IDS) {
  if (only.length && !only.includes(id)) continue;
  const t = performance.now();
  const s = synth.renderLoop(id, rate);
  const ms = performance.now() - t;
  renderMs += ms;
  report(`loop-${id}.wav`, s, ms);
  // Twice round, so the seam can be heard (or not).
  const twice = new Float32Array(s.length * 2);
  twice.set(s);
  twice.set(s, s.length);
  writeFileSync(join(out, `loop-${id}.wav`), wav(twice, rate));
}
if (!only.length || only.includes('reverb')) {
  const [l] = synth.renderReverb(rate);
  writeFileSync(join(out, 'reverb-impulse.wav'), wav(l, rate));
  report('reverb-impulse.wav', l, 0);
}
console.log(`\nSynthesis took ${Math.round(renderMs)} ms of ${Math.round(performance.now() - t0)} ms; files in ${out}`);
