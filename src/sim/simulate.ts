import { hashSeed } from '../core/rng';
import { Game, SIM_HZ } from '../game/game';
import { BattleSettings, defaultFaction, defaultSettings, factionDefs } from '../game/settings';
import { settingsToParams } from '../ui/settingsUrl';

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

/** The settings a scenario's battle runs with. */
export function scenarioSettings(scenario: Scenario, battle: number): BattleSettings {
  const s = defaultSettings();
  scenario.setup(s);
  s.seed = `${scenario.id}-${battle}`;
  return s;
}

/** Play one battle of a scenario to the end (or its time limit). */
export function runBattle(scenario: Scenario, battle: number, now: () => number = () => performance.now()): BattleResult {
  const settings = scenarioSettings(scenario, battle);
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
