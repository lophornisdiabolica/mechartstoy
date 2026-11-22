// The flicker check: watches a battle in headless Chromium and flags
// anything whose look changes back and forth faster than twice a second.
// Run with `npm run flicker`; `npm run flicker -- --help` lists the options.
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run flicker -- [WHAT] [options]

Plays a battle in headless Chromium with the real renderer, slowed down so
every moment is drawn, and watches how everything on the field looks: each
unit and building (parts shown, lights, how far it has faded out) and each
effect drawn on its own (domes and the like: shown or not, how opaque).
Anything whose look goes back and forth more than --limit times in a second
of battle time is listed as flicker, worst first. Jbt is sensitive to
flicker, so new looks should pass this.

WHAT is a battle link or query string, or a sims seed (as for npm run shot).
The default is an eight-sided free-for-all of the doctrines with the most
going on to look at: Veil, Cipher, Aegis, Rime, Firestorm, Skyline, Sabre
and Tidewater.

  --at TIME       battle time to start watching (default 6m)
  --seconds N     seconds of battle to watch (default 20)
  --slow X        battle speed while watching (default 0.25: headless
                  drawing is slow, so it has to be slowed to see every frame)
  --limit N       changes back and forth per second that count as flicker
                  (default 2)
  --set QUERY     change settings on top, written as in the link
  --help          this text

Exits with an error if anything flickered, so it can run in CI.`;

function parseArgs(argv) {
  const opts = { what: null, at: '6m', seconds: 20, slow: 0.25, limit: 2, set: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--at') opts.at = argv[++i];
    else if (a === '--seconds') opts.seconds = Math.max(2, Number(argv[++i]));
    else if (a === '--slow') opts.slow = Math.max(0.05, Math.min(1, Number(argv[++i])));
    else if (a === '--limit') opts.limit = Math.max(0.5, Number(argv[++i]));
    else if (a === '--set') opts.set = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a} (try --help)`);
    else opts.what = a;
  }
  return opts;
}

const DEFAULT_SIDES = ['veil', 'cipher', 'aegis', 'rime', 'firestorm', 'skyline', 'sabre', 'tidewater'];

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    throw new Error('npm run flicker needs Playwright: npm i -D playwright && npx playwright install chromium');
  }
  const tool = (await runnerImport(join(root, 'src/sim/mapTool.ts'))).module;
  const url = (await runnerImport(join(root, 'src/ui/settingsUrl.ts'))).module;
  const set = opts.what ? opts.set : [`sides=8&mode=conquest&water=0.6&${DEFAULT_SIDES.map((d, i) => `doc${i + 1}=${d}`).join('&')}`, opts.set].filter(Boolean).join('&');
  const settings = tool.settingsFor(opts.what ?? 'seed=flicker', set);
  if (!settings.seed) settings.seed = 'flicker';
  const at = url.parseAt(opts.at);
  if (at === null) throw new Error(`--at ${opts.at}: write it as 25m, 90s or 12:30`);
  const query = `${url.settingsToParams(settings).toString()}&at=${at}s`;

  const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  let flagged = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    page.on('pageerror', (e) => console.error(`Page error: ${e.message}`));
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForFunction(() => window.app && window.app.game && document.querySelector('#skipping')?.hidden, null, { timeout: 0 });
    await page.waitForFunction((t) => window.app.game.world.time >= t, at, { timeout: 0 });
    console.error(`Watching ${settings.seed} from ${opts.at} for ${opts.seconds} s of battle at ${opts.slow}x…`);
    const report = await page.evaluate(
      ({ seconds, slow, limit }) =>
        new Promise((done) => {
          const app = window.app;
          app.loop.timeScale = slow;
          // Look at the whole field, so everything on it is drawn.
          app.stage.rig.jumpTo(0, 0, app.stage.rig.minZoom);
          const start = app.game.world.time;
          /** Per thing watched: its last look, which way it last changed, and the times it turned back. */
          const tracks = new Map();
          const note = (key, label, value, time) => {
            let t = tracks.get(key);
            if (!t) return tracks.set(key, { label, value, dir: 0, turns: [], frames: 1 });
            t.frames++;
            if (value === t.value) return;
            const dir = value > t.value ? 1 : -1;
            // A change that undoes the last one (on, off, on) is a turn back.
            if (t.dir !== 0 && dir !== t.dir) t.turns.push(time);
            t.dir = dir;
            t.value = value;
          };
          let frames = 0;
          const sample = () => {
            const game = app.game;
            const time = game.world.time;
            frames++;
            for (const [e, look] of app.stage.entities.looks()) {
              const unit = game.world.get(e, window.components.Unit)?.def.id ?? game.world.get(e, window.components.Building)?.def.id ?? game.world.get(e, window.components.Renderable)?.model ?? '?';
              note(`e${e}`, unit, look, time);
            }
            // Effects drawn as meshes of their own (not instanced): shown or not, and how opaque, in steps of 5%.
            const battle = app.stage.scene.getObjectByName('battle');
            battle?.traverse((o) => {
              if (!o.isMesh || o.isInstancedMesh) return;
              let layer = o;
              while (layer.parent && layer.parent !== battle) layer = layer.parent;
              if (layer === app.stage.entities.root) return;
              const m = Array.isArray(o.material) ? o.material[0] : o.material;
              let shown = true;
              for (let p = o; p; p = p.parent) if (!p.visible) shown = false;
              note(`m${o.id}`, `${layer.name || 'effect'}/${o.name || m?.type || 'mesh'}`, shown ? 1 + Math.round((m?.opacity ?? 1) * 20) : 0, time);
            });
            if (time - start >= seconds) {
              app.loop.timeScale = 0;
              const span = time - start;
              const worst = [];
              for (const t of tracks.values()) {
                // The busiest second: most turns back within any one second of battle time.
                let most = 0;
                for (let i = 0, j = 0; i < t.turns.length; i++) {
                  while (t.turns[i] - t.turns[j] > 1) j++;
                  most = Math.max(most, i - j + 1);
                }
                if (most > limit) worst.push({ label: t.label, most, turns: t.turns.length, rate: t.turns.length / span });
              }
              worst.sort((a, b) => b.most - a.most || b.rate - a.rate);
              return done({ frames, span, watched: tracks.size, worst });
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
      { seconds: opts.seconds, slow: opts.slow, limit: opts.limit },
    );
    console.log(`Watched ${report.watched} things over ${report.span.toFixed(1)} s of battle in ${report.frames} frames (${(report.frames / report.span).toFixed(0)} per battle second).`);
    if (report.frames / report.span < opts.limit * 4) console.log(`Note: that's too few frames per second to see flicker reliably; try a lower --slow.`);
    if (report.worst.length === 0) {
      console.log(`Nothing changed back and forth more than ${opts.limit} times in any second.`);
    } else {
      // Group by what it is: the same unit type or effect flickering many times is one finding.
      const by = new Map();
      for (const w of report.worst) {
        const g = by.get(w.label) ?? { label: w.label, count: 0, most: 0 };
        g.count++;
        g.most = Math.max(g.most, w.most);
        by.set(w.label, g);
      }
      flagged = by.size;
      console.log(`Flicker (more than ${opts.limit} changes back and forth in one second):`);
      for (const g of [...by.values()].sort((a, b) => b.most - a.most)) console.log(`  ${g.label.padEnd(28)} up to ${g.most} a second, ${g.count} of them`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  if (flagged > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
