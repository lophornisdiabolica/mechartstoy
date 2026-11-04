import { hashSeed } from '../core/rng';
import { Game, SIM_HZ } from '../game/game';
import { BattleSettings, defaultFaction, defaultSettings, factionDefs } from '../game/settings';
import { DOCTRINE_IDS, DoctrineId } from '../game/doctrines';
import { TypeStats } from '../game/stats';
import { Building, Faction, Producer, Unit } from '../game/components';
import { outpostsHeldBy } from '../game/outposts';
import { applyParams, settingsToParams, UNIT_STATS } from '../ui/settingsUrl';
import { fightingStrength } from '../game/offensive';
import { UNIT_DEFS } from '../game/units';

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

/**
 * Give each side its team: [0, 1] is 1v1, [0, 0, 1, 1] is 2v2, [0, 1, 2] a
 * free-for-all. Every side plays Armour, so the scenarios compare settings
 * in mirror matches; `--doctrines` swaps doctrines in on top.
 */
function sides(teams: number[]): (s: BattleSettings) => void {
  return (s) => {
    s.factions = teams.map((team, i) => ({ ...defaultFaction(i), team, doctrine: 'armour' }));
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
  /** Its army's fighting strength at the end (see fightingStrength). */
  strength?: number;
  /**
   * Its team's share of all the armies' fighting strength, averaged over the
   * battle (sampled every TIMELINE_EVERY seconds): a score beyond win or
   * loss, 1 over the number of teams being even.
   */
  share?: number;
  /** Per unit or building type: built, lost, kills, and who it killed and was killed by. */
  units: Record<string, TypeStats>;
}

export interface BattleResult {
  scenario: string;
  seed: string;
  /** The map type it was played on (see MAP_TYPES), or '' for the scenario's own map. */
  map: string;
  /** Settings changed for this battle on top of the scenario, in the URL's format (including the map type's and the doctrines). */
  set: string;
  /** Battle length in minutes (the time limit if undecided). */
  minutes: number;
  /** Conquest: whether someone won. Eternal battles are never decided. */
  decided: boolean;
  /** Winning team number (1, 2, ...), or null. */
  winner: number | null;
  /** How decisively it was won: the winning team's share of the armies' strength at the end (0.5 to 1 in a two-team battle), or null. */
  margin?: number | null;
  /** With --sweep: the setting and value this battle was played with, e.g. "tforce=0.5". */
  variant?: string;
  sides: SideResult[];
  /** Average milliseconds per sim tick, on the machine that ran it. */
  msPerTick: number;
  /** The slowest tick, in milliseconds, and the minute it came at. */
  worstMs?: number;
  worstAt?: number;
  /** With the timeline option: each side's state every TIMELINE_EVERY seconds (and at the end). */
  timeline?: TimelinePoint[];
  /** With the profile option: milliseconds spent in each system over the whole battle, and the ticks played. */
  profile?: Record<string, number>;
  ticks?: number;
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

/**
 * Named map types for `--maps`, as settings in the URL's format. Each is a
 * change to the scenario's own map, so `medium` is the scenario as it is.
 */
export const MAP_TYPES: Record<string, string> = {
  medium: '',
  wet: 'water=1',
  dry: 'water=0',
  hilly: 'hills=1.6',
  rugged: 'water=1&hills=1.6',
  small: 'size=small',
  large: 'size=large',
  notown: 'town=0',
};

/** A map type's settings: a name from MAP_TYPES, or a name and settings written as `name:query` (e.g. `flat:hills=0`). */
export function mapType(spec: string): { name: string; set: string } {
  if (spec in MAP_TYPES) return { name: spec, set: MAP_TYPES[spec] };
  const eq = spec.indexOf(':');
  if (eq > 0) return { name: spec.slice(0, eq), set: spec.slice(eq + 1) };
  throw new Error(`Unknown map type "${spec}": use one of ${Object.keys(MAP_TYPES).join(', ')}, or name:query, e.g. "flat:hills=0"`);
}

/** Seconds between timeline points. */
export const TIMELINE_EVERY = 30;

/** One moment of a battle's timeline. */
export interface TimelinePoint {
  minute: number;
  sides: {
    units: number;
    buildings: number;
    /** Production buildings (including the HQ) standing. */
    producers: number;
    outposts: number;
    attacking: boolean;
    out: boolean;
    kills: number;
    lost: number;
  }[];
}

/** What a side looks like right now, for the timeline. */
function timelinePoint(game: Game): TimelinePoint {
  const { world, ctx, stats } = game;
  const sides = ctx.sides;
  const point: TimelinePoint = {
    minute: world.time / 60,
    sides: Array.from({ length: sides.count }, (_, f) => ({
      units: 0,
      buildings: 0,
      producers: 0,
      outposts: outpostsHeldBy(ctx, f),
      attacking: !sides.eliminated[f] && ctx.offensive.attacking(f, world.time),
      out: sides.eliminated[f],
      kills: stats.sides[f].kills,
      lost: stats.sides[f].lost,
    })),
  };
  for (const e of world.query(Unit, Faction)) {
    const f = world.req(e, Faction).id;
    if (f >= 0) point.sides[f].units++;
  }
  for (const e of world.query(Building, Faction)) {
    const f = world.req(e, Faction).id;
    if (f < 0) continue;
    point.sides[f].buildings++;
    if (world.has(e, Producer)) point.sides[f].producers++;
  }
  return point;
}

/** Each side's army strength right now (see fightingStrength). */
function armyStrength(game: Game): number[] {
  const { world } = game;
  const out = game.settings.factions.map(() => 0);
  for (const e of world.query(Unit, Faction)) {
    const f = world.req(e, Faction).id;
    if (f >= 0 && f < out.length) out[f] += fightingStrength(world, e);
  }
  return out;
}

/** Each side's team's share of all the armies' strength (an even share if nobody has an army). */
function teamShares(strength: number[], teams: number[]): number[] {
  const total = strength.reduce((a, b) => a + b, 0);
  const count = new Set(teams).size;
  return teams.map((t) => (total > 0 ? strength.reduce((a, x, g) => a + (teams[g] === t ? x : 0), 0) / total : 1 / count));
}

export interface RunOptions {
  /** Record a timeline (see TimelinePoint). */
  timeline?: boolean;
  /** Time each system (see World.profile). */
  profile?: boolean;
}

/** Play one battle of a scenario to the end (or its time limit). `map` labels the map type the overrides set up. */
export function runBattle(scenario: Scenario, battle: number, now: () => number = () => performance.now(), overrides = '', map = '', options: RunOptions = {}): BattleResult {
  const settings = scenarioSettings(scenario, battle, overrides);
  const game = new Game(hashSeed(settings.seed), { settings });
  if (options.profile) game.world.profile = new Map();
  const timeline: TimelinePoint[] = [];
  if (options.timeline) timeline.push(timelinePoint(game));
  let worstMs = 0;
  let worstAt = 0;
  const { sides } = game.ctx;
  const teamOrder = [...new Set(settings.factions.map((f) => f.team))];
  const attacks = settings.factions.map(() => 0);
  const attacking = settings.factions.map(() => false);
  const teams = settings.factions.map((f) => f.team);
  const shareSum = settings.factions.map(() => 0);
  let samples = 0;
  const limit = (scenario.minutes ?? TIME_LIMIT) * 60;
  const dt = 1 / SIM_HZ;
  const start = now();
  let ticks = 0;
  while (game.outcome === null && game.world.time < limit) {
    const t0 = now();
    game.step(dt);
    const took = now() - t0;
    if (took > worstMs) {
      worstMs = took;
      worstAt = game.world.time / 60;
    }
    ticks++;
    if (ticks % (SIM_HZ * TIMELINE_EVERY) === 0) {
      if (options.timeline) timeline.push(timelinePoint(game));
      teamShares(armyStrength(game), teams).forEach((x, f) => (shareSum[f] += x));
      samples++;
    }
    if (ticks % SIM_HZ === 0) {
      game.stats.sample(game.world, 1);
      for (let f = 0; f < sides.count; f++) {
        const now = !sides.eliminated[f] && game.ctx.offensive.attacking(f, game.world.time);
        if (now && !attacking[f]) attacks[f]++;
        attacking[f] = now;
      }
    }
  }
  const outcome = game.outcome;
  if (options.timeline && ticks % (SIM_HZ * TIMELINE_EVERY) !== 0) timeline.push(timelinePoint(game));
  const names = factionDefs(settings).map((d) => d.name);
  const endStrength = armyStrength(game);
  const endShares = teamShares(endStrength, teams);
  const winnerSide = outcome && outcome.team !== null ? teams.indexOf(outcome.team) : -1;
  if (samples === 0) {
    endShares.forEach((x, f) => (shareSum[f] = x));
    samples = 1;
  }
  return {
    scenario: scenario.id,
    seed: settings.seed,
    map,
    set: overrides,
    minutes: (outcome ? outcome.time : game.world.time) / 60,
    decided: outcome !== null && outcome.team !== null,
    winner: outcome && outcome.team !== null ? teamOrder.indexOf(outcome.team) + 1 : null,
    margin: winnerSide >= 0 ? endShares[winnerSide] : null,
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
      strength: endStrength[i],
      share: shareSum[i] / samples,
      units: game.stats.sides[i].types,
    })),
    msPerTick: (now() - start) / Math.max(1, ticks),
    worstMs,
    worstAt,
    ...(options.timeline ? { timeline } : {}),
    ...(game.world.profile ? { profile: Object.fromEntries(game.world.profile), ticks } : {}),
    link: settingsToParams(settings).toString(),
  };
}

