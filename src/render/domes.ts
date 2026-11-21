import * as THREE from 'three';
import { Construction, Shield, Transform } from '../game/components';
import { Game } from '../game/game';

/** How long a dome flares where a shot bursts on it, seconds. */
const FLARE = 0.25;
/** How long a collapsing dome's shards take to fall and fade, seconds. */
const BURST = 1.3;
/** Height of the bright band where a dome meets the ground, world units. */
const BAND = 0.35;
/** Shards a collapsing dome breaks into, per unit of radius (and at most). */
const SHARDS_PER_UNIT = 9;
const MOST_SHARDS = 140;
const GRAVITY = 9;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = new THREE.Vector3();
const _up = new THREE.Vector3(0, 0, 1);

interface Shard {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Which way the shard faces (out from the dome), and how it tumbles as it falls. */
  q: THREE.Quaternion;
  spin: THREE.Quaternion;
}

const DOME = new THREE.Color(0x9fe3ff);
const WEAK = new THREE.Color(0xffb0c8);

/**
 * Aegis's energy domes (see game/shields.ts): a pale faceted bubble over
 * each emitter that's up, fainter and pinker as it weakens and flickering
 * near the end, flaring for a moment where shots burst on it, with a bright band
 * where it meets the ground, and breaking into hexagonal tiles that fall
 * in and fade when it collapses. Purely visual: the domes come from each
 * emitter's Shield, which the page gets from the sim.
 */
export class Domes {
  readonly root = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  /** The bright band round the foot of a dome, so where it stands reads at a glance. */
  private readonly bandGeometry = new THREE.CylinderGeometry(1, 1, BAND, 36, 1, true).translate(0, BAND / 2, 0);
  /** A hexagonal tile of the dome's skin, for when it breaks up. */
  private readonly shardGeometry = new THREE.CircleGeometry(1, 6);
  private readonly shown = new Map<number, { mesh: THREE.Mesh; band: THREE.Mesh; material: THREE.MeshBasicMaterial; bandMaterial: THREE.MeshBasicMaterial; flare: number }>();
  private readonly bursts: { mesh: THREE.InstancedMesh; material: THREE.MeshBasicMaterial; age: number; size: number; shards: Shard[] }[] = [];
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
        this.shatter(h.x, h.y, h.z, h.radius);
      }),
    );
  }

  private material(): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color: DOME, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  }

  private drop(e: number): void {
    const d = this.shown.get(e);
    if (!d) return;
    this.root.remove(d.mesh, d.band);
    d.material.dispose();
    d.bandMaterial.dispose();
    this.shown.delete(e);
  }

  /**
   * A collapsing dome breaks into hexagonal tiles of its skin, which fall in
   * on themselves and fade: spread evenly over the half sphere, each facing
   * out, tipping inward and tumbling as they drop.
   */
  private shatter(x: number, y: number, z: number, radius: number): void {
    const n = Math.min(MOST_SHARDS, Math.max(24, Math.round(radius * SHARDS_PER_UNIT)));
    const material = this.material();
    material.opacity = 0.45;
    const mesh = new THREE.InstancedMesh(this.shardGeometry, material, n);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.userData.noShadow = true;
    const shards: Shard[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      // Even spread over the half sphere: a spiral up from the rim.
      const ny = (i + 0.5) / n;
      const ring = Math.sqrt(1 - ny * ny);
      const a = i * golden;
      _n.set(Math.cos(a) * ring, ny, Math.sin(a) * ring);
      const q = new THREE.Quaternion().setFromUnitVectors(_up, _n);
      const inward = 0.6 + Math.random() * 0.8;
      const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      shards.push({
        x: x + _n.x * radius,
        y: y + _n.y * radius,
        z: z + _n.z * radius,
        vx: -_n.x * inward,
        vy: -_n.y * inward * 0.5,
        vz: -_n.z * inward,
        q,
        spin: new THREE.Quaternion().setFromAxisAngle(spinAxis, (Math.random() - 0.5) * 6),
      });
    }
    this.root.add(mesh);
    // Tiles about as wide as the spacing between them, so the dome first reads as a whole breaking.
    this.bursts.push({ mesh, material, age: 0, size: radius * Math.sqrt((2 * Math.PI) / n) * 0.55, shards });
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
        const bandMaterial = this.material();
        const band = new THREE.Mesh(this.bandGeometry, bandMaterial);
        band.renderOrder = 3;
        band.userData.noShadow = true;
        this.root.add(mesh, band);
        d = { mesh, band, material, bandMaterial, flare: 0 };
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
      // The foot of the dome glows brighter than its skin, a little under the ground so it never floats.
      d.band.position.set(t.x, t.y - 0.1, t.z);
      d.band.scale.set(s.def.radius, 1, s.def.radius);
      d.bandMaterial.opacity = Math.min(0.85, d.material.opacity * 3.2);
      d.bandMaterial.color.copy(d.material.color);
    }
    for (const e of [...this.shown.keys()]) if (!seen.has(e)) this.drop(e);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += simSeconds;
      const f = Math.min(1, b.age / BURST);
      const dt = simSeconds;
      b.shards.forEach((sh, i) => {
        sh.vy -= GRAVITY * dt;
        sh.x += sh.vx * dt;
        sh.y += sh.vy * dt;
        sh.z += sh.vz * dt;
        sh.q.multiply(_q.identity().slerp(sh.spin, dt));
        // Each tile shrinks away as it falls.
        _s.setScalar(b.size * (1 - 0.7 * f));
        _m.compose(_p.set(sh.x, sh.y, sh.z), sh.q, _s);
        b.mesh.setMatrixAt(i, _m);
      });
      b.mesh.instanceMatrix.needsUpdate = true;
      b.material.opacity = 0.45 * (1 - f * f);
      if (f >= 1) {
        this.root.remove(b.mesh);
        b.material.dispose();
        b.mesh.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const stop of this.stops) stop();
    for (const e of [...this.shown.keys()]) this.drop(e);
    for (const b of this.bursts) {
      b.material.dispose();
      b.mesh.dispose();
    }
    this.bursts.length = 0;
    this.geometry.dispose();
    this.bandGeometry.dispose();
    this.shardGeometry.dispose();
  }
}
