// Measures how fast the real renderer draws a few fixed battle scenes, in
// Chromium. Run with `npm run fps`; `npm run fps -- --help` lists the
// options. Results are saved under fps-results/ for --compare.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The scenes: the bench battles (see src/sim/bench.ts) at a set time, seen from a set place. */
const SCENES = [
  { id: '1v1', label: '1v1 medium, 5 min, whole map', query: 'seed=bench-1v1', at: 300, look: 'overview' },
  { id: '2v2', label: '2v2 large, 10 min, whole map', query: 'seed=bench-2v2&size=large&sides=4&team2=1&team3=2&team4=2', at: 600, look: 'overview' },
  { id: '2v2-fight', label: '2v2 large, 10 min, close on a fight', query: 'seed=bench-2v2&size=large&sides=4&team2=1&team3=2&team4=2', at: 600, look: 'fight' },
  { id: 'ffa8', label: '8 sides large, 10 min, whole map', query: 'seed=bench-ffa8&size=large&sides=8', at: 600, look: 'overview' },
  { id: 'ffa8-late', label: '8 sides large, 25 min, whole map', query: 'seed=bench-ffa8&size=large&sides=8', at: 1500, look: 'overview' },
];

const HELP = `Usage: npm run fps -- [options]

Opens a few fixed battle scenes in Chromium with the real renderer and
measures where each frame's time goes: the page's own work by part (units,
effects, wreckage, the scene and shadow draws, the post chain, the sim's
snapshot...), GPU time by pass where the browser has GPU timers, frame
time, draw calls and triangles. The same numbers as the stats readout (P)
in the game. Scenes: ${SCENES.map((s) => s.id).join(', ')}.

Headless Chromium draws in software (no GPU), so its page times are real
but its frame times are mostly the software renderer; use --headed (or
--channel chrome) on a machine with a GPU for real frame and GPU times.

  --only a,b        just these scenes
  --seconds N       seconds to measure each scene (default 5)
  --size WxH        window size in pixels (default 1280x800)
  --paused          measure with the battle paused (steadier; no sim
                    snapshot or effects work)
  --headed          a visible browser window, drawing with the GPU
  --channel NAME    use an installed browser instead of Playwright's
                    Chromium: chrome, msedge (implies --headed)
  --cost            also run the cost check (P readout's button) on each
                    scene: what shadows, blur, multisampling and each
                    layer cost
  --cpu-profile     save a CPU profile of each scene's measuring, for the
                    Performance tab of Chrome's DevTools (Load profile)
  --out FILE        save the results here instead of fps-results/<time>.json
  --compare A B     compare two saved runs (fps-results/*.json) instead
  --help            this text

Compare runs made on the same machine, close together.`;

function parseArgs(argv) {
  const opts = { only: null, seconds: 5, size: [1280, 800], paused: false, headed: false, channel: null, cost: false, cpuProfile: false, out: null, compare: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--seconds') opts.seconds = Math.max(1, Number(argv[++i]));
    else if (a === '--size') {
      const m = argv[++i].match(/^(\d+)x(\d+)$/);
      if (!m) throw new Error('--size is written WxH, e.g. 1600x900');
      opts.size = [Number(m[1]), Number(m[2])];
    } else if (a === '--paused') opts.paused = true;
    else if (a === '--headed') opts.headed = true;
    else if (a === '--channel') {
      opts.channel = argv[++i];
      opts.headed = true;
    } else if (a === '--cost') opts.cost = true;
    else if (a === '--cpu-profile') opts.cpuProfile = true;
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--compare') opts.compare = [argv[++i], argv[++i]];
    else throw new Error(`Unknown option ${a} (try --help)`);
  }
  return opts;
}

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('npm run fps needs Playwright: npm i -D playwright && npx playwright install chromium');
  }
}

const ms = (v) => (v === null || v === undefined ? '-' : v.toFixed(1));