/**
 * The scenario and battle number a seed names, e.g. "1v1-small-3" is battle 3
 * of the 1v1-small scenario, or null if no scenario matches.
 */
export function parseSeed(seed: string): { scenario: Scenario; battle: number } | null {
  const m = seed.trim().match(/^(.+)-(\d+)$/);
  const scenario = m && SCENARIOS.find((s) => s.id === m[1]);
  return scenario ? { scenario, battle: Number(m![2]) } : null;
}

/**
 * Battle numbers from a list like "3,7-9,12", for `--seeds`. Throws on
 * anything else.
 */
export function parseBattleNumbers(list: string): number[] {
  const out = new Set<number>();
  for (const part of list.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`Can't read "${part}" in --seeds: use battle numbers and ranges, e.g. 3,7-9`);
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * Where the sim's time goes, all battles together: milliseconds per tick
 * and share of the total for each system, slowest first.
 */
export function formatProfile(results: BattleResult[]): string {
  const totals = new Map<string, number>();
  let ticks = 0;
  for (const r of results) {
    if (!r.profile || !r.ticks) continue;
    ticks += r.ticks;
    for (const [k, v] of Object.entries(r.profile)) totals.set(k, (totals.get(k) ?? 0) + v);
  }
  if (ticks === 0) return 'No profile recorded.';
  const all = [...totals.values()].reduce((a, b) => a + b, 0);
  const rows = [...totals].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, (v / ticks).toFixed(3), `${Math.round((v / all) * 100)}%`]);
  rows.push(['total', (all / ticks).toFixed(3), '100%']);
  const worst = results.filter((r) => r.worstMs !== undefined).sort((a, b) => b.worstMs! - a.worstMs!)[0];
  return (
    formatGrid(['System', 'ms/tick', 'Share'], rows) +
    `\n${ticks.toLocaleString('en')} ticks.` +
    (worst ? ` Slowest tick: ${worst.worstMs!.toFixed(1)} ms, ${worst.seed} at ${worst.worstAt!.toFixed(1)} min.` : '')
  );
}

