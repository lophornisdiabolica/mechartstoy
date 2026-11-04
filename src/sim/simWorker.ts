/// <reference lib="webworker" />
import { SIM_HZ } from '../game/game';
import { FromSim, SimHost, ToSim } from './mirror';

/**
 * The sim worker: plays the battle the page asks for, a batch of ticks at a
 * time, and answers each batch with a Frame (see mirror.ts). Drawing stays
 * on the page's thread, so the two use separate CPU cores.
 *
 * A start can ask to fast-forward first (the `at` URL option): the worker
 * plays that far in chunks, reporting progress between them, and answers
 * the page's first ask for ticks once it's there.
 */
let host: SimHost | null = null;
let battle = -1;
/** Ticks still to fast-forward, and a step the page asked for meanwhile. */
let skipping = 0;
let waiting: Extract<ToSim, { type: 'step' }> | null = null;

/** Ticks fast-forwarded between progress reports. */
const CHUNK = SIM_HZ * 10;

const post = (msg: FromSim, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

function answer(m: Extract<ToSim, { type: 'step' }>): void {
  host!.step(m.steps, m.profile);
  const { frame, transfer } = host!.frame();
  post({ type: 'frame', battle, frame }, transfer);
}

function skipSome(forBattle: number): void {
  if (!host || forBattle !== battle || skipping <= 0) return;
  try {
    const n = Math.min(CHUNK, skipping);
    host.skip(n);
    skipping -= n;
    if (host.game.outcome !== null) skipping = 0;
    post({ type: 'progress', battle, time: host.game.world.time });
    if (skipping > 0) setTimeout(() => skipSome(forBattle), 0);
    else if (waiting) {
      const m = waiting;
      waiting = null;
      answer(m);
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
}

self.onmessage = (ev: MessageEvent<ToSim>) => {
  const m = ev.data;
  try {
    if (m.type === 'start') {
      battle = m.battle;
      host = new SimHost(m.seed, m.settings);
      waiting = null;
      skipping = Math.round((m.skip ?? 0) * SIM_HZ);
      if (skipping > 0) setTimeout(() => skipSome(battle), 0);
      return;
    }
    // Anything for a battle that's since been replaced is dropped.
    if (!host || m.battle !== battle) return;
    if (m.type === 'command') host.command(m.command);
    else if (m.type === 'settings') host.settings(m.settings);
    else if (m.type === 'routes') host.routes = m.on;
    else if (m.type === 'step') {
      if (skipping > 0) waiting = m;
      else answer(m);
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  }
};
