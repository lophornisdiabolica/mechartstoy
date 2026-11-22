import * as THREE from 'three';

/**
 * Send an instanced mesh's instances to the GPU: only the first `count`
 * (the ones drawn), not its whole buffer. Pools are sized for the busiest
 * moment (wreckage keeps 16,000 slots per shape), and a plain needsUpdate
 * re-sends every slot, used or not, each time.
 */
export function uploadInstances(mesh: THREE.InstancedMesh, count = mesh.count): void {
  if (count <= 0) return;
  markRange(mesh.instanceMatrix, 0, count * 16);
  if (mesh.instanceColor) markRange(mesh.instanceColor, 0, count * 3);
}

/** Upload just this stretch of an attribute (in array elements) next time it's drawn. */
export function markRange(attribute: THREE.BufferAttribute, start: number, count: number): void {
  attribute.addUpdateRange(start, count);
  attribute.needsUpdate = true;
}
