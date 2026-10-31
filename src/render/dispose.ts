import * as THREE from 'three';
import { isShared } from './models';

/**
 * Free the GPU resources a subtree owns. Geometry, materials and textures
 * from the model caches are shared across battles and are left alone.
 */
export function disposeTree(root: THREE.Object3D): void {
  const done = new Set<object>();
  const free = (r: { dispose(): void } | null | undefined) => {
    if (!r || done.has(r) || isShared(r)) return;
    done.add(r);
    r.dispose();
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.geometry && !mesh.material) return;
    free(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (!m) continue;
      free((m as THREE.MeshStandardMaterial).map);
      free(m);
    }
  });
}
