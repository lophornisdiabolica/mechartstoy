import { hashSeed } from '../core/rng';
import { Faction, Health, Unit } from '../game/components';
import { Game, SIM_HZ } from '../game/game';
import { defaultFaction, defaultSettings } from '../game/settings';
import { newSquad, spawnUnit } from '../game/spawn';
import { spawnSpot } from '../game/systems/production';
import { UNIT_DEFS, UnitId } from '../game/units';
import { applyParams } from '../ui/settingsUrl';
import { margin } from './simulate';

/**
 * Duels: two groups of units set loose on each other on an empty map, with
 * no bases, production or reinforcements, to see how one unit mix does
 * against another. Faster and far less noisy than whole battles for
 * questions like "how many troopers does a tank take?". `npm run sims --
 * --duel "tank*4 vs trooper*12"` runs them (see scripts/sims.mjs).
 */

/** One side's line-up: unit types and how many of each. */
export type Group = { unit: UnitId; count: number }[];

/** A line-up written as "tank*4+trooper*12" (a bare name is one unit). */
export function parseGroup(text: string): Group {
  return text
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, n = '1'] = part.split('*').map((s) => s.trim());
      if (!(name in UNIT_DEFS)) throw new Error(`Unknown unit "${name}" (units: ${Object.keys(UNIT_DEFS).join(', ')})`);
      const count = Number(n);
      if (!Number.isInteger(count) || count < 1) throw new Error(`Bad count in "${part}"`);
      return { unit: name as UnitId, count };
    });
}

/** A matchup written as "tank*4 vs trooper*12". */
export function parseDuel(text: string): { a: Group; b: Group; label: string } {
  const halves = text.split(/\s+vs\s+/);
  if (halves.length !== 2) throw new Error(`A duel is two line-ups with "vs" between them, e.g. "tank*4 vs trooper*12", not "${text}"`);
  return { a: parseGroup(halves[0]), b: parseGroup(halves[1]), label: text.trim() };
}

export interface DuelOptions {
  /** Distance between the two groups at the start. */
  gap?: number;
  /** Seconds before a duel is called a draw. */
  seconds?: number;
  /** Settings in the URL's format, e.g. `hills=1.2` for hilly ground or `tank=1.2,1,1,1` for tanks with 1.2× health (multipliers for health, damage, speed and range). */
  set?: string;
}

export interface DuelResult {
  label: string;
  round: number;
  /** 'a' or 'b', or null if both were still standing at the time limit (or both died together). */
  winner: 'a' | 'b' | null;
  seconds: number;
  /** Per side: units at the start and left at the end, the share of total health left, and damage done to the other side. */
  sides: { units: number; left: number; health: number; dealt: number }[];
}

/** Empty, open ground: a small dry map with gentle hills, no town and no outposts, unless `set` says otherwise. */
function duelGame(round: number, set: string): Game {
  const s = defaultSettings();
  s.mode = 'eternal';
  s.map.size = 'small';
  s.map.water = 0;
  s.map.hills = 0.4;
  s.map.town = false;
  s.map.outposts = 0;
  s.factions = [0, 1].map((i) => ({ ...defaultFaction(i), team: i, doctrine: 'armour' }));
  applyParams(s, new URLSearchParams(set));
  s.seed = `duel-${round}`;
  return new Game(hashSeed(s.seed), { settings: s, populate: false, autoSpawn: false });
}

/**
 * One round of a duel. Each round is a fresh map (its own seed) with the
 * groups a little shuffled, so a run of rounds averages over the ground.
 * Both groups are ordered to march on the other's starting point, and fight
 * whatever they meet on the way, as they would in a battle.
 */
