import { hashSeed } from '../core/rng';
import { Health, Transform } from '../game/components';
import { Game, SIM_HZ } from '../game/game';
import { BattleSettings, defaultSettings } from '../game/settings';
import { applyParams } from '../ui/settingsUrl';

/**
 * `npm run bench` (see scripts/bench.mjs): how fast the sim runs, on a few
 * fixed battles from small to as big as the game gets, one at a time so the
 * timings are steady. Each case also leaves a fingerprint of where every
 * entity ended up, so a change meant only to make the sim faster can show
 * that it plays out exactly the same.
 */

export interface BenchCase {
  id: string;
  label: string;
  /** Settings in the link's format, on top of the defaults (Eternal, so nothing ends early). */
  query: string;
}

export const BENCH_CASES: BenchCase[] = [
  { id: '1v1', label: '1v1, medium map', query: 'seed=bench-1v1' },
  { id: '2v2', label: '2v2, large map', query: 'seed=bench-2v2&size=large&sides=4&team2=1&team3=2&team4=2' },
  { id: 'ffa8', label: '8-side free-for-all, large map', query: 'seed=bench-ffa8&size=large&sides=8' },
];

export interface BenchResult {
  id: string;
  label: string;
  minutes: number;
  ticks: number;
  /** Milliseconds per tick: mean, median, 95th percentile, and the slowest (with the minute it came at). */
  mean: number;
  p50: number;
  p95: number;
  worst: number;
  worstAt: number;
  /** Entities alive at the end. */
  entities: number;
  /** Milliseconds per tick in each system, when profiled. */
  systems?: Record<string, number>;
  /** A hash of every entity's position and health at the end: equal means the battle played out the same. */
  fingerprint: string;
}

export function benchSettings(c: BenchCase): BattleSettings {
  const s = defaultSettings();
  applyParams(s, new URLSearchParams(c.query));
  return s;
}

/** Play a case for `minutes` of battle time. */
export function runBench(c: BenchCase, minutes: number, profile: boolean): BenchResult {
  const settings = benchSettings(c);
  const game = new Game(hashSeed(settings.seed), { settings });
  if (profile) game.world.profile = new Map();
  const ticks = Math.round(minutes * 60 * SIM_HZ);
  const times = new Float64Array(ticks);
  let worstAt = 0;
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    game.step(1 / SIM_HZ);
    times[i] = performance.now() - t0;
    if (times[i] > times[worstAt]) worstAt = i;
  }
  const sorted = Float64Array.from(times).sort();
  const total = times.reduce((a, b) => a + b, 0);
  return {
    id: c.id,
    label: c.label,
    minutes,
    ticks,
    mean: total / ticks,
    p50: sorted[Math.floor(ticks * 0.5)],
    p95: sorted[Math.floor(ticks * 0.95)],
    worst: times[worstAt],
    worstAt: worstAt / SIM_HZ / 60,
    entities: game.world.entityCount,
    ...(game.world.profile ? { systems: Object.fromEntries([...game.world.profile].map(([k, v]) => [k, v / ticks])) } : {}),
    fingerprint: fingerprint(game),
  };
}

/** Every entity's id, position and health, rounded and hashed. */
export function fingerprint(game: Game): string {
  const w = game.world;
  let text = '';
  for (const e of w.query(Transform)) {
    const t = w.req(e, Transform);
    const h = w.get(e, Health);
    text += `${e}:${t.x.toFixed(3)},${t.z.toFixed(3)},${h ? h.hp.toFixed(2) : '-'};`;
  }
  return hashSeed(text).toString(16).padStart(8, '0');
}

const pad = (s: string, n: number, right = false) => (s.length >= n ? s : right ? ' '.repeat(n - s.length) + s : s + ' '.repeat(n - s.length));
const ms = (v: number) => v.toFixed(2);

/** The results as a table, and the three slowest systems per case. */
export function formatBench(results: BenchResult[]): string {
  const head = ['Case', 'Mean', 'Median', '95%', 'Slowest', 'At', 'Entities', 'Fingerprint'];
  const rows = results.map((r) => [r.label, ms(r.mean), ms(r.p50), ms(r.p95), ms(r.worst), `${r.worstAt.toFixed(1)}m`, String(r.entities), r.fingerprint]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i], i > 0 && i < 7)).join('  ');
  const out = [line(head), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)];
  out.push('Milliseconds per tick (the sim ticks 30 times a second, so 33 ms is the most it can take and keep up at 1×).');
  for (const r of results) {
    if (!r.systems) continue;
    const top = Object.entries(r.systems).sort((a, b) => b[1] - a[1]).slice(0, 5);
    out.push(`${r.label}: ${top.map(([k, v]) => `${k} ${ms(v)}`).join(', ')}`);
  }
  return out.join('\n');
}

/** Before and after, per case: the change in each timing, and whether the battles still played out the same. */
export function compareBench(before: BenchResult[], after: BenchResult[]): string {
  const out: string[] = [];
  const change = (a: number, b: number) => `${ms(a)} → ${ms(b)} (${b <= a ? '' : '+'}${Math.round((b / a - 1) * 100)}%)`;
  for (const b of after) {
    const a = before.find((x) => x.id === b.id);
    if (!a) continue;
    out.push(`${b.label}:`);
    out.push(`  mean ${change(a.mean, b.mean)}, 95% ${change(a.p95, b.p95)}, slowest ${change(a.worst, b.worst)}`);
    out.push(a.minutes !== b.minutes ? `  played for different lengths (${a.minutes} and ${b.minutes} minutes), so the fingerprints can't match` : a.fingerprint === b.fingerprint ? '  same fingerprint: the battle played out exactly the same' : '  DIFFERENT fingerprint: the battle played out differently');
    if (a.systems && b.systems) {
      const moved = Object.keys(b.systems)
        .filter((k) => a.systems![k] !== undefined && Math.abs(b.systems![k] - a.systems![k]) > 0.02)
        .sort((x, y) => Math.abs(b.systems![y] - a.systems![y]) - Math.abs(b.systems![x] - a.systems![x]))
        .slice(0, 6);
      if (moved.length) out.push(`  systems: ${moved.map((k) => `${k} ${change(a.systems![k], b.systems![k])}`).join(', ')}`);
    }
  }
  return out.join('\n');
}
