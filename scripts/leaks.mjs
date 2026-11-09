// Leak checks for long battles and long sessions. Run with `npm run leaks`;
// `npm run leaks -- --help` lists the options.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run leaks -- [options]

Checks that a battle left running for a long time settles down instead of
piling up memory. Two checks:

Sim (the default): plays one Eternal battle headlessly for --minutes,
samples it every --every minutes, and prints the live entities, the JS
heap after a garbage collection, and every collection (Map, Set or array)
reachable from the battle that kept growing after --warmup minutes by
more than the number of entities did: a cache keyed by something that
never repeats, or a list nothing trims.

Page (--page): opens the real page in headless Chromium and plays
--battles battles one after another, as ambient mode does between
battles, each fast-forwarded --at into the fight, and prints the GPU
geometries, textures and shader programs, scene objects, DOM nodes and JS
heap after each, and whether they kept growing. Needs Playwright.

  --minutes N   sim: battle minutes (default 90)
  --every N     sim: minutes between samples (default 10)
  --warmup N    sim: minutes before growth counts (default 20)
  --set QUERY   settings for the battle, written as in the link
                (default: Eternal, medium map, 1v1)
  --seed S      the battle's seed (default "leaks")
  --page        run the page check instead
  --battles N   page: battles to play (default 8)
  --at TIME     page: how far into each battle to jump (default 3m)
  --help        this text

