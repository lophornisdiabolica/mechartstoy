import * as THREE from 'three';
import { Entity, World } from '../core/ecs';
import { Faction, Renderable, Transform } from '../game/components';
import { createModel } from './models';

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Mirrors ECS entities into the Three.js scene. The simulation never touches
 * Three objects; this view creates, positions and removes them each frame.
 */
export class EntityView {
  readonly root = new THREE.Group();
  private readonly objects = new Map<Entity, THREE.Object3D>();

  constructor(private readonly world: World) {
    this.root.name = 'entities';
    world.onDestroy((e) => this.remove(e));
  }

  /** `alpha` is how far between the previous and current sim tick we are. */
  sync(alpha: number): void {
    const w = this.world;
    for (const e of w.query(Transform, Renderable)) {
      let obj = this.objects.get(e);
      if (!obj) {
        const r = w.req(e, Renderable);
        obj = createModel(r.model, w.get(e, Faction)?.id ?? 0);
        obj.scale.setScalar(r.scale);
        this.objects.set(e, obj);
        this.root.add(obj);
      }
      const t = w.req(e, Transform);
      obj.position.set(t.px + (t.x - t.px) * alpha, t.py + (t.y - t.py) * alpha, t.pz + (t.z - t.pz) * alpha);
      obj.rotation.y = lerpAngle(t.pheading, t.heading, alpha);
    }
  }

  get count(): number {
    return this.objects.size;
  }

  private remove(e: Entity): void {
    const obj = this.objects.get(e);
    if (!obj) return;
    this.root.remove(obj);
    this.objects.delete(e);
  }
}
