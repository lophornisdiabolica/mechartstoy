import { hashSeed } from '../core/rng';
import { Game, SIM_HZ } from '../game/game';
import { BattleSettings, defaultFaction, defaultSettings, factionDefs } from '../game/settings';
import { DOCTRINE_IDS, DoctrineId } from '../game/doctrines';
import { applyParams, settingsToParams } from '../ui/settingsUrl';

/**
 * Headless battles for balance checks (`npm run sims`, see scripts/sims.mjs).
 * Each scenario is a setup; each battle plays it out at full speed with no
 * rendering, from a seed named after the scenario and battle number, so a
 * result can be replayed in the browser from its link. Nothing here touches
 * the DOM or Node, so it runs the same in the test suite.
 */
export interface Scenario {
  id: string;
  label: string;
  /** Battles in a full run, and in a quick one. */
  battles: number;
  quick: number;
  /** Changes from the default settings. */
  setup: (s: BattleSettings) => void;
  /** Eternal battles never end, so they run this many minutes and report what happened. */
  minutes?: number;
}

/** Give each side its team: [0, 1] is 1v1, [0, 0, 1, 1] is 2v2, [0, 1, 2] a free-for-all. */
function sides(teams: number[]): (s: BattleSettings) => void {
  return (s) => {
    s.factions = teams.map((team, i) => ({ ...defaultFaction(i), team }));
  };
}

function conquest(...changes: ((s: BattleSettings) => void)[]): (s: BattleSettings) => void {
  return (s) => {
    s.mode = 'conquest';
    for (const change of changes) change(s);
  };
}

/**
 * A spread of setups that covers what changes tend to affect: map size,
 * team shapes, outposts and attack timing. Update this list when a PR adds
 * something worth watching.
 */
export const SCENARIOS: Scenario[] = [
  { id: '1v1', label: '1v1, medium', battles: 24, quick: 8, setup: conquest(sides([0, 1])) },
  { id: '1v1-small', label: '1v1, small map', battles: 12, quick: 4, setup: conquest(sides([0, 1]), (s) => (s.map.size = 'small')) },
  { id: '1v1-large', label: '1v1, large map', battles: 8, quick: 3, setup: conquest(sides([0, 1]), (s) => (s.map.size = 'large')) },
  { id: '1v1-no-outposts', label: '1v1, no outposts', battles: 12, quick: 4, setup: conquest(sides([0, 1]), (s) => (s.map.outposts = 0)) },
  { id: '1v1-tide', label: '1v1, attacks on the tide', battles: 12, quick: 4, setup: conquest(sides([0, 1]), (s) => (s.armies.attackTiming = 'tide')) },
  {
    id: '1v1-rugged',
    label: '1v1, wet and hilly (movement classes)',
    battles: 12,
    quick: 4,
    setup: conquest(sides([0, 1]), (s) => {
      s.map.water = 1;
      s.map.hills = 1.6;
    }),
  },
  { id: '2v2', label: '2v2', battles: 12, quick: 4, setup: conquest(sides([0, 0, 1, 1])) },
  { id: '1v3', label: '1v3', battles: 12, quick: 4, setup: conquest(sides([0, 1, 1, 1])) },
  { id: 'ffa3', label: 'Free-for-all, 3 sides', battles: 12, quick: 4, setup: conquest(sides([0, 1, 2])) },
  { id: 'ffa4', label: 'Free-for-all, 4 sides', battles: 8, quick: 3, setup: conquest(sides([0, 1, 2, 3])) },
  { id: 'ffa6', label: 'Free-for-all, 6 sides', battles: 4, quick: 2, setup: conquest(sides([0, 1, 2, 3, 4, 5])) },
  { id: 'eternal', label: 'Eternal 1v1, first 10 minutes', battles: 6, quick: 2, setup: sides([0, 1]), minutes: 10 },
];

/** Conquest battles still going after this many minutes are called undecided. */
export const TIME_LIMIT = 60;

export interface SideResult {
  name: string;
  doctrine: DoctrineId;
  /** Team number as the setup screen shows it (1, 2, ...). */
  team: number;
  /** Minutes in when it was knocked out, or null. */
  out: number | null;
  kills: number;
  lost: number;
  razed: number;
  captured: number;
  attacks: number;
}

export interface BattleResult {
  scenario: string;
  seed: string;
  /** Battle length in minutes (the time limit if undecided). */
  minutes: number;
  /** Conquest: whether someone won. Eternal battles are never decided. */
  decided: boolean;
  /** Winning team number (1, 2, ...), or null. */
  winner: number | null;
  sides: SideResult[];
  /** Average milliseconds per sim tick, on the machine that ran it. */
  msPerTick: number;
  /** Query string that replays this battle in the browser. */
  link: string;
}

/**
 * The settings a scenario's battle runs with. `overrides` is a query string
 * in the URL's format (e.g. `sgrow=none&scap=2`), applied on top of the
 * scenario's setup, for comparing a setting's options across the same battles.
 */
