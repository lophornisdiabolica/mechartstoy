import * as THREE from 'three';
import { Construction, Shield, Transform } from '../game/components';
import { Game } from '../game/game';

/** How long a dome flares where a shot bursts on it, seconds. */
const FLARE = 0.25;
/** How long a collapsing dome takes to burst and fade, seconds. */
const BURST = 0.6;

const DOME = new THREE.Color(0x9fe3ff);
const WEAK = new THREE.Color(0xffb0c8);

/**
 * Aegis's energy domes (see game/shields.ts): a pale faceted bubble over
 * each emitter that's up, fainter and pinker as it weakens and flickering
 * near the end, flaring for a moment where shots burst on it, and bursting
 * outward when it collapses. Purely visual: the domes come from each
 * emitter's Shield, which the page gets from the sim.
 */
export class Domes {
  readonly root = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly shown = new Map<number, { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; flare: number }>();
  private readonly bursts: { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial; age: number; radius: number }[] = [];
  private readonly stops: (() => void)[] = [];
  private time = 0;

  constructor(private readonly game: Game) {
    this.root.name = 'domes';
    this.stops.push(
      game.events.on('shieldHit', (h) => {
        const d = this.shown.get(h.entity);
        if (d) d.flare = FLARE;
      }),
      game.events.on('shieldDown', (h) => {
        const d = this.shown.get(h.entity);
        if (d) this.drop(h.entity);
        const material = this.material();
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.position.set(h.x, h.y, h.z);
        mesh.scale.setScalar(h.radius);
        this.root.add(mesh);
        this.bursts.push({ mesh, material, age: 0, radius: h.radius });
      }),
    );
  }

  private material(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color: DOME, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  }

  private drop(e: number): void {
    const d = this.shown.get(e);
    if (!d) return;
    this.root.remove(d.mesh);
    d.material.dispose();
    this.shown.delete(e);
  }

  update(simSeconds: number): void {
    this.time += simSeconds;
    const world = this.game.world;
    const seen = new Set<number>();
    for (const e of world.query(Shield, Transform)) {
      const s = world.req(e, Shield);
      if (s.downUntil !== -Infinity || world.has(e, Construction)) continue;
      seen.add(e);
      let d = this.shown.get(e);
      if (!d) {
        const material = this.material();
        const mesh = new THREE.Mesh(this.geometry, material);
        mesh.renderOrder = 3;
        mesh.userData.noShadow = true;
        this.root.add(mesh);
        d = { mesh, material, flare: 0 };
        this.shown.set(e, d);
      }
      const t = world.req(e, Transform);
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.scale.setScalar(s.def.radius);
      const share = Math.max(0, Math.min(1, s.hp / s.def.hp));
      d.flare = Math.max(0, d.flare - simSeconds);
      // Weak domes flicker.
      const flicker = share < 0.3 ? 0.6 + 0.4 * Math.abs(Math.sin(this.time * 23 + e)) : 1;
      d.material.opacity = (0.07 + 0.11 * share + (d.flare / FLARE) * 0.25) * flicker;
      d.material.color.copy(WEAK).lerp(DOME, share);
    }
    for (const e of [...this.shown.keys()]) if (!seen.has(e)) this.drop(e);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += simSeconds;
      const f = Math.min(1, b.age / BURST);
      b.mesh.scale.setScalar(b.radius * (1 + 0.35 * f));
      b.material.opacity = 0.35 * (1 - f);
      if (f >= 1) {
        this.root.remove(b.mesh);
        b.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const stop of this.stops) stop();
    for (const e of [...this.shown.keys()]) this.drop(e);
    for (const b of this.bursts) b.material.dispose();
    this.bursts.length = 0;
    this.geometry.dispose();
  }
}
