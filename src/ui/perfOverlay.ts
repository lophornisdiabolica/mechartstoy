import * as THREE from 'three';
import { Unit } from '../game/components';
import { Game } from '../game/game';
import { Stage } from '../render/stage';
import { el } from './dom';

/** Seconds between readout updates. */
const EVERY = 0.5;

/**
 * Render and sim stats in a corner (P toggles it): frame time, sim time per
 * tick and its slowest systems, draw calls, triangles, meshes and entities.
 * For checking performance work in the browser, the way `npm run bench`
 * does headlessly. While it's showing, the sim times each system (see
 * World.profile).
 */
export class PerfOverlay {
  readonly root = el('div', { id: 'perf', hidden: '' });
  private frames = 0;
  private frameTime = 0;
  private worstFrame = 0;
  private ticks = 0;
  private tickTime = 0;
  private worstTick = 0;
  private timer = 0;
  private game: Game | null = null;

  constructor(private readonly stage: Stage) {
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    if (this.game) this.game.world.profile = this.visible ? new Map() : null;
    this.reset();
  }

  /** A new battle: profile it instead. */
  attach(game: Game): void {
    if (this.game && this.game !== game) this.game.world.profile = null;
    this.game = game;
    game.world.profile = this.visible ? new Map() : null;
    this.reset();
  }

  /** Time one sim tick. */
  step(run: () => void): void {
    if (!this.visible) return run();
    const t0 = performance.now();
    run();
    const took = performance.now() - t0;
    this.ticks++;
    this.tickTime += took;
    this.worstTick = Math.max(this.worstTick, took);
  }

  /** After each rendered frame. */
  frame(frameSeconds: number): void {
    if (!this.visible || frameSeconds <= 0) return;
    this.frames++;
    this.frameTime += frameSeconds;
    this.worstFrame = Math.max(this.worstFrame, frameSeconds);
    this.timer += frameSeconds;
    if (this.timer < EVERY) return;
    this.root.textContent = this.text();
    this.reset();
  }

  private reset(): void {
    this.frames = this.frameTime = this.worstFrame = 0;
    this.ticks = this.tickTime = this.worstTick = 0;
    this.timer = 0;
    this.game?.world.profile?.clear();
  }

  private text(): string {
    const info = this.stage.renderer.info;
    let meshes = 0;
    let instances = 0;
    this.stage.scene.traverseVisible((o) => {
      if (o instanceof THREE.InstancedMesh) {
        meshes++;
        instances += o.count;
      } else if (o instanceof THREE.Mesh) meshes++;
    });
    const ms = (v: number) => v.toFixed(1);
    const lines = [
      `frame ${ms((this.frameTime / this.frames) * 1000)} ms (worst ${ms(this.worstFrame * 1000)}) · ${Math.round(this.frames / this.frameTime)} fps`,
      `draw calls ${info.render.calls} · triangles ${Math.round(info.render.triangles / 1000)}k · meshes ${meshes} (${instances} instanced)`,
      `entity batches ${this.stage.entities?.batches ?? 0} · geometries ${info.memory.geometries} · textures ${info.memory.textures}`,
    ];
    const w = this.game?.world;
    if (w) {
      lines.push(`entities ${w.entityCount} · units ${w.count(Unit)}`);
      if (this.ticks > 0) lines.push(`sim ${ms(this.tickTime / this.ticks)} ms/tick (worst ${ms(this.worstTick)}) · ${this.ticks} ticks`);
      if (w.profile && this.ticks > 0) {
        const top = [...w.profile].sort((a, b) => b[1] - a[1]).slice(0, 5);
        lines.push(top.map(([k, v]) => `${k} ${(v / this.ticks).toFixed(2)}`).join(' · '));
      }
    }
    return lines.join('\n');
  }
}
