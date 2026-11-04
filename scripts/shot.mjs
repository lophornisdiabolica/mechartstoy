// Screenshots of a battle from the real renderer, in headless Chromium.
// Run with `npm run shot -- <link or query or sims seed> [options]`;
// `npm run shot -- --help` lists the options.
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run shot -- WHAT [options]

Opens a battle in headless Chromium with the real renderer and saves
screenshots of it as PNGs. Needs Playwright with Chromium:
npm i -D playwright && npx playwright install chromium.

WHAT is a battle's link or query string (quote it in the shell), or a sims
battle seed such as 1v1-7 (as played by \`npm run sims\` without --doctrines
or --maps; for those, use the link the sims results give).

  --set QUERY      change settings on top, written as in the link
  --at TIME        fast-forward to this point first: 25m, 90s or 12:30
                   (default: a few seconds in)
  --look WHERE     where the camera looks: x,z or x,z,zoom (ground
                   position; 0,0 is the middle of the map), base2 (the
                   second side's base), or fight (follow the fighting, as
                   the F key does). Default: the opening view
  --zoom Z         camera zoom (1 is the default view; up to 4)
  --size WxH       picture size in pixels (default 1280x800)
  --every TIME     take a series, this far apart in battle time
  --count N        how many pictures in the series (default 1, or 6 with
                   --every)
  --speed N        battle speed while waiting between pictures (default 4)
  --clean          hide the HUD and the control panel
  --plans          show the Commanders' plans on the map
  --out FILE       where to write it (default shots-out/<seed>-<time>.png;
                   a series adds -1, -2, ...)
  --help           this text`;

function parseArgs(argv) {
  const opts = { what: null, set: '', at: null, look: null, zoom: null, size: [1280, 800], every: null, count: null, speed: 4, clean: false, plans: false, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--set') opts.set = argv[++i];
    else if (a === '--at') opts.at = argv[++i];
    else if (a === '--look') opts.look = argv[++i];
    else if (a === '--zoom') opts.zoom = Number(argv[++i]);
    else if (a === '--size') {
      const m = argv[++i].match(/^(\d+)x(\d+)$/);
      if (!m) throw new Error('--size is written WxH, e.g. 1600x900');
      opts.size = [Number(m[1]), Number(m[2])];
    } else if (a === '--every') opts.every = argv[++i];
    else if (a === '--count') opts.count = Math.max(1, Math.round(Number(argv[++i])));
    else if (a === '--speed') opts.speed = Math.max(0.25, Math.min(4, Number(argv[++i])));
    else if (a === '--clean') opts.clean = true;
    else if (a === '--plans') opts.plans = true;
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a} (try --help)`);
    else if (opts.what === null) opts.what = a;
    else throw new Error(`One battle at a time: "${a}" is extra`);
  }
  return opts;
}

function loadPlaywright() {
  try {
    // From the project, or a global install on NODE_PATH.
    return createRequire(import.meta.url)('playwright');
  } catch {
    throw new Error('npm run shot needs Playwright: npm i -D playwright && npx playwright install chromium');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.what) return console.log(HELP);
  const { chromium } = loadPlaywright();
  const tool = (await runnerImport(join(root, 'src/sim/mapTool.ts'))).module;
  const url = (await runnerImport(join(root, 'src/ui/settingsUrl.ts'))).module;
  const settings = tool.settingsFor(opts.what, opts.set);
  if (!settings.seed) settings.seed = 'shot';
  const at = opts.at === null ? 5 : url.parseAt(opts.at);
  if (at === null) throw new Error(`--at ${opts.at}: write it as 25m, 90s or 12:30`);
  const every = opts.every === null ? null : url.parseAt(opts.every);
  if (opts.every !== null && every === null) throw new Error(`--every ${opts.every}: write it as 30s, 2m or 1:30`);
  const count = opts.count ?? (every ? 6 : 1);
  const query = `${url.settingsToParams(settings).toString()}&at=${at}s`;

  const server = await createServer({ root, logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: opts.size[0], height: opts.size[1] } });
    page.on('pageerror', (e) => console.error(`Page error: ${e.message}`));
    await page.goto(`http://localhost:${port}/?${query}`);
    await page.waitForFunction(() => window.app && window.app.game && document.querySelector('#skipping')?.hidden, null, { timeout: 0 });
    // Arrived: let the view settle on the battle's state.
    await page.waitForFunction((t) => window.app.game.world.time >= t, at, { timeout: 0 });
    await page.evaluate(
      ({ look, zoom, clean, plans }) => {
        const app = window.app;
        const stage = app.stage;
        const rig = stage.rig;
        const game = app.game;
        stage.showPlans = plans;
        if (clean) {
          const style = document.createElement('style');
          style.textContent = '#hud, #panel, #toast, #perf, #banner { display: none !important; }';
          document.head.append(style);
        }
        if (look === 'fight') stage.followFights = true;
        else if (look && /^base\d+$/.test(look)) {
          const site = game.ctx.field.baseSites[Number(look.slice(4)) - 1];
          if (!site) throw new Error(`No ${look}: the battle has ${game.ctx.field.baseSites.length} bases`);
          rig.jumpTo(site.x, site.z, zoom ?? rig.targetZoom);
        } else if (look) {
          const [x, z, z2] = look.split(',').map(Number);
          if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`--look ${look}: write it as x,z or x,z,zoom, base2 or fight`);
          rig.jumpTo(x, z, z2 ?? zoom ?? rig.targetZoom);
        } else if (zoom) rig.jumpTo(rig.target.x, rig.target.z, zoom);
      },
      { look: opts.look, zoom: opts.zoom, clean: opts.clean, plans: opts.plans },
    );
    const outDir = opts.out ? dirname(opts.out) : join(root, 'shots-out');
    mkdirSync(outDir, { recursive: true });
    const clock = (s) => `${Math.floor(s / 60)}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
    for (let n = 1; n <= count; n++) {
      // The camera glides; give it (and the fight-follower) a moment, with the battle paused for a single picture.
      if (n === 1) {
        await page.evaluate(() => (window.app.loop.timeScale = 0));
        await page.waitForTimeout(opts.look === 'fight' ? 2500 : 1200);
      }
      const time = await page.evaluate(() => window.app.game.world.time);
      const name = `${settings.seed.replace(/[^\w.-]+/g, '_')}-${clock(time)}`;
      const file = opts.out ? (count > 1 ? opts.out.replace(/(\.png)?$/, `-${n}.png`) : opts.out) : join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(`${file}  (${clock(time)})`);
      if (n < count) {
        const next = time + every;
        await page.evaluate((s) => (window.app.loop.timeScale = s), opts.speed);
        await page.waitForFunction((t) => window.app.game.world.time >= t || window.app.game.outcome !== null, next, { timeout: 0 });
        await page.evaluate(() => (window.app.loop.timeScale = 0));
        await page.waitForTimeout(300);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
