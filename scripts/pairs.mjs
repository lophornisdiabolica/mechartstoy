// Screenshot pairs: the same scenes from the branch it targets and from
// this one, side by side, to review looks and catch visual regressions.
// Run with `npm run pairs`; `npm run pairs -- --help` lists the options.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run pairs -- [options]

Takes the same fixed set of pictures from two versions of the game, the
base (by default origin/main) and the working tree, and puts each pair side
by side in shots-out/pairs/, with an index.html to flick through them. Each
pair says how much of the picture changed, so a change meant to touch one
model shows up as one changed pair, and a regression elsewhere stands out.

  --base REF      the version to compare with (default origin/main)
  --scenes a,b    only these scenes (see --list)
  --list          list the scenes and stop
  --size WxH      picture size (default 960x600)
  --help          this text

The scenes are the model viewer for every doctrine (on a slope, turned,
and wrecked) and a few battles at fixed moments. Needs Playwright with
Chromium (npm i -D playwright && npx playwright install chromium).`;

const DOCTRINES = ['armour', 'raiders', 'legion', 'bastion', 'talon', 'skyline', 'tidewater', 'firestorm', 'aegis', 'rime', 'sabre', 'cipher', 'veil'];

/** The fixed scenes: the model viewer for each doctrine, its wrecks, the buildings, and a few battle moments. */
const SCENES = [
  ...DOCTRINES.map((d) => ({ name: `models-${d}`, models: `doctrine=${d}&slope=15&aim=35&elev=8` })),
  ...DOCTRINES.map((d) => ({ name: `wrecks-${d}`, models: `doctrine=${d}&slope=10&wreck=1&labels=0` })),
  { name: 'models-buildings', models: 'doctrine=buildings&slope=0&labels=0' },
  // Battles from fixed camera spots (following the fighting depends on frame timing, so it isn't the same twice).
  { name: 'battle-opening', battle: 'seed=pairs-1&mode=conquest', at: 20, look: [0, 0, 1] },
  { name: 'battle-mid', battle: 'seed=pairs-2&mode=conquest&doc1=aegis&doc2=veil', at: 300, look: [0, 0, 1.8] },
  { name: 'battle-city', battle: 'seed=pairs-3&mode=conquest&city=1&doc1=rime&doc2=cipher', at: 240, look: [0, 0, 1.8] },
  { name: 'battle-wet', battle: 'seed=pairs-4&mode=conquest&water=1&doc1=tidewater&doc2=skyline', at: 360, look: [0, 0, 1.4] },
];

function parseArgs(argv) {
  const opts = { base: 'origin/main', scenes: null, list: false, size: [960, 600], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--base') opts.base = argv[++i];
    else if (a === '--scenes') opts.scenes = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--list') opts.list = true;
    else if (a === '--size') {
      const m = argv[++i].match(/^(\d+)x(\d+)$/);
      if (!m) throw new Error('--size is written WxH, e.g. 1280x800');
      opts.size = [Number(m[1]), Number(m[2])];
    } else throw new Error(`Unknown option ${a} (try --help)`);
  }
  return opts;
}

/** A dev server for a copy of the game. */
async function serve(dir) {
  const server = await createServer({ root: dir, configFile: join(dir, 'vite.config.ts'), logLevel: 'error', server: { port: 0, strictPort: false } });
  await server.listen();
  return { server, url: `http://localhost:${server.httpServer.address().port}/` };
}