/** A battle's timeline as a table: per side, units / buildings (production) / outposts, and what it was doing. */
export function formatTimeline(r: BattleResult): string {
  if (!r.timeline) return 'No timeline recorded.';
  const head = ['Min', ...r.sides.map((s) => `${s.name.split(' ')[0]} (${s.doctrine})`)];
  const rows = r.timeline.map((p) => [
    p.minute.toFixed(1),
    ...p.sides.map((s) => (s.out ? 'out' : `${s.units}u ${s.buildings}b(${s.producers}) ${s.outposts}o ${s.kills}k${s.attacking ? ' ATTACK' : ''}`)),
  ]);
  return formatGrid(head, rows) + '\nu units, b buildings (production in brackets), o outposts held, k kills so far; ATTACK while its army is attacking.';
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
  /** Won battles' average margin (see BattleResult.margin), or null if none recorded one. */
  margin: number | null;
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
    margin: margins(results),
    shortestSeed: byLength[0]?.seed ?? '',
    longestSeed: byLength[byLength.length - 1]?.seed ?? '',
  };
}

function margins(results: BattleResult[]): number | null {
  const m = results.map((r) => r.margin).filter((x): x is number => typeof x === 'number');
  return m.length ? mean(m) : null;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const min = (m: number) => `${m.toFixed(1)}m`;

/** A plain-text table of summaries, one row per scenario. */
export function formatTable(summaries: ScenarioSummary[], eternal: Set<string>): string {
  const head = ['Scenario', 'Battles', 'Median', 'Mean', 'Range', 'Wins by team', 'Margin', 'Kills', 'Razed', 'Outposts', 'Attacks', 'ms/tick'];
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
      s.margin === null || s.margin === undefined ? '-' : pct(s.margin),
      s.kills.toFixed(0),
      s.razed.toFixed(0),
      s.captured.toFixed(1),
      s.attacks.toFixed(1),
      s.msPerTick.toFixed(2),
    ];
  });
  return formatGrid(head, rows);
}

/** A plain-text table: a header row, a rule, then the rows, columns padded to fit. */
function formatGrid(head: string[], rows: string[][]): string {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i])).join('  ').trimEnd();
  return [line(head), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/**
 * Arithmetic in the finite field with q = p^m elements (p prime): elements
 * are 0..q-1, read as polynomials over Z_p by their base-p digits, and
 * multiplied modulo an irreducible polynomial of degree m. For a prime q
 * that's just arithmetic mod q.
 */
interface Field {
  q: number;
  add(a: number, b: number): number;
  mul(a: number, b: number): number;
}

/** The finite field with `q` elements, or null if `q` isn't a prime power. */
export function finiteField(q: number): Field | null {
  if (q < 2) return null;
  // The smallest factor of q, which is prime; q has to be a power of it.
  let p = 2;
  while (q % p !== 0) p++;
  let m = 0;
  for (let n = q; n > 1; n /= p) {
    if (n % p !== 0) return null;
    m++;
  }
  const digits = (n: number) => Array.from({ length: m }, (_, i) => Math.floor(n / p ** i) % p);
  const number = (d: number[]) => d.reduce((s, x, i) => s + x * p ** i, 0);
  const add = (a: number, b: number) => number(digits(a).map((x, i) => (x + digits(b)[i]) % p));
  // Multiply as polynomials, then reduce with the monic irreducible x^m = -(lower terms).
  const mulBy = (low: number[]) => (a: number, b: number) => {
    const prod = new Array<number>(2 * m - 1).fill(0);
    const da = digits(a);
    const db = digits(b);
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) prod[i + j] = (prod[i + j] + da[i] * db[j]) % p;
    for (let k = prod.length - 1; k >= m; k--) {
      const c = prod[k];
      if (c === 0) continue;
      prod[k] = 0;
      for (let i = 0; i < m; i++) prod[k - m + i] = (((prod[k - m + i] - c * low[i]) % p) + p) % p;
    }
    return number(prod.slice(0, m));
  };
  if (m === 1) return { q, add: (a, b) => (a + b) % p, mul: (a, b) => (a * b) % p };
  // The first monic polynomial of degree m (lower terms `low`) under which every non-zero element has an inverse.
  for (let n = 0; n < q; n++) {
    const low = digits(n);
    const mul = mulBy(low);
    let field = true;
    for (let a = 1; a < q && field; a++) {
      let inverse = false;
      for (let b = 1; b < q; b++) if (mul(a, b) === 1) inverse = true;
      field = inverse;
    }
    if (field) return { q, add, mul };
  }
  return null;
}

/**
 * An orthogonal array of strength 2: rows of `factors` values, each from 0 to
 * `levels` - 1 (`levels` must be a prime power: 2, 3, 4, 5, 7, 8, 9...), where
 * every pair of columns shows every pair of values equally often. Used to
 * give sides doctrines so every pairing of doctrines between any two sides
 * comes up equally, in far fewer battles than every combination: 16 rows for
 * up to 5 sides with 4 doctrines, 64 for up to 21.
 *
 * Built the textbook way: the rows are all vectors of length k over the
 * field with `levels` elements, the columns are distinct directions (vectors
 * whose last non-zero entry is 1), and an entry is their dot product.
 */
