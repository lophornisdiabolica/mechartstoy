/// <reference lib="webworker" />
import { LOOP_IDS, renderLoop, renderReverb, renderSound, SOUND_IDS, variantsOf } from './synth';

/**
 * Renders every sound (see synth.ts) off the page's thread, so starting the
 * audio doesn't stall a frame, and posts each one back as soon as it's done:
 * the reverb and beds first, then the commonest sounds, then the rest.
 */
export type FromAudioWorker = { kind: 'loop' | 'sound' | 'reverb'; id: string; variant: number; data: Float32Array };

self.onmessage = (ev: MessageEvent<{ rate: number }>) => {
  const { rate } = ev.data;
  const send = (m: FromAudioWorker) => (self as unknown as Worker).postMessage(m, [m.data.buffer]);
  renderReverb(rate).forEach((data, ch) => send({ kind: 'reverb', id: 'reverb', variant: ch, data }));
  for (const id of LOOP_IDS) send({ kind: 'loop', id, variant: 0, data: renderLoop(id, rate) });
  for (const id of SOUND_IDS) for (let v = 0; v < variantsOf(id); v++) send({ kind: 'sound', id, variant: v, data: renderSound(id, rate, v) });
};
