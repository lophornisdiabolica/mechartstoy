// Draws the map a battle would be played on, as a PNG, without playing it.
// Run with `npm run map -- <link or query or sims seed> [options]`;
// `npm run map -- --help` lists the options.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { runnerImport } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `Usage: npm run map -- WHAT [WHAT...] [options]

Draws the map each WHAT makes, top down, as a PNG: the ground (water,
shore, hills shaded by height, dense forest darker, roads and bridges
grey), each base in its side's colour with its number, towns (T), and
outposts lettered by kind (S supply, A airstrip, G gun, R relay, F fuel,
M ruined factory).

WHAT is a battle's link or query string (e.g. "seed=abc&biome=desert&water=0.8",
quote it in the shell), or a sims battle seed such as 1v1-7.

  --set QUERY   change settings on top of each, written as in the link
  --count N     N maps for each, with seeds 1 to N added to its seed
  --scale N     pixels per map cell (default 4)
  --out DIR     where to write them (default maps-out/)
  --help        this text`;

function parseArgs(argv) {
  const opts = { what: [], set: '', count: 1, scale: 4, out: join(root, 'maps-out'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--set') opts.set = argv[++i];
    else if (a === '--count') opts.count = Math.max(1, Math.round(Number(argv[++i])));
    else if (a === '--scale') opts.scale = Math.max(1, Math.min(12, Math.round(Number(argv[++i]))));
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a} (try --help)`);
    else opts.what.push(a);
  }
  return opts;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** A minimal PNG encoder: 8-bit RGBA, no filtering. */
function png({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.what.length === 0) return console.log(HELP);
  const tool = (await runnerImport(join(root, 'src/sim/mapTool.ts'))).module;
  mkdirSync(opts.out, { recursive: true });
  for (const what of opts.what) {
    for (let n = 1; n <= opts.count; n++) {
      const settings = tool.settingsFor(what, opts.set);
      const base = settings.seed || 'map';
      if (opts.count > 1) settings.seed = `${base}-${n}`;
      const seed = settings.seed || base;
      const picture = tool.pictureFor(settings, seed, opts.scale);
      const file = join(opts.out, `${seed.replace(/[^\w.-]+/g, '_')}.png`);
      writeFileSync(file, png(picture));
      const m = settings.map;
      console.log(`${file}  (${m.size}, ${m.biome}, water ${m.water}, hills ${m.hills}, forest ${m.forest}, ${m.towns} ${m.towns === 1 ? "town" : "towns"}, ${settings.factions.length} sides)`);
    }
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
