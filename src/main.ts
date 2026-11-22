import { App } from './app';
import * as components from './game/components';
import { ModelViewer, viewerOptions } from './ui/modelViewer';

const params = new URLSearchParams(location.search);
if (params.has('models')) {
  // The model viewer (see ui/modelViewer.ts) instead of a battle.
  const viewer = new ModelViewer(document.getElementById('app')!, viewerOptions(params));
  document.getElementById('hud')!.hidden = true;
  Object.assign(window, { viewer });
} else {
  const app = new App(document.getElementById('app')!, document.getElementById('hud')!);

  // Handy for poking at things from the browser console, e.g.
  // [...game.world.query(components.Producer)] lists production buildings.
  Object.assign(window, { app, stage: app.stage, loop: app.loop, components });
  // `game` changes with every battle, so it's a live getter rather than a copy.
  Object.defineProperty(window, 'game', { get: () => app.game, configurable: true });
}