/** One scene's picture from one copy of the game, as PNG bytes (null if that copy can't show it). */
async function take(browser, base, scene, size, hasViewer) {
  if (scene.models && !hasViewer) return null;
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('pageerror', (e) => console.error(`  page error: ${e.message}`));
  try {
    if (scene.models) {
      await page.goto(`${base}?models&${scene.models}`);
      await page.waitForFunction(() => window.viewer && window.viewer.ready, null, { timeout: 120000 });
      await page.addStyleTag({ content: '#panel { display: none !important; }' });
    } else {
      await page.goto(`${base}?${scene.battle}&at=${scene.at}s`);
      await page.waitForFunction(() => window.app && window.app.game && document.querySelector('#skipping')?.hidden, null, { timeout: 0 });
      await page.waitForFunction((t) => window.app.game.world.time >= t, scene.at, { timeout: 0 });
      await page.evaluate((look) => {
        window.app.loop.timeScale = 0;
        const style = document.createElement('style');
        style.textContent = '#hud, #panel, #toast, #perf, #banner, #ticker, #god-toggle { display: none !important; }';
        document.head.append(style);
        window.app.stage.rig.jumpTo(look[0], look[1], look[2]);
      }, scene.look);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(500);
    return await page.screenshot();
  } finally {
    await page.close();
  }
}

/** The pair side by side, labelled, and how much of the picture changed (share of pixels differing noticeably). */
async function compose(browser, a, b, size, title) {
  const page = await browser.newPage({ viewport: { width: size[0] * 2 + 12, height: size[1] + 34 } });
  try {
    const src = (png) => (png ? `data:image/png;base64,${png.toString('base64')}` : '');
    await page.setContent(`<body style="margin:0;background:#1b2028;font:13px system-ui;color:#e6edf3">
      <div style="display:flex;gap:12px;padding:0"><div><div style="padding:8px">Base</div><img id="a" src="${src(a)}" width="${size[0]}" height="${size[1]}"></div>
      <div><div style="padding:8px" id="t">This branch</div><img id="b" src="${src(b)}" width="${size[0]}" height="${size[1]}"></div></div></body>`);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const changed = await page.evaluate(([w, h]) => {
      const [a, b] = ['a', 'b'].map((id) => document.getElementById(id));
      if (!a.naturalWidth || !b.naturalWidth) return null;
      const read = (img) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, w, h);
        return g.getImageData(0, 0, w, h).data;
      };
      const pa = read(a);
      const pb = read(b);
      let diff = 0;
      for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 24) diff++;
      return diff / (w * h);
    }, size);
    await page.evaluate(([t, c]) => (document.getElementById('t').textContent = `This branch: ${t}${c === null ? '' : `, ${(c * 100).toFixed(1)}% changed`}`), [title, changed]);
    return { png: await page.screenshot(), changed };
  } finally {
    await page.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  if (opts.list) return SCENES.forEach((s) => console.log(s.name));
  const scenes = opts.scenes ? SCENES.filter((s) => opts.scenes.includes(s.name)) : SCENES;
  if (scenes.length === 0) throw new Error('No such scenes (try --list)');
  let chromium;
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    throw new Error('npm run pairs needs Playwright: npm i -D playwright && npx playwright install chromium');
  }
  // The base version, checked out beside this one (sharing its installed packages).
  const baseDir = join(root, '.pairs-base');
  if (existsSync(baseDir)) execSync(`git worktree remove --force "${baseDir}"`, { cwd: root, stdio: 'ignore' });
  rmSync(baseDir, { recursive: true, force: true });
  execSync(`git worktree add --detach "${baseDir}" ${opts.base}`, { cwd: root, stdio: 'ignore' });
  symlinkSync(join(root, 'node_modules'), join(baseDir, 'node_modules'), 'dir');
  const baseCommit = execSync(`git rev-parse --short ${opts.base}`, { cwd: root }).toString().trim();
  const out = join(root, 'shots-out', 'pairs');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const servers = [];
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const rows = [];
  try {
    const before = await serve(baseDir);
    const after = await serve(root);
    servers.push(before.server, after.server);
    const viewerIn = (dir) => existsSync(join(dir, 'src/ui/modelViewer.ts'));
    for (const scene of scenes) {
      const a = await take(browser, before.url, scene, opts.size, viewerIn(baseDir));
      const b = await take(browser, after.url, scene, opts.size, viewerIn(root));
      const { png, changed } = await compose(browser, a, b, opts.size, scene.name);
      writeFileSync(join(out, `${scene.name}.png`), png);
      rows.push({ name: scene.name, changed });
      console.log(`${scene.name.padEnd(20)} ${changed === null ? 'new (not in the base)' : `${(changed * 100).toFixed(1)}% changed`}`);
    }
  } finally {
    await browser.close();
    for (const s of servers) await s.close();
    execSync(`git worktree remove --force "${baseDir}"`, { cwd: root, stdio: 'ignore' });
  }
  const list = rows
    .map((r) => `<li><a href="${r.name}.png">${r.name}</a> ${r.changed === null ? 'new' : `${(r.changed * 100).toFixed(1)}% changed`}<br><img src="${r.name}.png" loading="lazy" style="max-width:100%"></li>`)
    .join('\n');
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Screenshot pairs</title><body style="background:#1b2028;color:#e6edf3;font:14px system-ui"><h1>Base ${opts.base} (${baseCommit}) vs this branch</h1><ul style="list-style:none;padding:0">${list}</ul>`);
  console.log(`\nSaved ${rows.length} pairs to shots-out/pairs/ (open index.html). Changes under about 2% are usually noise (animation, smoke).`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
