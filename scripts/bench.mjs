// Times the sim on a few fixed battles, one at a time. Run with
// `npm run bench`; `npm run bench -- --help` lists the options. Results are
// saved under bench-results/ for --compare.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run bench -- [options]

Plays a few fixed battles (1v1 medium, 2v2 large, 8-side large) one after
another for a few minutes each and prints how long the sim's ticks took:
mean, median, 95th percentile and slowest (with when it came), the
slowest systems, and a fingerprint of where everything ended up. A
change that only makes the sim faster keeps every fingerprint the same.

  --minutes N     battle minutes per case (default 5)
  --only a,b      just these cases (1v1, 2v2, ffa8)
  --no-profile    don't time each system (a little faster, slightly
                  steadier numbers)
  --compare A B   compare two saved runs (bench-results/*.json) instead
  --help          this text

Timings depend on the machine and what else it's doing: compare runs
made on the same machine, close together.`;

function parseArgs(argv) {
  const opts = { minutes: 5, only: null, profile: true, compare: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--minutes') opts.minutes = Math.max(0.1, Number(argv[++i]));
    else if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--no-profile') opts.profile = false;
    else if (a === '--compare') opts.compare = [argv[++i], argv[++i]];
    else throw new Error(`Unknown option ${a} (try --help)`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const bench = (await runnerImport(join(root, 'src/sim/bench.ts'))).module;
  if (opts.compare) {
    const [a, b] = opts.compare.map((f) => {
      if (!f) throw new Error('--compare needs two saved runs, e.g. --compare bench-results/a.json bench-results/b.json');
      return JSON.parse(readFileSync(resolve(f), 'utf8')).results;
    });
    return console.log(bench.compareBench(a, b));
  }
  const cases = opts.only ? bench.BENCH_CASES.filter((c) => opts.only.includes(c.id)) : bench.BENCH_CASES;
  if (opts.only && cases.length !== opts.only.length) throw new Error(`Unknown case in --only: use ${bench.BENCH_CASES.map((c) => c.id).join(', ')}`);
  // A short warm-up, so the first case isn't timed while the JIT is still compiling.
  bench.runBench(bench.BENCH_CASES[0], 0.25, false);
  const results = [];
  for (const c of cases) {
    console.error(`${c.label}: ${opts.minutes} minutes…`);
    results.push(bench.runBench(c, opts.minutes, opts.profile));
  }
  console.log('');
  console.log(bench.formatBench(results));
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dir = join(root, 'bench-results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${stamp}.json`), JSON.stringify({ minutes: opts.minutes, profile: opts.profile, results }, null, 2));
  console.log(`\nSaved bench-results/${stamp}.json. Compare two runs with --compare.`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
