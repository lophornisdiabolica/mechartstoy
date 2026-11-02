// Plays the balance scenarios in src/sim/simulate.ts headlessly, in parallel,
// and prints a stats table. Run with `npm run sims`; `npm run sims -- --help`
// lists the options. Results (every battle, with a replay link) are saved
// under sims-results/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = async () => (await runnerImport(join(root, 'src/sim/simulate.ts'))).module;

const HELP = `Usage: npm run sims -- [options]

Plays battles headlessly at full speed and prints stats per scenario.

  --quick            fewer battles per scenario (about a third)
  --only a,b         just these scenarios (see --list)
  --battles N        N battles per scenario, overriding the defaults
  --workers N        battles run side by side (default: CPU cores - 1)
  --set QUERY        change settings for every battle, written as in the
                     battle's URL, e.g. --set "sgrow=none&scap=2"; the
                     same seeds are played, so runs compare like for like
  --list             list the scenarios and stop
  --help             this text

Results for every battle, with a link to replay it in the browser, are
saved to sims-results/<date-time>.json and .csv.`;

function parseArgs(argv) {
  const opts = { quick: false, only: null, battles: null, workers: Math.max(1, availableParallelism() - 1), list: false, help: false, set: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--quick') opts.quick = true;
    else if (a === '--list') opts.list = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--battles') opts.battles = Math.max(1, Number(argv[++i]));
    else if (a === '--workers') opts.workers = Math.max(1, Number(argv[++i]));
    else if (a === '--set') opts.set = argv[++i];
    else throw new Error(`Unknown option ${a} (try --help)`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const sim = await load();
  if (opts.list) {
    for (const s of sim.SCENARIOS) console.log(`${s.id.padEnd(16)} ${s.label} (${s.battles} battles, ${s.quick} quick)`);
    return;
  }
  const scenarios = opts.only ? sim.SCENARIOS.filter((s) => opts.only.includes(s.id)) : sim.SCENARIOS;
  if (opts.only && scenarios.length !== opts.only.length) throw new Error(`Unknown scenario in --only (try --list)`);
  const jobs = scenarios.flatMap((s) => {
    const n = opts.battles ?? (opts.quick ? s.quick : s.battles);
    return Array.from({ length: n }, (_, i) => ({ scenario: s.id, battle: i + 1, set: opts.set }));
  });
  // Big battles first, so the run doesn't end waiting on one of them.
  const size = { small: 0.6, medium: 1, large: 2 };
  const cost = new Map(scenarios.map((s) => {
    const settings = sim.scenarioSettings(s, 1);
    return [s.id, settings.factions.length * size[settings.map.size]];
  }));
  jobs.sort((a, b) => cost.get(b.scenario) - cost.get(a.scenario));
  const workers = Math.min(opts.workers, jobs.length);
  console.error(`${jobs.length} battles in ${scenarios.length} scenarios, ${workers} at a time${opts.set ? `, with ${opts.set}` : ''}…`);

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
          console.error(`[${results.length}/${jobs.length}] ${r.seed}: ${r.minutes.toFixed(1)} min, ${outcome}`);
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
  console.log('Lengths in minutes. Wins by team: T1 is the first side\'s team (the lone side in 1v3).');
  console.log('Kills, razed, outposts and attacks are per battle, all sides together.');
  if (opts.set) console.log(`Settings changed for every battle: ${opts.set}`);
  console.log(`Took ${((Date.now() - started) / 60000).toFixed(1)} minutes.`);

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = join(root, 'sims-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ set: opts.set, summaries, battles: results }, null, 2));
  const csv = [
    'scenario,seed,minutes,winner,decided,kills,razed,captured,attacks,ms_per_tick,link',
    ...results.map((r) => {
      const sum = (k) => r.sides.reduce((a, s) => a + s[k], 0);
      return [r.scenario, r.seed, r.minutes.toFixed(2), r.winner ?? '', r.decided, sum('kills'), sum('razed'), sum('captured'), sum('attacks'), r.msPerTick.toFixed(3), `?${r.link}`].join(',');
    }),
  ].join('\n');
  writeFileSync(join(dir, `${stamp}.csv`), csv + '\n');
  console.log(`Saved sims-results/${stamp}.json and .csv.`);
  const longest = summaries.filter((s) => !eternal.has(s.scenario)).sort((a, b) => b.longest - a.longest)[0];
  const replay = longest && results.find((r) => r.seed === longest.longestSeed);
  if (replay) console.log(`To watch one, run \`npm run dev\` and open its link, e.g. the longest (${replay.seed}): http://localhost:5173/?${replay.link}`);
}

async function workerMain() {
  const sim = await load();
  parentPort.on('message', (job) => {
    if (job === null) return process.exit(0);
    const scenario = sim.SCENARIOS.find((s) => s.id === job.scenario);
    parentPort.postMessage({ result: sim.runBattle(scenario, job.battle, undefined, job.set) });
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
