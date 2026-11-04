// Plays the balance scenarios in src/sim/simulate.ts headlessly, in parallel,
// and prints a stats table. Run with `npm run sims`; `npm run sims -- --help`
// lists the options. Results (every battle, with a replay link) are saved
// under sims-results/.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async () => (await runnerImport(join(root, 'src/sim/simulate.ts'))).module;
const loadDuels = async () => (await runnerImport(join(root, 'src/sim/duel.ts'))).module;

const HELP = `Usage: npm run sims -- [options]

Plays battles headlessly at full speed and prints stats per scenario.

  --quick            fewer battles per scenario (about a third)
  --only a,b         just these scenarios (see --list)
  --battles N        N battles per scenario, overriding the defaults
  --workers N        battles run side by side (default: CPU cores - 1)
  --doctrines        give sides doctrines from an orthogonal array, so every
                     pairing of doctrines between any two sides comes up
                     equally often, and print win rates per doctrine (the
                     battle count is rounded to whole passes over the array)
  --units            also print a unit report per doctrine: how many of each
                     unit type were built and lost, their kills, damage done
                     and taken, damage per minute of cap slot, how much of
                     the time they were firing, and what they killed and
                     died to most (always on with --doctrines; saved as a
                     -units.csv either way)
  --maps a,b         play on these map types: medium, wet, dry, hilly,
                     rugged, small, large, notown, or your own as
                     name:settings (e.g. "flat:hills=0"). With --doctrines
                     the map type is one more column of the array, so every
                     doctrine meets every map type equally often in the same
                     number of battles (exactly so with 1, 2, 4 or 8 types);
                     win rates are then also split by map type
  --every-map        with --maps, play every battle on every map type instead
                     (that many times as many battles)
  --set QUERY        change settings for every battle, written as in the
                     battle's URL, e.g. --set "sgrow=none&scap=2"; the
                     same seeds are played, so runs compare like for like
  --compare A B      compare two saved runs (sims-results/*.json) instead of
                     playing: lengths, doctrine win rates and whether each
                     change is beyond the noise, battles that changed
                     winner, and units whose damage per cap slot moved
  --duel "X vs Y"    instead of battles, set two groups on each other on an
                     empty map, e.g. --duel "tank*4 vs trooper*12" or
                     "lancer+trooper*6 vs warhound*2". Separate several duels
                     with ";". --rounds N plays each N times on different
                     ground (default 20), --gap D starts them D apart
                     (default 30), and --set changes settings as for battles
  --seeds 3,7-9      play only these battle numbers of each scenario (with
                     the same doctrines and map types they get in a full run)
  --profile          time each part of the sim and print where the time
                     goes, with the slowest tick and when it came
  --timeline         save each battle's timeline (every side's units,
                     buildings, outposts and attacks every 30 s) in the JSON
  --battle SEED      play one battle, e.g. --battle 1v1-7, and print its
                     timeline and profile instead of a stats table. --set
                     applies as usual; --from FILE takes the doctrines, map
                     type and settings that battle had in a saved run
                     (--map NAME picks one when it was played on several)
  --list             list the scenarios and stop
  --help             this text

Results for every battle, with a link to replay it in the browser, are
saved to sims-results/<date-time>.json and .csv. Win rates come with a 95%
margin of error (±): differences inside it are likely noise.`;

