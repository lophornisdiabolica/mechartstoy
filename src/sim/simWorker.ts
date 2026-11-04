/// <reference lib="webworker" />
import { FromSim, SimHost, ToSim } from './mirror';

/**
 * The sim worker: plays the battle the page asks for, a batch of ticks at a
 * time, and answers each batch with a Frame (see mirror.ts). Drawing stays
 * on the page's thread, so the two use separate CPU cores.
 */
let host: SimHost | null = null;
let battle = -1;

const post = (msg: FromSim, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = (ev: MessageEvent<ToSim>) => {
  const m = ev.data;
  try {
    if (m.type === 'start') {
      battle = m.battle;
      host = new SimHost(m.seed, m.settings);
      return;
    }
    // Anything for a battle that's since been replaced is dropped.
    if (!host || m.battle !== battle) return;
    if (m.type === 'command') host.command(m.command);
    else if (m.type === 'settings') host.settings(m.settings);
    else if (m.type === 'step') {
      host.step(m.steps, m.profile);
      const { frame, transfer } = host.frame();
      post({ type: 'frame', battle, frame }, transfer);
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
};
