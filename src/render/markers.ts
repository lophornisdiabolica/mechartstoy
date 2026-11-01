import * as THREE from 'three';
import { Entity } from '../core/ecs';
import { Game } from '../game/game';
import { Collider } from '../game/components';
import { EntityView } from './entityView';
import { box, factionColors, flatMaterial } from './models';

function flag(faction: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.08, 2.4, 0.08, 0x3a3a3a, 0, 1.2, 0));
  const cloth = box(0.9, 0.55, 0.04, factionColors(faction).primary, 0.47, 2.1, 0);
  g.add(cloth);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.15, 8), flatMaterial(0x5a5a5a));
  base.position.y = 0.07;
  g.add(base);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/**
 * UI markers drawn in the world: each faction's custom rally flag and a ring
 * under the selected entity. Purely visual.
 */
export class Markers {
  readonly root = new THREE.Group();
  private readonly flags: THREE.Group[];
  private readonly ring: THREE.Mesh;
  private time = 0;

  constructor(
    private readonly game: Game,
    private readonly entities: EntityView,
  ) {
    this.root.name = 'markers';
    this.flags = game.ctx.orders.map((_, f) => {
      const fl = flag(f);
      fl.visible = false;
      this.root.add(fl);
      return fl;
    });
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    this.root.add(this.ring);
  }

  update(dt: number, selected: Entity | null): void {
    this.time += dt;
    this.game.ctx.orders.forEach((orders, f) => {
      const fl = this.flags[f];
      fl.visible = orders.rally !== null;
      if (orders.rally) {
        fl.position.set(orders.rally.x, this.game.field.surfaceAt(orders.rally.x, orders.rally.z), orders.rally.z);
        // A little flutter.
        fl.children[1].rotation.y = Math.sin(this.time * 3 + f) * 0.25;
      }
    });

    const obj = selected !== null ? this.entities.objectFor(selected) : undefined;
    this.ring.visible = !!obj;
    if (obj && selected !== null) {
      const r = (this.game.world.get(selected, Collider)?.radius ?? 0.6) + 0.4;
      this.ring.position.set(obj.position.x, obj.position.y + 0.08, obj.position.z);
      this.ring.scale.setScalar(r * (1 + Math.sin(this.time * 5) * 0.05));
    }
  }
}
