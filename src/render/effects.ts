import * as THREE from 'three';
import { Entity } from '../core/ecs';
import { EventBus } from '../core/events';
import { GameEvents } from '../game/context';
import { ProjectileKind } from '../game/units';
import { Battlefield } from '../world/battlefield';

/**
 * Purely visual effects driven by game events: muzzle flashes, impacts,
 * explosions, smoke and burning wrecks. Nothing here affects the simulation,
 * so it can use Math.random freely.
 */

interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  /** Size at end of life (defaults to 0). */
  endSize?: number;
  color: THREE.ColorRepresentation;
  /** Colour at end of life; for additive particles black means fully faded. */
  endColor?: THREE.ColorRepresentation;
  gravity?: number;
  drag?: number;
}

/** Fixed-capacity particle pool drawn as one InstancedMesh. */
class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  private count = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly data: Float32Array; // age, life, size, endSize, gravity, drag
  private readonly col: Float32Array; // start rgb, end rgb
  private readonly dummy = new THREE.Object3D();
  private readonly tmp = new THREE.Color();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    private readonly capacity: number,
    private readonly field: Battlefield,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.data = new Float32Array(capacity * 6);
    this.col = new Float32Array(capacity * 6);
  }

  spawn(p: ParticleSpec): void {
    // When full, overwrite a random particle rather than dropping the newest.
    const i = this.count < this.capacity ? this.count++ : Math.floor(Math.random() * this.capacity);
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([p.vx ?? 0, p.vy ?? 0, p.vz ?? 0], i * 3);
    this.data.set([0, p.life, p.size, p.endSize ?? 0, p.gravity ?? 0, p.drag ?? 0], i * 6);
    const c0 = this.tmp.set(p.color);
    this.col.set([c0.r, c0.g, c0.b], i * 6);
    const c1 = this.tmp.set(p.endColor ?? p.color);
    this.col.set([c1.r, c1.g, c1.b], i * 6 + 3);
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      const d = i * 6;
      this.data[d] += dt;
      if (this.data[d] >= this.data[d + 1]) {
        this.swapRemove(i);
        continue;
      }
      const p = i * 3;
      const drag = Math.max(0, 1 - this.data[d + 5] * dt);
      this.vel[p] *= drag;
      this.vel[p + 1] = this.vel[p + 1] * drag - this.data[d + 4] * dt;
      this.vel[p + 2] *= drag;
      this.pos[p] += this.vel[p] * dt;
      this.pos[p + 1] += this.vel[p + 1] * dt;
      this.pos[p + 2] += this.vel[p + 2] * dt;
      // Heavy particles (debris) come to rest on the ground.
      if (this.data[d + 4] > 0) {
        const ground = this.field.surfaceAt(this.pos[p], this.pos[p + 2]);
        if (this.pos[p + 1] < ground) {
          this.pos[p + 1] = ground;
          this.vel[p] *= 0.3;
          this.vel[p + 1] = 0;
          this.vel[p + 2] *= 0.3;
        }
      }
      i++;
    }
    this.writeInstances();
  }

  private writeInstances(): void {
    for (let i = 0; i < this.count; i++) {
      const d = i * 6;
      const k = this.data[d] / this.data[d + 1];
      const size = this.data[d + 2] + (this.data[d + 3] - this.data[d + 2]) * k;
      this.dummy.position.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.dummy.scale.setScalar(Math.max(0.0001, size));
      this.dummy.rotation.set(i * 1.3, i * 0.7, 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      const c = d;
      this.tmp.setRGB(
        this.col[c] + (this.col[c + 3] - this.col[c]) * k,
        this.col[c + 1] + (this.col[c + 4] - this.col[c + 1]) * k,
        this.col[c + 2] + (this.col[c + 5] - this.col[c + 2]) * k,
      );
      this.mesh.setColorAt(i, this.tmp);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.pos.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    this.data.copyWithin(i * 6, last * 6, last * 6 + 6);
    this.col.copyWithin(i * 6, last * 6, last * 6 + 6);
  }
}

/** Something that keeps emitting smoke and flame for a while (a burning wreck or building). */
interface Burner {
  /** Building it's attached to, so it can stop when the building falls. */
  entity?: Entity;
  x: number;
  y: number;
  z: number;
  size: number;
  until: number;
  nextPuff: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

export class Effects {
  readonly root = new THREE.Group();
  private readonly flashes: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly debris: ParticlePool;
  private readonly burners: Burner[] = [];
  private time = 0;

  constructor(events: EventBus<GameEvents>, field: Battlefield) {
    this.root.name = 'effects';
    const blob = new THREE.IcosahedronGeometry(1, 0);
    this.flashes = new ParticlePool(
      blob,
      new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      600,
      field,
    );
    this.smoke = new ParticlePool(
      blob,
      new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false }),
      900,
      field,
    );
    this.debris = new ParticlePool(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ flatShading: true }), 600, field);
    this.debris.mesh.castShadow = true;
    this.root.add(this.smoke.mesh, this.debris.mesh, this.flashes.mesh);

    events.on('fired', (e) => this.muzzleFlash(e.x, e.y, e.z, e.heading, e.kind));
    events.on('impact', (e) => this.impact(e.x, e.y, e.z, e.kind, e.splash));
    events.on('unitDestroyed', (e) => this.explosion(e.x, e.y + e.def.radius * 0.6, e.z, e.def.radius, e.def.wreckTime));
    events.on('buildingDamaged', (e) => {
      this.burners.push({ entity: e.entity, x: e.x, y: e.y + e.def.radius * 0.8, z: e.z, size: e.def.radius * 0.7, until: Infinity, nextPuff: 0 });
    });
    events.on('buildingDestroyed', (e) => {
      for (let i = this.burners.length - 1; i >= 0; i--) if (this.burners[i].entity === e.entity) this.burners.splice(i, 1);
      this.collapse(e.x, e.y, e.z, e.def.radius);
    });
    events.on('constructionStarted', (e) => this.dust(e.x, e.y, e.z, e.def.radius, 10));
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    for (let i = this.burners.length - 1; i >= 0; i--) {
      const b = this.burners[i];
      if (this.time > b.until) {
        this.burners.splice(i, 1);
        continue;
      }
      if (this.time < b.nextPuff) continue;
      b.nextPuff = this.time + rand(0.15, 0.35);
      this.smoke.spawn({
        x: b.x + rand(-0.3, 0.3) * b.size,
        y: b.y,
        z: b.z + rand(-0.3, 0.3) * b.size,
        vx: rand(0.2, 0.5),
        vy: rand(0.8, 1.4),
        vz: rand(-0.2, 0.2),
        life: rand(2.5, 4),
        size: 0.25 * b.size,
        endSize: 0.9 * b.size,
        color: 0x3a3632,
        endColor: 0x8a8580,
        drag: 0.3,
      });
      if (Math.random() < 0.6) {
        this.flashes.spawn({ x: b.x, y: b.y, z: b.z, vy: 0.8, life: 0.4, size: 0.3 * b.size, color: 0xff8a30, endColor: 0x000000 });
      }
    }
    this.flashes.update(dt);
    this.smoke.update(dt);
    this.debris.update(dt);
  }

  private muzzleFlash(x: number, y: number, z: number, heading: number, kind: ProjectileKind): void {
    const big = kind === 'shell' || kind === 'artillery';
    this.flashes.spawn({
      x: x + Math.cos(heading) * 0.2,
      y,
      z: z - Math.sin(heading) * 0.2,
      life: big ? 0.15 : 0.07,
      size: big ? 0.55 : 0.2,
      color: 0xffd38a,
      endColor: 0x000000,
    });
    if (big) {
      this.smoke.spawn({ x, y, z, vx: Math.cos(heading) * 1.5, vy: 0.5, vz: -Math.sin(heading) * 1.5, life: 1.2, size: 0.3, endSize: 0.7, color: 0xb8b2a8, drag: 1.5 });
    }
  }

  private impact(x: number, y: number, z: number, kind: ProjectileKind, splash: number): void {
    if (kind === 'bullet') {
      this.flashes.spawn({ x, y, z, life: 0.1, size: 0.2 + splash * 0.2, color: 0xffe0a0, endColor: 0x000000 });
      this.smoke.spawn({ x, y, z, vy: 0.6, life: 0.6, size: 0.12, endSize: 0.3, color: 0xa89c88 });
      return;
    }
    const s = Math.max(0.8, splash);
    this.flashes.spawn({ x, y: y + 0.2, z, life: 0.25, size: 0.4 * s, endSize: 1.1 * s, color: 0xfff0c0, endColor: 0x000000 });
    for (let i = 0; i < 4; i++) {
      this.flashes.spawn({
        x,
        y: y + 0.2,
        z,
        vx: rand(-2, 2) * s,
        vy: rand(1, 3) * s,
        vz: rand(-2, 2) * s,
        life: rand(0.2, 0.4),
        size: 0.35 * s,
        color: 0xff9a40,
        endColor: 0x000000,
        drag: 4,
      });
    }
    for (let i = 0; i < 5; i++) {
      this.smoke.spawn({
        x: x + rand(-0.3, 0.3) * s,
        y: y + 0.2,
        z: z + rand(-0.3, 0.3) * s,
        vx: rand(-0.8, 0.8),
        vy: rand(0.8, 1.6),
        vz: rand(-0.8, 0.8),
        life: rand(1.2, 2.2),
        size: 0.22 * s,
        endSize: 0.6 * s,
        color: 0x6a6058,
        endColor: 0xb8b2aa,
        drag: 1.2,
      });
    }
    // Dirt clods.
    for (let i = 0; i < 4; i++) {
      this.debris.spawn({ x, y: y + 0.1, z, vx: rand(-3, 3), vy: rand(3, 6), vz: rand(-3, 3), life: rand(1, 2), size: 0.12, endSize: 0.05, color: 0x5a4636, gravity: 14 });
    }
  }

  /** A building coming down: a big blast, a dust cloud, flying masonry and a fire. */
  private collapse(x: number, y: number, z: number, radius: number): void {
    this.explosion(x, y + radius * 0.5, z, radius * 0.9, 0);
    this.dust(x, y, z, radius, 16);
    for (let i = 0; i < 10 * radius; i++) {
      this.debris.spawn({
        x: x + rand(-0.5, 0.5) * radius,
        y: y + rand(0.5, 1.5) * radius,
        z: z + rand(-0.5, 0.5) * radius,
        vx: rand(-4, 4),
        vy: rand(2, 7),
        vz: rand(-4, 4),
        life: rand(4, 8),
        size: rand(0.15, 0.35),
        endSize: 0.1,
        color: Math.random() < 0.5 ? 0xd9cfbd : 0x5a544c,
        gravity: 16,
      });
    }
    this.burners.push({ x, y: y + 0.3, z, size: radius * 0.6, until: this.time + 25, nextPuff: this.time + 0.5 });
  }

  /** Billowing pale dust ring, for collapses and construction starting. */
  private dust(x: number, y: number, z: number, radius: number, puffs: number): void {
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2;
      this.smoke.spawn({
        x: x + Math.cos(a) * radius * 0.8,
        y: y + 0.3,
        z: z + Math.sin(a) * radius * 0.8,
        vx: Math.cos(a) * rand(0.8, 1.6),
        vy: rand(0.3, 0.8),
        vz: Math.sin(a) * rand(0.8, 1.6),
        life: rand(2, 3.5),
        size: 0.4 * Math.max(1, radius * 0.5),
        endSize: 1.0 * Math.max(1, radius * 0.5),
        color: 0xb8ab94,
        endColor: 0xd8d0c0,
        drag: 0.9,
      });
    }
  }

  private explosion(x: number, y: number, z: number, size: number, burnTime: number): void {
    const s = Math.max(0.6, size * 1.6);
    this.flashes.spawn({ x, y, z, life: 0.35, size: 0.6 * s, endSize: 1.8 * s, color: 0xfff4d0, endColor: 0x000000 });
    for (let i = 0; i < 10; i++) {
      this.flashes.spawn({
        x,
        y,
        z,
        vx: rand(-3, 3) * s,
        vy: rand(1, 4) * s,
        vz: rand(-3, 3) * s,
        life: rand(0.3, 0.6),
        size: 0.45 * s,
        color: 0xff8c30,
        endColor: 0x000000,
        drag: 3,
      });
    }
    for (let i = 0; i < 10; i++) {
      this.smoke.spawn({
        x: x + rand(-0.4, 0.4) * s,
        y,
        z: z + rand(-0.4, 0.4) * s,
        vx: rand(-1, 1),
        vy: rand(1, 2.5),
        vz: rand(-1, 1),
        life: rand(2, 3.5),
        size: 0.3 * s,
        endSize: 0.8 * s,
        color: 0x4a4440,
        endColor: 0xb5b0aa,
        drag: 0.8,
      });
    }
    // Hull fragments.
    for (let i = 0; i < 8 * s; i++) {
      this.debris.spawn({
        x,
        y,
        z,
        vx: rand(-4, 4),
        vy: rand(4, 9),
        vz: rand(-4, 4),
        life: rand(3, 6),
        size: rand(0.12, 0.25) * Math.min(2, s),
        endSize: 0.05,
        color: 0x3a3836,
        gravity: 16,
      });
    }
    if (burnTime > 0) {
      this.burners.push({ x, y, z, size: s * 0.8, until: this.time + burnTime * 0.6, nextPuff: this.time + 0.3 });
    }
  }
}
