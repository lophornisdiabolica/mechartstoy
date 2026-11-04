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

/** Bake one colour into a geometry's vertex colours, so merged parts keep their own colours in one instanced mesh. */
function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  g = ensureNonIndexed(g);
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

/** A conifer: stacked cones on a short trunk. `snow` caps each tier white. Coloured here, so its instance colour is white. */
function pineGeometry(snow: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(0.1, 0.13, 0.5, 5).translate(0, 0.25, 0), 0x5b4030)];
  const tiers = [
    [0.75, 1.0, 0.75],
    [0.58, 0.85, 1.25],
    [0.4, 0.7, 1.7],
  ];
  for (const [r, h, y] of tiers) {
    parts.push(paint(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), snow ? 0x3a5e4a : 0x335f3a));
    if (snow) parts.push(paint(new THREE.ConeGeometry(r * 0.55, h * 0.45, 7).translate(0, y + h * 0.29, 0), 0xf4f8fa));
  }
  return mergeNonIndexed(parts).scale(0.7, 0.7, 0.7);
}

/** A saguaro-ish cactus: a ribbed column with two arms. */
function cactusGeometry(): THREE.BufferGeometry {
  const green = 0xffffff;
  const parts = [
    paint(new THREE.CylinderGeometry(0.16, 0.19, 1.5, 7).translate(0, 0.75, 0), green),
    paint(new THREE.CylinderGeometry(0.1, 0.11, 0.45, 6).translate(0.3, 0.75, 0), green),
    paint(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 6).translate(0.38, 1.05, 0), green),
    paint(new THREE.CylinderGeometry(0.09, 0.1, 0.35, 6).translate(-0.27, 0.95, 0), green),
    paint(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 6).translate(-0.33, 1.2, 0), green),
  ];
  parts[1].rotateZ(Math.PI / 2).translate(0.75, 0.45, 0);
  parts[3].rotateZ(-Math.PI / 2).translate(-0.95, 0.68, 0);
  return mergeNonIndexed(parts).scale(0.8, 0.8, 0.8);
}

/** A low scrubby bush. */
function shrubGeometry(): THREE.BufferGeometry {
  return mergeNonIndexed([
    paint(new THREE.DodecahedronGeometry(0.4, 0).scale(1.2, 0.6, 1).translate(0, 0.2, 0), 0xffffff),
    paint(new THREE.DodecahedronGeometry(0.28, 0).scale(1, 0.7, 1).translate(0.3, 0.18, 0.2), 0xffffff),
  ]);
}

/** A bare, dead tree: a trunk and a few crooked branches. */
function deadTreeGeometry(): THREE.BufferGeometry {
  const wood = 0xffffff;
  const branch = (len: number, y: number, tilt: number, turn: number) =>
    paint(new THREE.CylinderGeometry(0.04, 0.06, len, 4).translate(0, len / 2, 0).rotateZ(tilt).rotateY(turn).translate(0, y, 0), wood);
  return mergeNonIndexed([
    paint(new THREE.CylinderGeometry(0.08, 0.13, 1.6, 5).translate(0, 0.8, 0), wood),
    branch(0.6, 1.0, 0.8, 0),
    branch(0.5, 1.25, -0.9, 1.2),
    branch(0.45, 1.4, 0.7, 2.6),
  ]).scale(0.75, 0.75, 0.75);
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
  // Geometry is built only for the kinds this map has.
  const styles: Record<PropKind, () => PropStyle> = {
    tree: () => ({ geometry: treeGeometry(), color: 0x4f7a3c, baseOffset: -0.05 }),
    pine: () => ({ geometry: pineGeometry(false), color: 0xffffff, baseOffset: -0.05 }),
    snowPine: () => ({ geometry: pineGeometry(true), color: 0xffffff, baseOffset: -0.05 }),
    cactus: () => ({ geometry: cactusGeometry(), color: 0x5f8a4a, baseOffset: -0.05 }),
    shrub: () => ({ geometry: shrubGeometry(), color: 0x8a8a52, baseOffset: 0 }),
    deadTree: () => ({ geometry: deadTreeGeometry(), color: 0x7a6250, baseOffset: -0.05 }),
    rock: () => ({ geometry: rockGeometry(), color: 0x8d877c, baseOffset: 0.1 }),
  };
  const group = new THREE.Group();
  group.name = 'props';
  const dummy = new THREE.Object3D();

  for (const kind of Object.keys(styles) as PropKind[]) {
    const list = props.filter((p) => p.kind === kind);
    if (list.length === 0) continue;
    const style = styles[kind]();
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