function parseArgs(argv) {
  const opts = {
    quick: false,
    only: null,
    battles: null,
    workers: Math.max(1, availableParallelism() - 1),
    list: false,
    help: false,
    set: '',
    doctrines: false,
    units: false,
    maps: [],
    everyMap: false,
    compare: null,
    duel: null,
    rounds: 20,
    gap: 30,
    seeds: null,
    profile: false,
    timeline: false,
    battle: null,
    from: null,
    map: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') opts.quick = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--battles') opts.battles = Math.max(1, Number(argv[++i]));
    else if (a === '--workers') opts.workers = Math.max(1, Number(argv[++i]));
    else if (a === '--set') opts.set = argv[++i];
    else if (a === '--doctrines') opts.doctrines = true;
    else if (a === '--units') opts.units = true;
    else if (a === '--maps') opts.maps = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--every-map') opts.everyMap = true;
    else if (a === '--compare') opts.compare = [argv[++i], argv[++i]];
    else if (a === '--duel') opts.duel = argv[++i];
    else if (a === '--rounds') opts.rounds = Math.max(1, Number(argv[++i]));
    else if (a === '--gap') opts.gap = Math.max(4, Number(argv[++i]));
    else if (a === '--seeds') opts.seeds = argv[++i];
    else if (a === '--profile') opts.profile = true;
    else if (a === '--timeline') opts.timeline = true;
    else if (a === '--battle') opts.battle = argv[++i];
    else if (a === '--from') opts.from = argv[++i];
    else if (a === '--map') opts.map = argv[++i];
    else throw new Error(`Unknown option ${a} (try --help)`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const sim = await load();
  if (opts.compare) {
    const [before, after] = opts.compare.map((f) => {
      if (!f) throw new Error('--compare needs two saved runs, e.g. --compare sims-results/a.json sims-results/b.json');
      return JSON.parse(readFileSync(resolve(f), 'utf8'));
    });
    return console.log(sim.compareRuns(before, after));
  }
  if (opts.duel) return duels(opts);
  if (opts.battle) return oneBattle(sim, opts);
  if (opts.list) {
    for (const s of sim.SCENARIOS) console.log(`${s.id.padEnd(16)} ${s.label} (${s.battles} battles, ${s.quick} quick)`);
    return;
  }
  const scenarios = opts.only ? sim.SCENARIOS.filter((s) => opts.only.includes(s.id)) : sim.SCENARIOS;
  if (opts.only && scenarios.length !== opts.only.length) throw new Error(`Unknown scenario in --only (try --list)`);
  for (const m of opts.maps) sim.mapType(m);
  if (opts.doctrines && opts.maps.length > 0 && !opts.everyMap && 8 % opts.maps.length !== 0) {
    console.error(`Note: with ${opts.maps.length} map types, doctrines meet them only roughly equally often (exactly with 1, 2, 4 or 8).`);
  }
  const picked = opts.seeds ? sim.parseBattleNumbers(opts.seeds) : null;
  const jobs = scenarios.flatMap((s) => {
    // Enough battles in the plan to reach the highest number picked.
    const normal = opts.battles ?? (opts.quick ? s.quick : s.battles);
    const n = picked ? Math.max(normal, picked[picked.length - 1]) : normal;
    // With doctrines, each pass over the orthogonal array plays every row once, on fresh maps.
    const sides = sim.scenarioSettings(s, 1, opts.set).factions.length;
    const plans = sim.battlePlans(sides, n, { set: opts.set, doctrines: opts.doctrines, maps: opts.maps, cross: opts.everyMap });
    const only = picked && new Set(picked);
    return plans.filter((p) => !only || only.has(p.battle)).map((p) => ({ scenario: s.id, ...p, options: { profile: opts.profile, timeline: opts.timeline } }));
  });
  if (jobs.length === 0) throw new Error('No battles to play: --seeds picked battle numbers past the end of the run (try --battles)');
  // Big battles first, so the run doesn't end waiting on one of them.
  const size = { small: 0.6, medium: 1, large: 2 };
  const cost = new Map(scenarios.map((s) => {
    const settings = sim.scenarioSettings(s, 1);
    return [s.id, settings.factions.length * size[settings.map.size]];
  }));
  jobs.sort((a, b) => cost.get(b.scenario) - cost.get(a.scenario));
  const workers = Math.min(opts.workers, jobs.length);
  console.error(`${jobs.length} battles in ${scenarios.length} scenarios, ${workers} at a time${opts.set ? `, with ${opts.set}` : ''}${opts.maps.length ? ` on ${opts.maps.join(', ')}` : ''}…`);

  const results = [];
  const started = Date.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, () =>
      new Promise((done, fail) => {
        const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { worker: true } });
        const feed = () => {
          if (next >= jobs.length) return worker.postMessage(null);
          worker.postMessage(jobs[next++]);
        };
        worker.on('message', (msg) => {
          if (msg.ready) return feed();
          results.push(msg.result);
          const r = msg.result;
          const outcome = r.winner !== null ? `team ${r.winner} won` : r.decided ? 'draw' : 'no winner';
          console.error(`[${results.length}/${jobs.length}] ${r.seed}${r.map ? ` (${r.map})` : ''}: ${r.minutes.toFixed(1)} min, ${outcome}`);
          feed();
        });
        worker.on('error', fail);
        worker.on('exit', () => done());
      }),
    ),
  );

  const summaries = scenarios.map((s) => sim.summarize(s, results.filter((r) => r.scenario === s.id).sort((a, b) => a.seed.localeCompare(b.seed, undefined, { numeric: true }))));
  const eternal = new Set(scenarios.filter((s) => s.minutes).map((s) => s.id));
  console.log('');
  console.log(sim.formatTable(summaries, eternal));
  console.log('');
  if (opts.doctrines || opts.maps.length > 1) {
    console.log(sim.formatDoctrines(results));
    console.log('');
  }
  if (opts.doctrines || opts.units) {
    console.log('Units, all battles together:');
    console.log(sim.formatUnits(results));
    console.log('');
  }
  if (opts.profile) {
    console.log(`Where the sim's time goes (${workers} battles at a time, so each ran slower than it would alone):`);
    console.log(sim.formatProfile(results));
    console.log('');
  }
  console.log('Lengths in minutes. Wins by team: T1 is the first side\'s team (the lone side in 1v3).');
  console.log('Kills, razed, outposts and attacks are per battle, all sides together.');
  if (opts.set) console.log(`Settings changed for every battle: ${opts.set}`);
  console.log(`Took ${((Date.now() - started) / 60000).toFixed(1)} minutes.`);

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = join(root, 'sims-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ set: opts.set, maps: opts.maps, summaries, battles: results }, null, 2));
  const csv = [
    'scenario,seed,map,doctrines,minutes,winner,decided,kills,razed,captured,attacks,ms_per_tick,link',
    ...results.map((r) => {
      const sum = (k) => r.sides.reduce((a, s) => a + s[k], 0);
      return [r.scenario, r.seed, r.map, r.sides.map((s) => s.doctrine).join(' '), r.minutes.toFixed(2), r.winner ?? '', r.decided, sum('kills'), sum('razed'), sum('captured'), sum('attacks'), r.msPerTick.toFixed(3), `?${r.link}`].join(',');
    }),
  ].join('\n');
  writeFileSync(join(dir, `${stamp}.csv`), csv + '\n');
  writeFileSync(join(dir, `${stamp}-units.csv`), sim.unitsCsv(results));
  console.log(`Saved sims-results/${stamp}.json, .csv and -units.csv. Compare two runs with --compare.`);
  const longest = summaries.filter((s) => !eternal.has(s.scenario)).sort((a, b) => b.longest - a.longest)[0];
  const replay = longest && results.find((r) => r.seed === longest.longestSeed);
  if (replay) console.log(`To watch one, run \`npm run dev\` and open its link, e.g. the longest (${replay.seed}): http://localhost:5173/?${replay.link}`);
}

