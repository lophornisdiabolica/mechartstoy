import { App } from './app';
import * as components from './game/components';

const app = new App(document.getElementById('app')!, document.getElementById('hud')!);

// Handy for poking at things from the browser console, e.g.
// [...game.world.query(components.Producer)] lists production buildings.
Object.assign(window, { app, stage: app.stage, loop: app.loop, components });
// `game` changes with every battle, so it's a live getter rather than a copy.
Object.defineProperty(window, 'game', { get: () => app.game, configurable: true });