export function runDuel(duel: { a: Group; b: Group; label: string }, round: number, options: DuelOptions = {}): DuelResult {
  const { gap = 30, seconds = 180, set = '' } = options;
  const game = duelGame(round, set);
  const { world, ctx } = game;
  const rng = ctx.rng.fork(77);
  const angle = rng.range(0, Math.PI * 2);
  const at = (side: number) => {
    const d = (side === 0 ? -gap : gap) / 2;
    return { x: Math.cos(angle) * d, z: Math.sin(angle) * d };
  };
  const units: number[] = [0, 0];
  [duel.a, duel.b].forEach((group, side) => {
    const home = at(side);
    const squad = newSquad(ctx);
    let i = 0;
    for (const { unit, count } of group) {
      const def = ctx.units[unit];
      for (let n = 0; n < count; n++, i++) {
        // A loose block of rows across the line between the groups.
        const across = ((i % 6) - 2.5) * 2.2 + rng.range(-0.5, 0.5);
        const back = Math.floor(i / 6) * 2.4 + rng.range(-0.5, 0.5);
        const away = side === 0 ? -1 : 1;
        const x = home.x + Math.cos(angle) * back * away - Math.sin(angle) * across;
        const z = home.z + Math.sin(angle) * back * away + Math.cos(angle) * across;
        const spot = spawnSpot(ctx, x, z, def.radius, def.move);
        if (!spot) continue;
        spawnUnit(world, ctx, def, side, spot.x, spot.z, squad);
        units[side]++;
      }
    }
    // March on the other group's start, fighting what they meet.
    ctx.orders[side] = { stance: 'hold', rally: at(1 - side) };
  });
  const startHealth = health(game);
  const dt = 1 / SIM_HZ;
  let alive = count(game);
  while (world.time < seconds && alive[0] > 0 && alive[1] > 0) {
    game.step(dt);
    alive = count(game);
  }
  const endHealth = health(game);
  const winner = alive[0] > 0 && alive[1] === 0 ? 'a' : alive[1] > 0 && alive[0] === 0 ? 'b' : null;
  const dealt = (side: number) => Object.values(game.stats.sides[side].types).reduce((s, t) => s + t.dealt, 0);
  return {
    label: duel.label,
    round,
    winner,
    seconds: world.time,
    sides: [0, 1].map((side) => ({ units: units[side], left: alive[side], health: startHealth[side] > 0 ? endHealth[side] / startHealth[side] : 0, dealt: dealt(side) })),
  };
}

function count(game: Game): number[] {
  const n = [0, 0];
  for (const e of game.world.query(Unit, Faction)) {
    const f = game.world.req(e, Faction).id;
    if (f === 0 || f === 1) n[f]++;
  }
  return n;
}

function health(game: Game): number[] {
  const hp = [0, 0];
  for (const e of game.world.query(Unit, Faction, Health)) {
    const f = game.world.req(e, Faction).id;
    if (f === 0 || f === 1) hp[f] += Math.max(0, game.world.req(e, Health).hp);
  }
  return hp;
}

/** Plain-text summary of duel rounds, one row per matchup. */
export function formatDuels(results: DuelResult[]): string {
  const labels = [...new Set(results.map((r) => r.label))];
  const rows = labels.map((label) => {
    const rs = results.filter((r) => r.label === label);
    const n = rs.length;
    const a = rs.filter((r) => r.winner === 'a').length;
    const b = rs.filter((r) => r.winner === 'b').length;
    const avg = (f: (r: DuelResult) => number) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, n);
    const times = rs.map((r) => r.seconds).sort((x, y) => x - y);
    const won = (side: 0 | 1) => {
      const mine = rs.filter((r) => r.winner === (side === 0 ? 'a' : 'b'));
      return mine.length ? `${Math.round((mine.reduce((s, r) => s + r.sides[side].health, 0) / mine.length) * 100)}%` : '-';
    };
    return [
      label,
      String(n),
      `${a}–${b}${n - a - b ? ` (${n - a - b} draw)` : ''}`,
      `${Math.round((a / n) * 100)}% ±${Math.round(margin(a, n) * 100)}`,
      `${Math.round(times[Math.floor(n / 2)] ?? 0)}s`,
      `${avg((r) => r.sides[0].left).toFixed(1)} / ${avg((r) => r.sides[1].left).toFixed(1)}`,
      `${won(0)} / ${won(1)}`,
      `${Math.round(avg((r) => r.sides[0].dealt))} / ${Math.round(avg((r) => r.sides[1].dealt))}`,
    ];
  });
  const head = ['Duel (A vs B)', 'Rounds', 'Wins A–B', 'A wins', 'Median time', 'Left A / B', 'Health left when won A / B', 'Damage A / B'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