export function orthogonalArray(levels: number, factors: number): number[][] {
  const p = levels;
  if (p < 2) throw new Error('orthogonalArray needs at least 2 levels');
  const field = finiteField(p);
  if (!field) throw new Error(`orthogonalArray needs a prime power number of levels, not ${p}`);
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
    return columns.map((c) => c.reduce((s, x, i) => field.add(s, field.mul(x, row[i])), 0));
  });
}

/** Query strings (see scenarioSettings' overrides) giving each side a doctrine, one per row of an orthogonal array. */
export function doctrinePlans(sides: number): string[] {
  return orthogonalArray(DOCTRINE_IDS.length, sides).map((row) => row.map((d, i) => `doc${i + 1}=${DOCTRINE_IDS[d]}`).join('&'));
}

/** One battle's place in a run: its battle number, the settings it adds to the scenario, and its map type's name. */
export interface BattlePlan {
  battle: number;
  set: string;
  map: string;
}

/**
 * The battles of a run of `count` battles (rounded up to whole passes over
 * the orthogonal array when doctrines are on), with `set` added to every one.
 *
 * Map types (see mapType) work as one more factor:
 * - `cross` plays every battle on every map type, so each type gets the full
 *   picture (and the run is that many times longer).
 * - Otherwise each battle gets one map type. With doctrines, it's another
 *   column of the orthogonal array, so every doctrine meets every map type
 *   equally often (exactly, when the number of map types divides the number of
 *   doctrines) at no extra cost; without, the battles take turns.
 */
export function battlePlans(sides: number, count: number, options: { set?: string; doctrines?: boolean; maps?: string[]; cross?: boolean } = {}): BattlePlan[] {
  const maps = (options.maps ?? []).map(mapType);
  // The first value of a setting wins (see applyParams), so the array's doctrines and the map type come before `set`.
  const join = (...parts: string[]) => parts.filter(Boolean).join('&');
  const base = options.set ?? '';
  // What each battle number plays before map types: doctrines from the array, or nothing.
  let rows: { set: string; level: number }[];
  if (options.doctrines) {
    const array = orthogonalArray(DOCTRINE_IDS.length, sides + 1);
    const passes = Math.max(1, Math.round(count / array.length));
    rows = Array.from({ length: passes * array.length }, (_, i) => {
      const row = array[i % array.length];
      return { set: row.slice(0, sides).map((d, f) => `doc${f + 1}=${DOCTRINE_IDS[d]}`).join('&'), level: row[sides] };
    });
  } else {
    rows = Array.from({ length: count }, (_, i) => ({ set: '', level: i }));
  }
  if (maps.length === 0) return rows.map((r, i) => ({ battle: i + 1, set: join(r.set, base), map: '' }));
  if (options.cross) return maps.flatMap((m) => rows.map((r, i) => ({ battle: i + 1, set: join(r.set, m.set, base), map: m.name })));
  return rows.map((r, i) => {
    const m = maps[r.level % maps.length];
    return { battle: i + 1, set: join(r.set, m.set, base), map: m.name };
  });
}

export interface DoctrineSummary {
  doctrine: DoctrineId;
  /** Sides it played in decided battles, how many of those were on the winning team, and the rate. */
  played: number;
  won: number;
  rate: number;
  /**
   * The rate's margin of error: half the width of a 95% interval, so the
   * true rate is likely within rate ± margin. Around ±12 points for 64 games.
   */
  margin: number;
  /**
   * Wins against what a coin toss would give: each side's fair share is one
   * over the number of teams in its battle, so 1 is par in any team setup
   * (in 1v1 it's just the rate times 2) and above 1 is doing better than par.
   */
  score: number;
  /** The score's margin of error, the same way as `margin`. */
  scoreMargin: number;
  /**
   * Strength share against par: its team's share of the armies' strength
   * over each battle (SideResult.share) times the number of teams, averaged
   * over every battle it played, won, lost or undecided. 1 is even. A
   * steadier measure than wins, since a close loss and a rout differ. NaN
   * if the runs didn't record it.
   */
  edge: number;
  /** The edge's 95% margin of error. */
  edgeMargin: number;
}

/** Half the width of a 95% interval for a rate measured as `won` out of `n`. Padded by a win and a loss, so 0 of 4 doesn't claim to be certain. */
export function margin(won: number, n: number): number {
  if (n === 0) return 1;
  const p = (won + 1) / (n + 2);
  return 1.96 * Math.sqrt((p * (1 - p)) / n);
}

