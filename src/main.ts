import { FixedLoop } from './core/loop';
import { hashSeed } from './core/rng';
import { Faction, Unit } from './game/components';
import { FACTIONS } from './game/factions';
import { Game, SIM_HZ } from './game/game';
import { Stage } from './render/stage';

/** ?seed=anything reproduces a battlefield; without it, each load gets a fresh random seed. */
function readSeed(): string {
  return new URLSearchParams(location.search).get('seed') ?? Math.random().toString(36).slice(2, 8);
}

const container = document.getElementById('app')!;
const hud = document.getElementById('hud')!;

const seedLabel = readSeed();
const game = new Game(hashSeed(seedLabel));
const stage = new Stage(container, game);

let fps = 0;
let hudTimer = 0;
const losses = FACTIONS.map(() => 0);
game.events.on('unitDestroyed', (e) => losses[e.faction]++);

function factionLine(): string {
  const alive = FACTIONS.map(() => 0);
  for (const e of game.world.query(Unit, Faction)) alive[game.world.req(e, Faction).id]++;
  return FACTIONS.map((f) => `${f.name}: ${alive[f.id]} units, ${losses[f.id]} lost`).join('  ·  ');
}

const loop = new FixedLoop(1 / SIM_HZ, {
  step: (dt) => game.step(dt),
  render: (alpha, frameSeconds) => {
    stage.render(alpha, frameSeconds, frameSeconds * loop.timeScale);
    if (frameSeconds > 0) fps += (1 / frameSeconds - fps) * 0.05;
    hudTimer -= frameSeconds;
    if (hudTimer <= 0) {
      hudTimer = 0.5;
      hud.textContent =
        `${factionLine()}\n` +
        `seed ${seedLabel}  ·  ${Math.round(fps)} fps  ·  ${game.world.entityCount} entities\n` +
        `WASD / right-drag pan · wheel zoom · Q/E rotate · T tilt-shift · space pause`;
    }
  },
});

window.addEventListener('keydown', (e) => {
  if (e.key === ' ') loop.timeScale = loop.timeScale === 0 ? 1 : 0;
  if (e.key.toLowerCase() === 't') {
    stage.tiltShift.settings.enabled = !stage.tiltShift.settings.enabled;
    stage.tiltShift.apply();
  }
});

loop.start();

// Handy for poking at things from the browser console.
Object.assign(window, { game, stage, loop });