function printResult(r) {
  const s = r.stats;
  const top = (rec) =>
    Object.entries(rec)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${ms(v)}`)
      .join(' · ');
  console.log(`\n${r.label}  (${r.pixels}, ${r.entities} entities)`);
  console.log(`  frame ${ms(s.frameMs)} ms (${Math.round(1000 / Math.max(1e-6, s.frameMs))} fps) · page ${ms(s.pageMs)} ms · GPU ${s.gpuMs === null ? 'no timers' : `${ms(s.gpuMs)} ms`}`);
  console.log(`  page: ${top(s.page)}`);
  if (s.gpu) console.log(`  GPU: ${top(s.gpu)}`);
  console.log(`  draw calls ${Math.round(s.calls)} (shadows ${Math.round(s.shadowCalls)}) · triangles ${Math.round(s.triangles / 1000)}k · models drawn ${Math.round(s.modelsDrawn)} of ${Math.round(s.models)}`);
  if (r.cost) console.log(r.cost.replace(/^/gm, '  '));
  if (r.cpuProfile) console.log(`  CPU profile: ${r.cpuProfile}`);
}

function compare(a, b) {
  const lines = [];
  for (const rb of b) {
    const ra = a.find((r) => r.id === rb.id);
    if (!ra) continue;
    const d = (x, y) => (x === null || y === null ? '-' : `${ms(x)} → ${ms(y)} (${y - x >= 0 ? '+' : ''}${ms(y - x)})`);
    lines.push(`\n${rb.label}`);
    lines.push(`  frame ${d(ra.stats.frameMs, rb.stats.frameMs)} · page ${d(ra.stats.pageMs, rb.stats.pageMs)} · GPU ${d(ra.stats.gpuMs, rb.stats.gpuMs)}`);
    const parts = new Set([...Object.keys(ra.stats.page), ...Object.keys(rb.stats.page)]);
    for (const k of [...parts].sort((x, y) => (rb.stats.page[y] ?? 0) - (rb.stats.page[x] ?? 0))) lines.push(`    ${k}: ${d(ra.stats.page[k] ?? 0, rb.stats.page[k] ?? 0)}`);
    if (ra.stats.gpu && rb.stats.gpu) for (const k of Object.keys(rb.stats.gpu)) lines.push(`    GPU ${k}: ${d(ra.stats.gpu[k] ?? 0, rb.stats.gpu[k] ?? 0)}`);
    lines.push(`  draw calls ${d(ra.stats.calls, rb.stats.calls)} · models drawn ${d(ra.stats.modelsDrawn, rb.stats.modelsDrawn)}`);
  }
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  if (opts.compare) {
    const [a, b] = opts.compare.map((f) => {
      if (!f) throw new Error('--compare needs two saved runs, e.g. --compare fps-results/a.json fps-results/b.json');
      return JSON.parse(readFileSync(resolve(f), 'utf8')).results;
    });
    return console.log(compare(a, b));
  }
  const scenes = opts.only ? SCENES.filter((s) => opts.only.includes(s.id)) : SCENES;
  if (scenes.length === 0) throw new Error(`No such scene; there are ${SCENES.map((s) => s.id).join(', ')}`);
  const { chromium } = loadPlaywright();
  const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const port = server.httpServer.address().port;
  const outDir = join(root, 'fps-results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const launch = { headless: !opts.headed, args: opts.headed ? [] : ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
  if (opts.channel) launch.channel = opts.channel;
  else if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launch);
  const results = [];
  try {
    for (const scene of scenes) {
      const page = await browser.newPage({ viewport: { width: opts.size[0], height: opts.size[1] } });
      page.on('pageerror', (e) => console.error(`Page error: ${e.message}`));
      process.stdout.write(`${scene.label}: fast-forwarding...`);
      await page.goto(`http://localhost:${port}/?${scene.query}&at=${scene.at}s`);
      await page.waitForFunction(() => window.app && window.app.game && document.querySelector('#skipping')?.hidden, null, { timeout: 0 });
      await page.waitForFunction((t) => window.app.game.world.time >= t, scene.at, { timeout: 0 });
      await page.evaluate(
        ({ look, paused }) => {
          const app = window.app;
          // The same picture every run: no HUD or panel, the camera placed by hand.
          const style = document.createElement('style');
          style.textContent = '#hud, #panel, #toast, #banner, #ticker { display: none !important; }';
          document.head.append(style);
          if (look === 'fight') app.stage.followFights = true;
          else {
            app.stage.cameraMode = 'free';
            app.stage.rig.jumpTo(0, 0, app.stage.rig.minZoom);
          }
          app.loop.timeScale = paused ? 0 : 1;
        },
        { look: scene.look, paused: opts.paused },
      );
      // Let the camera arrive and the scene settle.
      await page.waitForTimeout(scene.look === 'fight' ? 3000 : 1500);
      process.stdout.write(' measuring...');
      let cdp = null;
      if (opts.cpuProfile) {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
      }
      const stats = await page.evaluate((s) => window.app.perf.measure(s), opts.seconds);
      let cpuProfile = null;
      if (cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        cpuProfile = join(outDir, `${stamp}-${scene.id}.cpuprofile`);
        writeFileSync(cpuProfile, JSON.stringify(profile));
      }
      let cost = null;
      if (opts.cost) {
        process.stdout.write(' cost check...');
        cost = await page.evaluate(() => window.app.perf.costCheck());
      }
      const info = await page.evaluate(() => ({ pixels: window.app.stage.pixels(), entities: window.app.game.world.entityCount }));
      process.stdout.write('\n');
      const r = { id: scene.id, label: scene.label, ...info, stats, cost, cpuProfile };
      results.push(r);
      printResult(r);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const file = opts.out ?? join(outDir, `${stamp}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), headed: opts.headed, paused: opts.paused, results }, null, 1));
  console.log(`\nSaved ${file}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