Exits with an error when something kept growing, so it can run in CI.`;

function parseArgs(argv) {
  const opts = { minutes: 90, every: 10, warmup: 20, set: '', seed: 'leaks', page: false, battles: 8, at: '3m', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--minutes') opts.minutes = Math.max(1, Number(argv[++i]));
    else if (a === '--every') opts.every = Math.max(0.5, Number(argv[++i]));
    else if (a === '--warmup') opts.warmup = Math.max(0, Number(argv[++i]));
    else if (a === '--set') opts.set = argv[++i];
    else if (a === '--seed') opts.seed = argv[++i];
    else if (a === '--page') opts.page = true;
    else if (a === '--battles') opts.battles = Math.max(3, Math.round(Number(argv[++i])));
    else if (a === '--at') opts.at = argv[++i];
    else throw new Error(`Unknown option ${a} (try --help)`);
  }
  return opts;
}

const pad = (s, n) => String(s).padStart(n);

async function simCheck(opts) {
  const leaks = (await runnerImport(join(root, 'src/sim/leaks.ts'))).module;
  const settingsMod = (await runnerImport(join(root, 'src/game/settings.ts'))).module;
  const url = (await runnerImport(join(root, 'src/ui/settingsUrl.ts'))).module;
  const rng = (await runnerImport(join(root, 'src/core/rng.ts'))).module;
  const settings = settingsMod.defaultSettings();
  settings.mode = 'eternal';
  url.applyParams(settings, new URLSearchParams(opts.set));
  if (typeof globalThis.gc !== 'function') console.log('(Run through npm run leaks, or node --expose-gc, for heap numbers.)');
  console.log(`Sim: ${settings.mode} battle "${opts.seed}" for ${opts.minutes} minutes, a sample every ${opts.every}${opts.set ? `, with ${opts.set}` : ''}\n`);
  console.log(`${pad('minute', 6)} ${pad('entities', 9)} ${pad('heap MB', 8)} ${pad('collections', 12)} ${pad('elements', 9)}  ${pad('sim s', 6)}`);
  const started = performance.now();
  const samples = leaks.leakRun(settings, rng.hashSeed(opts.seed), opts.minutes, opts.every, (s) => {
    let total = 0;
    for (const v of s.sizes.values()) total += v;
    const heap = s.heapMB === null ? '-' : s.heapMB.toFixed(1);
    console.log(`${pad(s.minute.toFixed(0), 6)} ${pad(s.entities, 9)} ${pad(heap, 8)} ${pad(s.sizes.size, 12)} ${pad(total, 9)}  ${pad(((performance.now() - started) / 1000).toFixed(0), 6)}`);
  });
  const growers = leaks.leakReport(samples, opts.warmup);
  const after = samples.filter((s) => s.minute >= opts.warmup);
  const heaps = after.map((s) => s.heapMB).filter((h) => h !== null);
  console.log('');
  if (heaps.length >= 2) console.log(`Heap from minute ${after[0].minute.toFixed(0)} to the end: ${heaps[0].toFixed(1)} -> ${heaps[heaps.length - 1].toFixed(1)} MB (entities ${after[0].entities} -> ${after[after.length - 1].entities}).`);
  if (growers.length === 0) {
    console.log(`Nothing kept growing after minute ${opts.warmup}.`);
    return true;
  }
  console.log(`Kept growing after minute ${opts.warmup} (elements, first sample after warm-up -> last):`);
  for (const g of growers.slice(0, 25)) console.log(`  ${pad(g.from, 7)} -> ${pad(g.to, 7)}  ${g.path}`);
  return false;
}

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('npm run leaks -- --page needs Playwright: npm i -D playwright && npx playwright install chromium');
  }
}

async function pageCheck(opts) {
  const { chromium } = loadPlaywright();
  const url = (await runnerImport(join(root, 'src/ui/settingsUrl.ts'))).module;
  const at = url.parseAt(opts.at);
  if (at === null) throw new Error(`--at ${opts.at}: write it as 3m, 90s or 2:30`);
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
  const rows = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => console.error(`Page error: ${e.message}`));
    const cdp = await page.context().newCDPSession(page);
    const query = `${opts.set ? `${opts.set}&` : ''}seed=${encodeURIComponent(opts.seed)}-1&at=${at}s`;
    await page.goto(`http://localhost:${port}/?${query}`);
    console.log(`Page: ${opts.battles} battles, each jumped ${opts.at} in${opts.set ? `, with ${opts.set}` : ''}\n`);
    console.log(`${pad('battle', 6)} ${pad('geometries', 10)} ${pad('textures', 9)} ${pad('programs', 9)} ${pad('scene', 7)} ${pad('DOM', 6)} ${pad('heap MB', 8)}`);
    for (let b = 1; b <= opts.battles; b++) {
      await page.waitForFunction(() => window.app && window.app.game && document.querySelector('#skipping')?.hidden, null, { timeout: 0 });
      await page.waitForFunction((t) => window.app.game.world.time >= t, at, { timeout: 0 });
      // Let it draw a couple of seconds of the fight, so effects and views get made.
      await page.waitForTimeout(2500);
      await cdp.send('HeapProfiler.collectGarbage');
      const row = await page.evaluate(() => {
        const stage = window.app.stage;
        const info = stage.renderer.info;
        let objects = 0;
        stage.scene.traverse(() => objects++);
        const mem = performance.memory;
        return {
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs ? info.programs.length : 0,
          objects,
          dom: document.getElementsByTagName('*').length,
          heap: mem ? mem.usedJSHeapSize / (1024 * 1024) : null,
        };
      });
      rows.push(row);
      console.log(`${pad(b, 6)} ${pad(row.geometries, 10)} ${pad(row.textures, 9)} ${pad(row.programs, 9)} ${pad(row.objects, 7)} ${pad(row.dom, 6)} ${pad(row.heap === null ? '-' : row.heap.toFixed(1), 8)}`);
      if (b < opts.battles) {
        // The next battle, as ambient mode starts one when a battle ends, jumped into the fight.
        await page.evaluate(
          ({ seed, skip }) => {
            const app = window.app;
            app.startBattle(app.settings, seed, '', skip);
          },
          { seed: `${opts.seed}-${b + 1}`, skip: at },
        );
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
  // Battles differ, so judge the trend: the last third against the second battle, with room for the battles' own variety.
  const keys = ['geometries', 'textures', 'programs', 'objects', 'dom', 'heap'];
  const base = rows[1];
  const tail = rows.slice(Math.ceil((rows.length * 2) / 3));
  const grew = keys.filter((k) => base[k] !== null && tail.every((r) => r[k] > base[k] * 1.3 + 5) && rows.slice(1).every((r, i, a) => i === 0 || r[k] >= a[i - 1][k] * 0.97));
  console.log('');
  if (grew.length === 0) {
    console.log('Nothing kept growing from one battle to the next.');
    return true;
  }
  console.log(`Kept growing from one battle to the next: ${grew.join(', ')}.`);
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  const ok = opts.page ? await pageCheck(opts) : await simCheck(opts);
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