export function scenarioSettings(scenario: Scenario, battle: number, overrides = ''): BattleSettings {
  const s = defaultSettings();
  scenario.setup(s);
  applyParams(s, new URLSearchParams(overrides));
  s.seed = `${scenario.id}-${battle}`;
  return s;
}

/** Play one battle of a scenario to the end (or its time limit). */
export function runBattle(scenario: Scenario, battle: number, now: () => number = () => performance.now(), overrides = ''): BattleResult {
  const settings = scenarioSettings(scenario, battle, overrides);
  const game = new Game(hashSeed(settings.seed), { settings });
  const { sides } = game.ctx;
  const teamOrder = [...new Set(settings.factions.map((f) => f.team))];
  const attacks = settings.factions.map(() => 0);
  const attacking = settings.factions.map(() => false);
  const limit = (scenario.minutes ?? TIME_LIMIT) * 60;
  const dt = 1 / SIM_HZ;
  const start = now();
  let ticks = 0;
  while (game.outcome === null && game.world.time < limit) {
    game.step(dt);
    ticks++;
    if (ticks % SIM_HZ === 0) {
      for (let f = 0; f < sides.count; f++) {
        const now = !sides.eliminated[f] && game.ctx.offensive.attacking(f, game.world.time);
        if (now && !attacking[f]) attacks[f]++;
        attacking[f] = now;
      }
    }
  }
  const outcome = game.outcome;
  const names = factionDefs(settings).map((d) => d.name);
  return {
    scenario: scenario.id,
    seed: settings.seed,
    minutes: (outcome ? outcome.time : game.world.time) / 60,
    decided: outcome !== null && outcome.team !== null,
    winner: outcome && outcome.team !== null ? teamOrder.indexOf(outcome.team) + 1 : null,
    sides: settings.factions.map((f, i) => ({
      name: names[i],
      doctrine: f.doctrine,
      team: teamOrder.indexOf(f.team) + 1,
      out: sides.eliminatedAt[i] === null ? null : sides.eliminatedAt[i]! / 60,
      kills: game.stats.sides[i].kills,
      lost: game.stats.sides[i].lost,
      razed: game.stats.sides[i].razed,
      captured: game.stats.sides[i].captured,
      attacks: attacks[i],
    })),
    msPerTick: (now() - start) / Math.max(1, ticks),
    link: settingsToParams(settings).toString(),
  };
}