/** Wins per doctrine across decided battles (a doctrine on several sides of one battle counts once per side). */
export function summarizeDoctrines(results: BattleResult[]): DoctrineSummary[] {
  return DOCTRINE_IDS.map((doctrine) => {
    let played = 0;
    let won = 0;
    let par = 0;
    for (const r of results) {
      if (!r.decided) continue;
      const teams = new Set(r.sides.map((s) => s.team)).size;
      for (const s of r.sides) {
        if (s.doctrine !== doctrine) continue;
        played++;
        par += 1 / teams;
        if (s.team === r.winner) won++;
      }
    }
    const rate = played ? won / played : 0;
    const share = played ? par / played : 1;
    const m = margin(won, played);
    const edges: number[] = [];
    for (const r of results) {
      const teams = new Set(r.sides.map((x) => x.team)).size;
      for (const x of r.sides) if (x.doctrine === doctrine && typeof x.share === 'number') edges.push(x.share * teams);
    }
    const edge = edges.length ? mean(edges) : NaN;
    const sd = edges.length > 1 ? Math.sqrt(edges.reduce((a, x) => a + (x - edge) ** 2, 0) / (edges.length - 1)) : NaN;
    return { doctrine, played, won, rate, margin: m, score: par ? won / par : 0, scoreMargin: m / share, edge, edgeMargin: (1.96 * sd) / Math.sqrt(Math.max(1, edges.length)) };
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

const pct = (x: number) => `${Math.round(x * 100)}%`;
const edgeText = (d: DoctrineSummary) => (Number.isFinite(d.edge) ? `${d.edge.toFixed(2)}x ±${Number.isFinite(d.edgeMargin) ? d.edgeMargin.toFixed(2) : '?'}` : '-');
const pm = (x: number) => `±${Math.round(x * 100)}`;

/** Plain-text tables of doctrine results: overall, per map type when there are several, and head to head. */
export function formatDoctrines(results: BattleResult[]): string {
  const doctrines = summarizeDoctrines(results).filter((d) => d.played > 0);
  const lines = [
    formatGrid(
      ['Doctrine', 'Played', 'Won', 'Win rate', 'vs par', 'Strength'],
      doctrines.map((d) => [d.doctrine, String(d.played), String(d.won), `${pct(d.rate)} ${pm(d.margin)}`, `${d.score.toFixed(2)}x ±${d.scoreMargin.toFixed(2)}`, edgeText(d)]),
    ),
    '',
    'Win rates are ± a 95% margin of error. "vs par" is wins over a fair share (1 over the teams in the battle): 1.00x is even.',
    '"Strength" is its team\'s share of all the armies\' strength through each battle, against an even share (1.00x),',
    'over every battle it played: a score beyond win or loss, so a close loss counts for more than a rout.',
  ];
  const maps = mapsIn(results);
  if (maps.length > 1) {
    const by = maps.map((m) => summarizeDoctrines(results.filter((r) => r.map === m)));
    lines.push(
      '',
      'Win rate by map type:',
      formatGrid(
        ['Doctrine', ...maps, 'all'],
        doctrines.map((d) => {
          const i = DOCTRINE_IDS.indexOf(d.doctrine);
          return [d.doctrine, ...by.map((b) => (b[i].played ? `${pct(b[i].rate)} ${pm(b[i].margin)}` : '-')), pct(d.rate)];
        }),
      ),
    );
  }
  if (doctrines.length > 1 && results.some((r) => r.sides.length === 2)) {
    const grid = headToHead(results);
    lines.push('', 'Two-sided battles, wins of each row against each column:', pad('', 10) + DOCTRINE_IDS.map((d) => pad(d, 10)).join(''));
    for (const a of DOCTRINE_IDS) lines.push(pad(a, 10) + DOCTRINE_IDS.map((b) => pad(a === b ? '-' : String(grid[a][b]), 10)).join(''));
  }
  return lines.join('\n');
}

/** The map types in a set of results, in the order they first appear. */
function mapsIn(results: BattleResult[]): string[] {
  return [...new Set(results.map((r) => r.map ?? ''))].filter((m) => m !== '');
}

export interface UnitReportRow {
  doctrine: DoctrineId;
  /** Unit (or building, e.g. tower) type. */
  unit: string;
  built: number;
  lost: number;
  kills: number;
  razed: number;
  /** Damage it did to enemies and took from them, and what it did by victim category (see TypeStats). */
  dealt: number;
  taken: number;
  dealtTo: Record<string, number>;
  /** Seconds on the field (all its units added up), with a target, and firing (see TypeStats). */
  alive: number;
  engaged: number;
  firing: number;
  /** Enemy types it killed and was killed by, most first, with counts. */
  victims: [string, number][];
  killers: [string, number][];
}

/**
 * Every side's unit tallies added up per doctrine and unit type, across all
 * the battles (decided or not): what each doctrine's units did, and what
 * they died to. Rows run by doctrine, then most damage first.
 */
export function unitReport(results: BattleResult[]): UnitReportRow[] {
  const rows = new Map<string, UnitReportRow & { v: Record<string, number>; k: Record<string, number> }>();
  for (const r of results) {
    for (const side of r.sides) {
      for (const [unit, t] of Object.entries(side.units ?? {})) {
        const key = `${side.doctrine}:${unit}`;
        let row = rows.get(key);
        if (!row) {
          row = { doctrine: side.doctrine, unit, built: 0, lost: 0, kills: 0, razed: 0, dealt: 0, taken: 0, dealtTo: {}, alive: 0, engaged: 0, firing: 0, victims: [], killers: [], v: {}, k: {} };
          rows.set(key, row);
        }
        row.built += t.built;
        row.lost += t.lost;
        row.kills += t.kills;
        row.razed += t.razed;
        // Results saved before damage and time were tracked don't have them.
        row.dealt += t.dealt ?? 0;
        row.taken += t.taken ?? 0;
        row.alive += t.alive ?? 0;
        row.engaged += t.engaged ?? 0;
        row.firing += t.firing ?? 0;
        for (const [c, n] of Object.entries(t.dealtTo ?? {})) row.dealtTo[c] = (row.dealtTo[c] ?? 0) + n;
        for (const [id, n] of Object.entries(t.victims)) row.v[id] = (row.v[id] ?? 0) + n;
        for (const [id, n] of Object.entries(t.killers)) row.k[id] = (row.k[id] ?? 0) + n;
      }
    }
  }
  const ranked = (counts: Record<string, number>) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return [...rows.values()]
    .map(({ v, k, ...row }) => ({ ...row, victims: ranked(v), killers: ranked(k) }))
    .sort((a, b) => DOCTRINE_IDS.indexOf(a.doctrine) - DOCTRINE_IDS.indexOf(b.doctrine) || b.dealt - a.dealt || b.kills - a.kills || a.unit.localeCompare(b.unit));
}

/** The top few of a ranked count list, as "trooper 150, tank 40". */
function top(list: [string, number][], n = 3): string {
  return list.slice(0, n).map(([id, c]) => `${id} ${c}`).join(', ');
}

/** Short names for victim categories in the damage split. */
const CATEGORY_SHORT: Record<string, string> = { infantry: 'inf', vehicle: 'veh', air: 'air', super: 'sup', building: 'bld' };

/** Where a type's damage went, biggest share first: "veh 60% inf 30%". Shares under 10% are left out. */
export function damageSplit(dealtTo: Record<string, number>): string {
  const total = Object.values(dealtTo).reduce((a, b) => a + b, 0);
  if (total <= 0) return '-';
  return Object.entries(dealtTo)
    .filter(([, n]) => n / total >= 0.1)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${CATEGORY_SHORT[c] ?? c} ${pct(n / total)}`)
    .join(' ');
}

/** Per built unit, or '-' for types that weren't built (buildings). */
const each = (n: number, built: number, digits = 0) => (built ? (n / built).toFixed(digits) : '-');
/** Per minute of cap slot held (see TypeStats.alive): what a slot spent on this type buys. */
const perSlotMinute = (n: number, alive: number, digits = 0) => (alive > 0 ? ((n * 60) / alive).toFixed(digits) : '-');

/**
 * Plain-text unit report, one table per doctrine (see unitReport):
 * - Dmg and Taken are per unit built: what a unit does before it dies, and what it soaks.
 * - Dmg/slot-min and Kills/slot-min are per minute a cap slot spends on the type, so a
 *   cheap unit that dies fast and a tough one that idles both show what they're worth.
 * - Firing is the share of its field time spent shooting; Damage to splits its damage
 *   by what it hit.
 */
export function formatUnits(results: BattleResult[]): string {
  const rows = unitReport(results);
  const out: string[] = [];
  for (const doctrine of DOCTRINE_IDS) {
    // Buildings that only ever took fire (everything but towers) are left out here; the CSV has them.
    const mine = rows.filter((r) => r.doctrine === doctrine && (r.built > 0 || r.kills > 0 || r.razed > 0 || r.dealt > 0));
    if (mine.length === 0) continue;
    out.push(
      `${doctrine}:`,
      formatGrid(
        ['Unit', 'Built', 'Lost', 'Kills', 'Razed', 'Dmg', 'Taken', 'Dmg/slot-min', 'Kills/slot-min', 'Firing', 'Damage to', 'Killed most', 'Killed most by'],
        mine.map((r) => [
          r.unit,
          r.built ? String(r.built) : '-',
          String(r.lost),
          String(r.kills),
          String(r.razed),
          each(r.dealt, r.built),
          each(r.taken, r.built),
          perSlotMinute(r.dealt, r.alive),
          perSlotMinute(r.kills, r.alive, 2),
          r.alive > 0 ? pct(r.firing / r.alive) : '-',
          damageSplit(r.dealtTo),
          top(r.victims),
          top(r.killers),
        ]),
      ),
      '',
    );
  }
  out.push('Dmg and Taken are per unit built. Slot-min is a minute of one cap slot spent on that unit. Firing is the share of field time spent shooting.');
  return out.join('\n').trimEnd();
}

/** Unit report rows as CSV, for a spreadsheet. */
export function unitsCsv(results: BattleResult[]): string {
  const quote = (v: string) => (/[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cats = ['infantry', 'vehicle', 'air', 'super', 'building'];
  const lines = [`doctrine,unit,built,lost,kills,razed,dealt,taken,${cats.map((c) => `dealt_${c}`).join(',')},alive_s,engaged_s,firing_s,killed_most,killed_most_by`];
  for (const r of unitReport(results)) {
    lines.push(
      [
        r.doctrine,
        r.unit,
        r.built,
        r.lost,
        r.kills,
        r.razed,
        Math.round(r.dealt),
        Math.round(r.taken),
        ...cats.map((c) => Math.round(r.dealtTo[c] ?? 0)),
        Math.round(r.alive),
        Math.round(r.engaged),
        Math.round(r.firing),
        quote(top(r.victims, 5)),
        quote(top(r.killers, 5)),
      ].join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/** A saved run (sims-results/*.json), as compareRuns reads it. */
export interface SavedRun {
  set?: string;
  battles: BattleResult[];
}

/**
 * A plain-text comparison of two saved runs, `before` and `after`: battle
 * lengths per scenario, doctrine win rates with whether each change is bigger
 * than the noise, how many of the same battles (same seed, map type and
 * doctrines) changed winner, and the units whose damage per cap slot moved most.
 */
export function compareRuns(before: SavedRun, after: SavedRun): string {
  const out: string[] = [];
  const scenarios = [...new Set([...before.battles, ...after.battles].map((r) => r.scenario))];
  out.push(
    'Battle length (median minutes):',
    formatGrid(
      ['Scenario', 'Before', 'After', 'Battles'],
      scenarios.map((id) => {
        const a = before.battles.filter((r) => r.scenario === id);
        const b = after.battles.filter((r) => r.scenario === id);
        return [id, a.length ? min(median(a.map((r) => r.minutes))) : '-', b.length ? min(median(b.map((r) => r.minutes))) : '-', `${a.length} → ${b.length}`];
      }),
    ),
  );

  const da = summarizeDoctrines(before.battles);
  const db = summarizeDoctrines(after.battles);
  const rows = DOCTRINE_IDS.map((_, i) => [da[i], db[i]] as const).filter(([a, b]) => a.played > 0 || b.played > 0);
  if (rows.length > 0) {
    out.push(
      '',
      'Doctrine win rates:',
      formatGrid(
        ['Doctrine', 'Before', 'After', 'Change', '', 'Strength before', 'After', ''],
        rows.map(([a, b]) => {
          const change = b.rate - a.rate;
          // Bigger than the two margins together: probably a real change, not noise.
          const real = Math.abs(change) > Math.hypot(a.margin, b.margin);
          const edgeReal = Number.isFinite(a.edge) && Number.isFinite(b.edge) && Math.abs(b.edge - a.edge) > Math.hypot(a.edgeMargin, b.edgeMargin);
          return [
            a.doctrine,
            a.played ? `${pct(a.rate)} ${pm(a.margin)}` : '-',
            b.played ? `${pct(b.rate)} ${pm(b.margin)}` : '-',
            `${change >= 0 ? '+' : ''}${Math.round(change * 100)}`,
            real ? 'beyond noise' : '',
            edgeText(a),
            edgeText(b),
            edgeReal ? 'beyond noise' : '',
          ];
        }),
      ),
    );
  }

  // The same battle in both runs: same scenario, seed, map type and doctrines (whatever else `--set` changed).
  const key = (r: BattleResult) => `${r.scenario}|${r.seed}|${r.map ?? ''}|${r.sides.map((s) => s.doctrine).join(',')}`;
  const earlier = new Map(before.battles.map((r) => [key(r), r]));
  let same = 0;
  let flipped = 0;
  for (const r of after.battles) {
    const e = earlier.get(key(r));
    if (!e) continue;
    same++;
    if (e.winner !== r.winner) flipped++;
  }
  out.push('', same ? `${same} battles were played in both runs; ${flipped} of them (${pct(flipped / same)}) changed winner.` : 'No battle was played in both runs (different scenarios, seeds, map types or doctrines).');

  const ua = new Map(unitReport(before.battles).map((r) => [`${r.doctrine}:${r.unit}`, r]));
  const moved = unitReport(after.battles)
    .map((b) => ({ b, a: ua.get(`${b.doctrine}:${b.unit}`) }))
    .filter((x): x is { a: UnitReportRow; b: UnitReportRow } => !!x.a && x.a.alive > 0 && x.b.alive > 0 && x.a.dealt > 0)
    .map(({ a, b }) => ({ a, b, ratio: b.dealt / b.alive / (a.dealt / a.alive) }))
    .filter((x) => Math.abs(Math.log(x.ratio)) > Math.log(1.2))
    .sort((x, y) => Math.abs(Math.log(y.ratio)) - Math.abs(Math.log(x.ratio)))
    .slice(0, 20);
  if (moved.length > 0) {
    out.push(
      '',
      'Units whose damage per cap-slot minute moved more than 20%:',
      formatGrid(
        ['Doctrine', 'Unit', 'Dmg/slot-min', 'Kills/built', 'Built'],
        moved.map(({ a, b, ratio }) => [
          a.doctrine,
          a.unit,
          `${perSlotMinute(a.dealt, a.alive)} → ${perSlotMinute(b.dealt, b.alive)} (${ratio >= 1 ? '+' : ''}${Math.round((ratio - 1) * 100)}%)`,
          `${each(a.kills, a.built, 2)} → ${each(b.kills, b.built, 2)}`,
          `${a.built} → ${b.built}`,
        ]),
      ),
    );
  }
  if ((before.set ?? '') !== (after.set ?? '')) out.push('', `Settings changed for every battle: before "${before.set ?? ''}", after "${after.set ?? ''}".`);
  return out.join('\n');
}

/** One value of a parameter sweep: its label and the settings it adds, in the URL's format. */
export interface SweepVariant {
  label: string;
  set: string;
}

/**
 * The variants of `--sweep`: `key=v1,v2,...`, where key is a setting as
 * written in a battle's link (e.g. `tforce=0,0.35,0.7`), or a unit's stat
 * multiplier written unit.stat (e.g. `skimmer.hp=0.9,1,1.1`; stats are hp,
 * damage, speed and range).
 */
export function sweepVariants(spec: string): SweepVariant[] {
  const m = spec.trim().match(/^([\w.]+)=(.+)$/);
  if (!m) throw new Error(`--sweep "${spec}": write it as key=v1,v2,..., e.g. "tforce=0,0.35,0.7" or "skimmer.hp=0.9,1,1.1"`);
  const [, key, list] = m;
  const values = list.split(',').map((v) => v.trim()).filter(Boolean);
  if (values.length < 2) throw new Error(`--sweep "${spec}" needs at least two values`);
  const dot = key.indexOf('.');
  if (dot < 0) return values.map((v) => ({ label: `${key}=${v}`, set: `${key}=${v}` }));
  const unit = key.slice(0, dot);
  const stat = key.slice(dot + 1) as (typeof UNIT_STATS)[number];
  if (!(unit in UNIT_DEFS)) throw new Error(`--sweep: no unit "${unit}" (units: ${Object.keys(UNIT_DEFS).join(', ')})`);
  const at = UNIT_STATS.indexOf(stat);
  if (at < 0) throw new Error(`--sweep: no stat "${stat}" (stats: ${UNIT_STATS.join(', ')})`);
  return values.map((v) => ({ label: `${key}=${v}`, set: `${unit}=${UNIT_STATS.map((_, i) => (i === at ? v : '1')).join(',')}` }));
}

/** Plain-text comparison of a sweep's variants: lengths, wins, margins, and doctrine win rates and strength. */
export function formatSweep(results: BattleResult[], variants: SweepVariant[]): string {
  const by = variants.map((v) => results.filter((r) => r.variant === v.label));
  const lines = [
    formatGrid(
      ['Variant', 'Battles', 'Median', 'Mean', 'Undecided', 'Wins by team', 'Margin', 'Kills'],
      variants.map((v, i) => {
        const rs = by[i];
        const wins: Record<number, number> = {};
        for (const r of rs) if (r.winner !== null) wins[r.winner] = (wins[r.winner] ?? 0) + 1;
        const m = margins(rs);
        return [
          v.label,
          String(rs.length),
          min(median(rs.map((r) => r.minutes))),
          min(mean(rs.map((r) => r.minutes))),
          String(rs.filter((r) => !r.decided).length),
          Object.entries(wins).map(([t, n]) => `T${t}:${n}`).join(' '),
          m === null ? '-' : pct(m),
          mean(rs.map((r) => r.sides.reduce((a, x) => a + x.kills, 0))).toFixed(0),
        ];
      }),
    ),
  ];
  const doctrines = new Set(results.flatMap((r) => r.sides.map((x) => x.doctrine)));
  if (doctrines.size > 1) {
    const sums = by.map((rs) => summarizeDoctrines(rs));
    const ids = DOCTRINE_IDS.filter((d) => doctrines.has(d));
    lines.push(
      '',
      'Doctrine win rates (strength against par below each):',
      formatGrid(
        ['Doctrine', ...variants.map((v) => v.label)],
        ids.flatMap((d) => {
          const i = DOCTRINE_IDS.indexOf(d);
          return [
            [d, ...sums.map((s) => (s[i].played ? `${pct(s[i].rate)} ${pm(s[i].margin)}` : '-'))],
            ['', ...sums.map((s) => edgeText(s[i]))],
          ];
        }),
      ),
    );
  }
  lines.push('', 'Every variant plays the same battles (seeds, doctrines and map types), so differences come from the setting, give or take the noise.');
  return lines.join('\n');
}

/**
 * Matchups apart from maps (`--latin`): for two-sided scenarios, every
 * pairing of two different doctrines meets every map type once per pass,
 * so a head-to-head result can't be down to the maps it happened to land
 * on. The sides take turns at which doctrine plays side 1, balanced over
 * the map types (a Latin square of pairings by map type). Mirror matches
 * are left out: they say nothing about doctrines. 28 pairings × the map
 * types per pass, e.g. 112 battles on 4 map types.
 */
export function latinPlans(count: number, maps: string[], set = ''): BattlePlan[] {
  const types = (maps.length ? maps : ['medium']).map(mapType);
  const join = (...parts: string[]) => parts.filter(Boolean).join('&');
  const n = DOCTRINE_IDS.length;
  const pass: { a: number; b: number; m: number }[] = [];
  for (let m = 0; m < types.length; m++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Alternate which doctrine is side 1, so each plays each side equally on each map type.
        const swap = (i + j + m) % 2 === 1;
        pass.push({ a: swap ? j : i, b: swap ? i : j, m });
      }
    }
  }
  const passes = Math.max(1, Math.round(count / pass.length));
  const plans: BattlePlan[] = [];
  for (let p = 0; p < passes; p++) {
    for (const { a, b, m } of pass) {
      plans.push({ battle: plans.length + 1, set: join(`doc1=${DOCTRINE_IDS[a]}&doc2=${DOCTRINE_IDS[b]}`, types[m].set, set), map: types[m].name });
    }
  }
  return plans;
}

/** For a --latin run: each pairing's results, overall and on each map type, with the pairings whose winner depends on the map. */
export function formatLatin(results: BattleResult[]): string {
  const maps = mapsIn(results);
  const two = results.filter((r) => r.sides.length === 2);
  const rows: string[][] = [];
  const mapDependent: string[] = [];
  for (let i = 0; i < DOCTRINE_IDS.length; i++) {
    for (let j = i + 1; j < DOCTRINE_IDS.length; j++) {
      const a = DOCTRINE_IDS[i];
      const b = DOCTRINE_IDS[j];
      const games = two.filter((r) => r.sides.some((x) => x.doctrine === a) && r.sides.some((x) => x.doctrine === b));
      if (games.length === 0) continue;
      const winnerOf = (r: BattleResult) => (r.winner === null ? null : r.sides.find((x) => x.team === r.winner)!.doctrine);
      const aw = games.filter((r) => winnerOf(r) === a).length;
      const bw = games.filter((r) => winnerOf(r) === b).length;
      const cells = maps.map((m) => {
        const on = games.filter((r) => r.map === m);
        const x = on.filter((r) => winnerOf(r) === a).length;
        const y = on.filter((r) => winnerOf(r) === b).length;
        return on.length === 0 ? '-' : `${x}-${y}`;
      });
      // Each wins somewhere: the map type decides this matchup.
      const leads = maps.map((m) => {
        const on = games.filter((r) => r.map === m);
        return Math.sign(on.filter((r) => winnerOf(r) === a).length - on.filter((r) => winnerOf(r) === b).length);
      });
      if (leads.includes(1) && leads.includes(-1)) mapDependent.push(`${a} v ${b}`);
      rows.push([`${a} v ${b}`, `${aw}-${bw}`, ...cells]);
    }
  }
  return [
    'Each pairing on every map type (wins of the first named, then the second):',
    formatGrid(['Pairing', 'All', ...maps], rows),
    '',
    mapDependent.length ? `Won by each side on some map type (the map decides): ${mapDependent.join(', ')}.` : 'No pairing changed hands between map types.',
  ].join('\n');
}
