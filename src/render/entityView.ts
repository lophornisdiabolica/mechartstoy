import * as THREE from 'three';
import { Entity, World } from '../core/ecs';
import { Armed, Construction, Faction, Renderable, Transform, Wreck } from '../game/components';
import { createModel, getRig } from './models';
import { CHARRED } from './models/units';

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface ViewEntry {
  obj: THREE.Object3D;
  lastX: number;
  lastZ: number;
  wrecked: boolean;
}

const _ahead = new THREE.Vector3();

/**
 * Mirrors ECS entities into the Three.js scene. The simulation never touches
 * Three objects; this view creates, positions, animates and removes them.
 */
export class EntityView {
  readonly root = new THREE.Group();
  private readonly entries = new Map<Entity, ViewEntry>();

  constructor(private readonly world: World) {
    this.root.name = 'entities';
    world.onDestroy((e) => this.remove(e));
  }

  /**
   * `alpha` is how far between the previous and current sim tick we are.
   * `dt` is frame time scaled by sim speed, used for animation.
   */
  sync(alpha: number, dt: number): void {
    const w = this.world;
    for (const e of w.query(Transform, Renderable)) {
      let entry = this.entries.get(e);
      const t = w.req(e, Transform);
      if (!entry) {
        const r = w.req(e, Renderable);
        const obj = createModel(r.model, w.get(e, Faction)?.id ?? 0);
        obj.scale.setScalar(r.scale);
        entry = { obj, lastX: t.px, lastZ: t.pz, wrecked: false };
        this.entries.set(e, entry);
        this.root.add(obj);
      }
      const { obj } = entry;
      const rig = getRig(obj);

      const x = t.px + (t.x - t.px) * alpha;
      const y = t.py + (t.y - t.py) * alpha;
      const z = t.pz + (t.z - t.pz) * alpha;
      if (rig?.faceVelocity) {
        // Point along the path from the previous to current sim position.
        _ahead.set(t.x - t.px, t.y - t.py, t.z - t.pz);
        if (_ahead.lengthSq() > 1e-8) obj.lookAt(_ahead.add(obj.position.set(x, y, z)));
        else obj.position.set(x, y, z);
      } else {
        obj.position.set(x, y, z);
        obj.rotation.y = lerpAngle(t.pheading, t.heading, alpha);
      }

      // Construction sites rise out of the ground.
      const construction = w.get(e, Construction);
      const scale = w.req(e, Renderable).scale;
      obj.scale.y = construction ? scale * Math.max(0.04, construction.elapsed / construction.duration) : scale;

      if (!entry.wrecked && w.has(e, Wreck)) this.makeWreck(entry);
      if (entry.wrecked) continue;

      const armed = w.get(e, Armed);
      if (rig?.turret && armed) rig.turret.rotation.y = armed.aim - obj.rotation.y;
      if (rig?.animate) {
        const moved = Math.hypot(x - entry.lastX, z - entry.lastZ);
        rig.animate({ dt, speed: dt > 0 ? moved / dt : 0 });
      }
      entry.lastX = x;
      entry.lastZ = z;
    }
  }

  get count(): number {
    return this.entries.size;
  }

  /** Burnt-out look: charred materials and a slight slump. */
  private makeWreck(entry: ViewEntry): void {
    entry.wrecked = true;
    entry.obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !mesh.userData.noShadow) mesh.material = CHARRED;
    });
    entry.obj.rotation.x = (Math.random() - 0.5) * 0.25;
    entry.obj.rotation.z = (Math.random() - 0.5) * 0.25;
    const turret = getRig(entry.obj)?.turret;
    if (turret) turret.rotation.y += (Math.random() - 0.5) * 0.8;
  }

  private remove(e: Entity): void {
    const entry = this.entries.get(e);
    if (!entry) return;
    this.root.remove(entry.obj);
    this.entries.delete(e);
    // Sprites own a per-instance material and texture view; everything else is shared.
    entry.obj.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) {
        const m = (o as THREE.Sprite).material;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
