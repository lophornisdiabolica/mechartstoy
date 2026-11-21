import * as THREE from 'three';
import { Construction, Shield, Transform } from '../game/components';
import { Game } from '../game/game';
import { Battlefield } from '../world/battlefield';

/** How long a dome flares where a shot bursts on it, seconds. */
const FLARE = 0.25;
/** How long a collapsing dome's shards take to fall and fade, seconds. */
const BURST = 1.3;
/** Width of the bright line where a dome meets the ground, world units, and how far over the ground it lies. */
const LINE = 0.2;
const LINE_LIFT = 0.06;
/** Points round the ground line. */
const LINE_STEPS = 48;
/** Steps out from the middle when finding where the ground leaves the dome. */
const LINE_WALK = 12;
/** How fast a weak dome pulses, radians per second: slow, a breath rather than a flicker. */
const PULSE = 3;
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
 * Aegis's energy domes (see game/shields.ts): a pale faceted bubble round
 * each emitter (a whole sphere, which the ground hides the bottom of, so
 * on a slope it reaches right down to the ground below) that's up, fainter and pinker as it weakens and pulsing
 * slowly near the end, flaring for a moment where shots burst on it, with a
 * bright line along the ground where the dome meets it (on a slope too),
 * and breaking into pink hexagonal tiles that fall in and fade when it
 * collapses. Purely visual: the domes come from each
 * emitter's Shield, which the page gets from the sim.
 */
export class Domes {
  readonly root = new THREE.Group();
  private readonly geometry = new THREE.SphereGeometry(1, 18, 14);
  /** A hexagonal tile of the dome's skin, for when it breaks up. */
  private readonly shardGeometry = new THREE.CircleGeometry(1, 6);
  private readonly shown = new Map<number, { mesh: THREE.Mesh; band: THREE.Mesh; material: THREE.MeshBasicMaterial; bandMaterial: THREE.MeshBasicMaterial; flare: number; at: string }>();
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
    d.band.geometry.dispose();
    this.shown.delete(e);
  }

  /**
   * A collapsing dome breaks into hexagonal tiles of its skin, which fall in
   * on themselves and fade: spread evenly over the sphere's skin above the
   * ground, each facing out, tipping inward and tumbling as they drop.
   */
  private shatter(x: number, y: number, z: number, radius: number): void {
    const field = this.game.field;
    const n = Math.min(MOST_SHARDS, Math.max(24, Math.round(radius * SHARDS_PER_UNIT)));
    const material = this.material();
    material.opacity = 0.45;
    // A dome breaks when it's spent, so its tiles are a weak dome's pink.
    material.color.copy(WEAK);
    const shards: Shard[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    // Even spread over the whole sphere (a spiral from bottom to top), keeping the tiles above the ground.
    const all = n * 2;
    for (let i = 0; i < all; i++) {
      const ny = -1 + (2 * (i + 0.5)) / all;
      const ring = Math.sqrt(1 - ny * ny);
      const a = i * golden;
      _n.set(Math.cos(a) * ring, ny, Math.sin(a) * ring);
      const px = x + _n.x * radius;
      const py = y + _n.y * radius;
      const pz = z + _n.z * radius;
      if (py < Math.max(field.surfaceAt(px, pz), field.seaLevel)) continue;
      const q = new THREE.Quaternion().setFromUnitVectors(_up, _n);
      const inward = 0.6 + Math.random() * 0.8;
      const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      shards.push({
        x: px,
        y: py,
        z: pz,
        vx: -_n.x * inward,
        vy: -_n.y * inward * 0.5,
        vz: -_n.z * inward,
        q,
        spin: new THREE.Quaternion().setFromAxisAngle(spinAxis, (Math.random() - 0.5) * 6),
      });
    }
    if (shards.length === 0) {
      material.dispose();
      return;
    }
    const mesh = new THREE.InstancedMesh(this.shardGeometry, material, shards.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.userData.noShadow = true;
    this.root.add(mesh);
    // Tiles about as wide as the spacing between them, so the dome first reads as a whole breaking.
    this.bursts.push({ mesh, material, age: 0, size: radius * Math.sqrt((4 * Math.PI) / all) * 0.55, shards });
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
        const band = new THREE.Mesh(groundLineGeometry(), bandMaterial);
        band.renderOrder = 3;
        band.frustumCulled = false;
        band.userData.noShadow = true;
        this.root.add(mesh, band);
        d = { mesh, band, material, bandMaterial, flare: 0, at: '' };
        this.shown.set(e, d);
      }
      const t = world.req(e, Transform);
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.scale.setScalar(s.def.radius);
      const share = Math.max(0, Math.min(1, s.hp / s.def.hp));
      d.flare = Math.max(0, d.flare - simSeconds);
      // Weak domes breathe: a slow, gentle swell and fade.
      const pulse = share < 0.3 ? 0.8 + 0.2 * Math.sin(this.time * PULSE + e) : 1;
      d.material.opacity = (0.07 + 0.11 * share + (d.flare / FLARE) * 0.25) * pulse;
      d.material.color.copy(WEAK).lerp(DOME, share);
      // The line where the dome meets the ground glows brighter than its skin.
      const at = `${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)},${s.def.radius}`;
      if (at !== d.at) {
        d.at = at;
        groundLine(d.band.geometry, this.game.field, t.x, t.y, t.z, s.def.radius);
      }
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
    this.shardGeometry.dispose();
  }
}

/** An empty strip for a dome's ground line, filled by groundLine. */
function groundLineGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((LINE_STEPS + 1) * 2 * 3), 3));
  const index: number[] = [];
  for (let i = 0; i < LINE_STEPS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(index);
  return g;
}

/**
 * Lay a dome's ground line: a thin strip on the ground along where the
 * sphere at (x, y, z) meets it. Each way out from the middle, the ground
 * leaves the sphere where it climbs through the skin above (uphill, nearer
 * the middle) or drops through the skin below (downhill, also nearer the
 * middle once the ground falls away fast enough), and the line follows that.
 */
function groundLine(g: THREE.BufferGeometry, field: Battlefield, x: number, y: number, z: number, radius: number): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const ground = (px: number, pz: number) => Math.max(field.surfaceAt(px, pz), field.seaLevel);
  for (let i = 0; i <= LINE_STEPS; i++) {
    const a = (i / LINE_STEPS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // How far inside the skin the ground is r along this way: below zero once it's out.
    const inside = (r: number) => Math.sqrt(Math.max(0, radius * radius - r * r)) - Math.abs(ground(x + c * r, z + s * r) - y);
    // Walk out to the first step where the ground is out, then halve the gap.
    let lo = 0;
    let hi = radius;
    for (let k = 1; k <= LINE_WALK; k++) {
      const r = (radius * k) / LINE_WALK;
      if (inside(r) <= 0) {
        hi = r;
        break;
      }
      lo = r;
    }
    for (let k = 0; k < 6; k++) {
      const mid = (lo + hi) / 2;
      if (inside(mid) > 0) lo = mid;
      else hi = mid;
    }
    const r = lo;
    const inner = Math.max(0, r - LINE);
    pos.setXYZ(i * 2, x + c * r, ground(x + c * r, z + s * r) + LINE_LIFT, z + s * r);
    pos.setXYZ(i * 2 + 1, x + c * inner, ground(x + c * inner, z + s * inner) + LINE_LIFT, z + s * inner);
  }
  pos.needsUpdate = true;
}
