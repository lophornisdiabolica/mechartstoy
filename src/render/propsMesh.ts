import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Prop, PropKind } from '../world/props';

interface PropStyle {
  geometry: THREE.BufferGeometry;
  color: number;
  /** Raise the instance so the geometry's base sits on the ground. */
  baseOffset: number;
}

function treeGeometry(): THREE.BufferGeometry {
  const canopy = ensureNonIndexed(new THREE.ConeGeometry(0.7, 1.8, 6));
  canopy.translate(0, 1.2, 0);
  const trunk = ensureNonIndexed(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 5));
  trunk.translate(0, 0.25, 0);
  // Bake canopy/trunk colours into vertex colours so one instanced mesh can draw both.
  const paint = (g: THREE.BufferGeometry, hex: number) => {
    const c = new THREE.Color(hex);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g;
  };
  // Scaled down so trees sit at a believable size next to the units.
  return mergeNonIndexed([paint(canopy, 0xffffff), paint(trunk, 0x6b4a32)]).scale(0.65, 0.65, 0.65);
}

function rockGeometry(): THREE.BufferGeometry {
  const g = ensureNonIndexed(new THREE.DodecahedronGeometry(0.55, 0));
  g.scale(1, 0.65, 1);
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  return g;
}

function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const parts = geos.map((g) => g.getAttribute(name).array as Float32Array);
    const merged = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      merged.set(p, offset);
      offset += p.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(merged, 3));
  }
  return out;
}

/** Scenery is drawn with one InstancedMesh per prop kind, so hundreds cost a couple of draw calls. */
export function buildProps(props: Prop[], rng: Rng): THREE.Group {
  const styles: Record<PropKind, PropStyle> = {
    tree: { geometry: treeGeometry(), color: 0x4f7a3c, baseOffset: -0.05 },
    rock: { geometry: rockGeometry(), color: 0x8d877c, baseOffset: 0.1 },
  };
  const group = new THREE.Group();
  group.name = 'props';
  const dummy = new THREE.Object3D();

  for (const kind of Object.keys(styles) as PropKind[]) {
    const list = props.filter((p) => p.kind === kind);
    if (list.length === 0) continue;
    const style = styles[kind];
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    const mesh = new THREE.InstancedMesh(style.geometry, material, list.length);
    const base = new THREE.Color(style.color);
    list.forEach((p, i) => {
      dummy.position.set(p.x, p.y + style.baseOffset * p.scale, p.z);
      dummy.rotation.set(0, p.rotation, 0);
      dummy.scale.setScalar(p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, base.clone().offsetHSL(rng.range(-0.03, 0.03), 0, rng.range(-0.06, 0.06)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function ensureNonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}