export interface ScenarioSummary {
  scenario: string;
  label: string;
  battles: number;
  /** Conquest battles with no winner by the time limit. */
  undecided: number;
  /** Battle length in minutes: median, mean, shortest and longest. */
  median: number;
  mean: number;
  shortest: number;
  longest: number;
  /** Wins per team number, e.g. { 1: 5, 2: 7 }. */
  wins: Record<number, number>;
  /** Per battle: units killed, buildings razed, outposts taken, attacks launched (all sides together). */
  kills: number;
  razed: number;
  captured: number;
  attacks: number;
  msPerTick: number;
  /** Seeds of the shortest and longest battles, to replay. */
  shortestSeed: string;
  longestSeed: string;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

/** Totals for a scenario's battles. */
export function summarize(scenario: Scenario, results: BattleResult[]): ScenarioSummary {
  const lengths = results.map((r) => r.minutes);
  const wins: Record<number, number> = {};
  for (const r of results) if (r.winner !== null) wins[r.winner] = (wins[r.winner] ?? 0) + 1;
  const per = (f: (s: SideResult) => number) => mean(results.map((r) => r.sides.reduce((a, s) => a + f(s), 0)));
  const byLength = [...results].sort((a, b) => a.minutes - b.minutes);
  return {
    scenario: scenario.id,
    label: scenario.label,
    battles: results.length,
    undecided: scenario.minutes ? 0 : results.filter((r) => !r.decided).length,
    median: median(lengths),
    mean: mean(lengths),
    shortest: byLength[0]?.minutes ?? 0,
    longest: byLength[byLength.length - 1]?.minutes ?? 0,
    wins,
    kills: per((s) => s.kills),
    razed: per((s) => s.razed),
    captured: per((s) => s.captured),
    attacks: per((s) => s.attacks),
    msPerTick: mean(results.map((r) => r.msPerTick)),
    shortestSeed: byLength[0]?.seed ?? '',
    longestSeed: byLength[byLength.length - 1]?.seed ?? '',
  };
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const min = (m: number) => `${m.toFixed(1)}m`;

/** A plain-text table of summaries, one row per scenario. */
export function formatTable(summaries: ScenarioSummary[], eternal: Set<string>): string {
  const head = ['Scenario', 'Battles', 'Median', 'Mean', 'Range', 'Wins by team', 'Kills', 'Razed', 'Outposts', 'Attacks', 'ms/tick'];
  const rows = summaries.map((s) => {
    const forever = eternal.has(s.scenario);
    const wins = forever
      ? 'runs 10 minutes'
      : Object.entries(s.wins)
          .map(([t, n]) => `T${t}:${n}`)
          .join(' ') + (s.undecided ? ` undecided:${s.undecided}` : '');
    return [
      s.label,
      String(s.battles),
      forever ? '-' : min(s.median),
      forever ? '-' : min(s.mean),
      forever ? '-' : `${min(s.shortest)}–${min(s.longest)}`,
      wins,
      s.kills.toFixed(0),
      s.razed.toFixed(0),
      s.captured.toFixed(1),
      s.attacks.toFixed(1),
      s.msPerTick.toFixed(2),
    ];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd();
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/**
 * An orthogonal array of strength 2: rows of `factors` values, each from 0 to
 * `levels` - 1 (`levels` must be prime), where every pair of columns shows
 * every pair of values equally often. Used to give sides doctrines so every
 * pairing of doctrines between any two sides comes up equally, in far fewer
 * battles than every combination: 9 rows for up to 4 sides with 3 doctrines,
 * 27 for up to 13.
 *
 * Built the textbook way: the rows are all vectors of length k over Z_levels,
 * the columns are distinct directions (vectors whose last non-zero entry is
 * 1), and an entry is their dot product mod `levels`.
 */
export function orthogonalArray(levels: number, factors: number): number[][] {
  const p = levels;
  if (p < 2) throw new Error('orthogonalArray needs at least 2 levels');
  for (let d = 2; d * d <= p; d++) if (p % d === 0) throw new Error(`orthogonalArray needs a prime number of levels, not ${p}`);
  let k = 2;
  while ((p ** k - 1) / (p - 1) < factors) k++;
  const vec = (n: number) => Array.from({ length: k }, (_, i) => Math.floor(n / p ** i) % p);
  const columns: number[][] = [];
  for (let n = 1; n < p ** k && columns.length < factors; n++) {
    const v = vec(n);
    let lead = 0;
    for (const x of v) if (x !== 0) lead = x;
    if (lead === 1) columns.push(v);
  }
  return Array.from({ length: p ** k }, (_, r) => {
    const row = vec(r);
    return columns.map((c) => c.reduce((s, x, i) => s + x * row[i], 0) % p);
  });
}

/** Query strings (see scenarioSettings' overrides) giving each side a doctrine, one per row of an orthogonal array. */
export function doctrinePlans(sides: number): string[] {
  return orthogonalArray(DOCTRINE_IDS.length, sides).map((row) => row.map((d, i) => `doc${i + 1}=${DOCTRINE_IDS[d]}`).join('&'));
}

export interface DoctrineSummary {
  doctrine: DoctrineId;
  /** Sides it played in decided battles, how many of those were on the winning team, and the rate. */
  played: number;
  won: number;
  rate: number;
}

/** Wins per doctrine across decided battles (a doctrine on several sides of one battle counts once per side). */
export function summarizeDoctrines(results: BattleResult[]): DoctrineSummary[] {
  return DOCTRINE_IDS.map((doctrine) => {
    let played = 0;
    let won = 0;
    for (const r of results) {
      if (!r.decided) continue;
      for (const s of r.sides) {
        if (s.doctrine !== doctrine) continue;
        played++;
        if (s.team === r.winner) won++;
      }
    }
    return { doctrine, played, won, rate: played ? won / played : 0 };
  });
}

/** For two-sided battles: wins of each doctrine (row) against each other doctrine (column). */
export function headToHead(results: BattleResult[]): Record<DoctrineId, Record<DoctrineId, number>> {
  const grid = Object.fromEntries(DOCTRINE_IDS.map((a) => [a, Object.fromEntries(DOCTRINE_IDS.map((b) => [b, 0]))])) as Record<DoctrineId, Record<DoctrineId, number>>;
  for (const r of results) {
    if (r.sides.length !== 2 || r.winner === null) continue;
    const w = r.sides.find((s) => s.team === r.winner)!;
    const l = r.sides.find((s) => s.team !== r.winner)!;
    grid[w.doctrine][l.doctrine]++;
  }
  return grid;
}

/** Plain-text tables of doctrine results. */
export function formatDoctrines(results: BattleResult[]): string {
  const lines = ['Doctrine    Played  Won   Win rate', '----------  ------  ----  --------'];
  for (const d of summarizeDoctrines(results)) lines.push(`${pad(d.doctrine, 10)}  ${pad(String(d.played), 6)}  ${pad(String(d.won), 4)}  ${Math.round(d.rate * 100)}%`);
  if (results.some((r) => r.sides.length === 2)) {
    const grid = headToHead(results);
    lines.push('', 'Two-sided battles, wins of each row against each column:', pad('', 10) + DOCTRINE_IDS.map((d) => pad(d, 9)).join(''));
    for (const a of DOCTRINE_IDS) lines.push(pad(a, 10) + DOCTRINE_IDS.map((b) => pad(a === b ? '-' : String(grid[a][b]), 9)).join(''));
  }
  return lines.join('\n');
}