/** --battle: one battle on this thread, with its timeline and profile. */
async function oneBattle(sim, opts) {
  const found = sim.parseSeed(opts.battle);
  if (!found) throw new Error(`"${opts.battle}" isn't a battle seed: use a scenario and a battle number, e.g. 1v1-7 (see --list)`);
  let set = opts.set;
  let map = '';
  if (opts.from) {
    const saved = JSON.parse(readFileSync(resolve(opts.from), 'utf8'));
    const matches = saved.battles.filter((r) => r.seed === found.scenario.id + '-' + found.battle && (!opts.map || r.map === opts.map));
    if (matches.length === 0) throw new Error(`No battle ${opts.battle}${opts.map ? ` on ${opts.map}` : ''} in ${opts.from}`);
    if (matches.length > 1) console.error(`Note: ${opts.battle} was played on ${matches.map((r) => r.map).join(', ')}; using ${matches[0].map} (pick with --map).`);
    set = [matches[0].set, opts.set].filter(Boolean).join('&');
    map = matches[0].map;
  }
  console.error(`Playing ${opts.battle}${map ? ` on ${map}` : ''}${set ? ` with ${set}` : ''}…`);
  const r = sim.runBattle(found.scenario, found.battle, undefined, set, map, { profile: true, timeline: true });
  const result = r.winner !== null ? `team ${r.winner} won` : r.decided ? 'a draw' : 'no winner';
  console.log(`${r.seed}: ${result} after ${r.minutes.toFixed(1)} minutes.`);
  for (const s of r.sides) console.log(`  ${s.name} (${s.doctrine}, team ${s.team}): ${s.kills} kills, ${s.lost} lost, ${s.razed} razed, ${s.captured} outposts taken, ${s.attacks} attacks${s.out !== null ? `, out at ${s.out.toFixed(1)} min` : ''}`);
  console.log('');
  console.log(sim.formatTimeline(r));
  console.log('');
  console.log(`Sim time: ${r.msPerTick.toFixed(2)} ms per tick on average.`);
  console.log(sim.formatProfile([r]));
  console.log('');
  console.log(`To watch it, run \`npm run dev\` and open http://localhost:5173/?${r.link}`);
}

/** Duels run on this thread: each round takes well under a second. */
async function duels(opts) {
  const duel = await loadDuels();
  const matchups = opts.duel.split(';').map((d) => d.trim()).filter(Boolean).map(duel.parseDuel);
  const results = [];
  for (const m of matchups) {
    for (let round = 1; round <= opts.rounds; round++) results.push(duel.runDuel(m, round, { gap: opts.gap, set: opts.set }));
    console.error(`${m.label}: ${opts.rounds} rounds done`);
  }
  console.log('');
  console.log(duel.formatDuels(results));
  console.log('');
  console.log(`A and B start ${opts.gap} apart on open ground and march on each other. A draw is both groups still standing after 3 minutes, or gone together.`);
  console.log('A wins has a 95% margin of error. "Health left when won" is the winner\'s remaining health over its starting health, averaged over its wins.');
  if (opts.set) console.log(`Settings changed: ${opts.set}`);
}

async function workerMain() {
  const sim = await load();
  parentPort.on('message', (job) => {
    if (job === null) return process.exit(0);
    const scenario = sim.SCENARIOS.find((s) => s.id === job.scenario);
    parentPort.postMessage({ result: sim.runBattle(scenario, job.battle, undefined, job.set, job.map, job.options) });
  });
  parentPort.postMessage({ ready: true });
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  });
} else if (workerData?.worker) {
  workerMain();
}
