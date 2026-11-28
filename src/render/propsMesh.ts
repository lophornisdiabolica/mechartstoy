import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';
import { Prop, PropKind } from '../world/props';
import { PlantMesh } from './plantLod';

interface PropStyle {
  geometry: THREE.BufferGeometry;
  /** For trees and cacti: simpler shapes for far off and for its shadow (see PlantMesh). */
  far?: THREE.BufferGeometry;
  shadow?: THREE.BufferGeometry;
  color: number;
  /** Raise the instance so the geometry's base sits on the ground. */
  baseOffset: number;
}

/**
 * How finely a plant is drawn: 'near' as it was designed, 'far' with fewer
 * sides for when it's small on screen (see PlantLod), 'shadow' for the shape
 * it casts into the shadow map. The three line up, so swapping between them
 * changes the facets and nothing else. Hidden faces (cap ends inside other
 * parts or under the ground) are left off the simpler two, except where a
 * shadow needs them: shadows are drawn from the faces turned away from the
 * sun, and for a cone that's its base.
 */
export type Detail = 'near' | 'far' | 'shadow';

export function treeGeometry(detail: Detail = 'near'): THREE.BufferGeometry {
  const near = detail === 'near';
  // (A cone's shadow comes from its base, the face turned away from the sun: only the far shape goes without.)
  const canopy = ensureNonIndexed(new THREE.ConeGeometry(0.7, 1.8, near ? 6 : 5, 1, detail === 'far'));
  canopy.translate(0, 1.2, 0);
  const trunk = ensureNonIndexed(new THREE.CylinderGeometry(0.12, 0.15, 0.5, near ? 5 : 3, 1, !near));
  trunk.translate(0, 0.25, 0);
  // Bake canopy/trunk colours into vertex colours so one instanced mesh can draw both.
  // Scaled down so trees sit at a believable size next to the units.
  return mergeNonIndexed([paint(canopy, 0xffffff), paint(trunk, 0x6b4a32)]).scale(0.65, 0.65, 0.65);
}

/**
 * A jungle tree: a tall bare trunk under a broad, lumpy crown of three
 * flattened blobs, the big one on top and two lower ones off to the sides,
 * so a jungle reads as a canopy rather than a stand of cones. Coloured here
 * (so its instance colour is near white, as a pine's), so the trunk stays brown. Far off and in its shadow, the two side
 * blobs go and the top one has fewer facets.
 */
export function jungleTreeGeometry(detail: Detail = 'near'): THREE.BufferGeometry {
  const near = detail === 'near';
  const trunk = paint(new THREE.CylinderGeometry(0.1, 0.16, 1.5, near ? 5 : 3, 1, !near).translate(0, 0.75, 0), 0x6b4a32);
  const blob = (r: number, x: number, y: number, z: number, spin: number) =>
    paint(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.55, 1).rotateY(spin).translate(x, y, z), 0x3f7f34);
  const parts = [trunk, blob(0.8, 0, 1.75, 0, 0.3)];
  if (near) parts.push(blob(0.5, 0.42, 1.38, 0.2, 1.1), blob(0.46, -0.36, 1.42, -0.3, 2.3));
  return mergeNonIndexed(parts).scale(0.65, 0.65, 0.65);
}

/**
 * A crystal monolith: a tall six-sided spire with a pointed tip, leaning a
 * little, and two shorter ones leaning out from its foot. Crystal fields'
 * "trees". Coloured by its instance colour. Far off and in its shadow, just
 * the big spire.
 */
export function monolithGeometry(detail: Detail = 'near'): THREE.BufferGeometry {
  const near = detail === 'near';
  const spire = (r: number, h: number, tilt: number, turn: number, x: number, z: number) => {
    const body = paint(new THREE.CylinderGeometry(r, r * 1.1, h, 6, 1, true).translate(0, h / 2, 0), 0xffffff);
    const tip = paint(new THREE.ConeGeometry(r, r * 1.6, 6, 1, true).translate(0, h + r * 0.8, 0), 0xffffff);
    return mergeNonIndexed([body, tip]).rotateZ(tilt).rotateY(turn).translate(x, -0.05, z);
  };
  const parts = [spire(0.34, 1.55, 0.08, 0.2, 0, 0)];
  if (near) parts.push(spire(0.2, 0.75, 0.45, 0.9, 0.3, 0.15), spire(0.17, 0.6, -0.5, 2.6, -0.25, -0.2));
  return mergeNonIndexed(parts).scale(0.65, 0.65, 0.65);
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
export function pineGeometry(snow: boolean, detail: Detail = 'near'): THREE.BufferGeometry {
  const near = detail === 'near';
  const sides = near ? 7 : 5;
  const parts: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(0.1, 0.13, 0.5, near ? 5 : 3, 1, !near).translate(0, 0.25, 0), 0x5b4030)];
  const tiers = [
    [0.75, 1.0, 0.75],
    [0.58, 0.85, 1.25],
    [0.4, 0.7, 1.7],
  ];
  for (const [r, h, y] of tiers) {
    // A tier's underside only shows from below the tree, which no camera gets to; but its shadow
    // comes from that underside (the side turned away from the sun), so the shadow shape keeps it.
    parts.push(paint(new THREE.ConeGeometry(r, h, sides, 1, detail === 'far').translate(0, y, 0), snow ? 0x3a5e4a : 0x335f3a));
    // Snow caps sit inside their tier's outline, so they cast nothing of their own.
    if (snow && detail !== 'shadow') parts.push(paint(new THREE.ConeGeometry(r * 0.55, h * 0.45, sides, 1, !near).translate(0, y + h * 0.29, 0), 0xf4f8fa));
  }
  return mergeNonIndexed(parts).scale(0.7, 0.7, 0.7);
}

/**
 * A saguaro-ish cactus: a ribbed column with two arms, each a short
 * horizontal branch out of the trunk, a rounded elbow, and an upright limb.
 * Coloured by its instance colour. Far off, the arms are plain bent
 * columns; its shadow is just the four columns' outlines.
 */
export function cactusGeometry(detail: Detail = 'near'): THREE.BufferGeometry {
  const green = 0xffffff;
  if (detail !== 'near') {
    const far = detail === 'far';
    const sides = far ? 4 : 3;
    /** An arm, as a branch out of the trunk and one column for the elbow, limb and its rounded top. */
    const arm = (dir: number, y: number, reach: number, rise: number, r: number) => {
      const bottom = y - r * 0.5;
      const top = y + rise + r * 0.6;
      return [
        paint(new THREE.CylinderGeometry(r, r * 1.1, reach, sides, 1, true).rotateZ(Math.PI / 2).translate((dir * reach) / 2, y, 0), green),
        paint(new THREE.CylinderGeometry(r * 0.95, r, top - bottom, sides, 1, !far).translate(dir * reach, (top + bottom) / 2, 0), green),
      ];
    };
    const parts = [paint(new THREE.CylinderGeometry(0.16, 0.19, 1.34, far ? 5 : 4, 1, true).translate(0, 0.67, 0), green)];
    if (far) parts.push(paint(new THREE.SphereGeometry(0.16, 5, 2, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.34, 0), green));
    else parts.push(paint(new THREE.ConeGeometry(0.16, 0.16, 4, 1, true).translate(0, 1.42, 0), green));
    return mergeNonIndexed([...parts, ...arm(1, 0.72, 0.38, 0.5, 0.1), ...arm(-1, 0.95, 0.33, 0.38, 0.09)]).scale(0.8, 0.8, 0.8);
  }
  /** An arm on side `dir` (1 right, -1 left): out of the trunk at `y`, turning up at `reach` from its middle. */
  const arm = (dir: number, y: number, reach: number, rise: number, r: number) => [
    // The branch, from inside the trunk out to the elbow.
    paint(new THREE.CylinderGeometry(r, r * 1.1, reach, 6).rotateZ(Math.PI / 2).translate((dir * reach) / 2, y, 0), green),
    paint(new THREE.SphereGeometry(r, 6, 4).translate(dir * reach, y, 0), green),
    // The limb, standing on the elbow.
    paint(new THREE.CylinderGeometry(r * 0.95, r, rise, 6).translate(dir * reach, y + rise / 2, 0), green),
    paint(new THREE.SphereGeometry(r * 0.95, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(dir * reach, y + rise, 0), green),
  ];
  return mergeNonIndexed([
    // The trunk and its rounded top, 1.5 tall as before (woodsMesh's CACTUS_HEIGHT).
    paint(new THREE.CylinderGeometry(0.16, 0.19, 1.34, 7).translate(0, 0.67, 0), green),
    paint(new THREE.SphereGeometry(0.16, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.34, 0), green),
    ...arm(1, 0.72, 0.38, 0.5, 0.1),
    ...arm(-1, 0.95, 0.33, 0.38, 0.09),
  ]).scale(0.8, 0.8, 0.8);
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

/** A cluster of crystals: long six-sided prisms with pointed tips, leaning out from one root, faintly lit from within. */
function crystalGeometry(): THREE.BufferGeometry {
  const shard = (len: number, r: number, tiltX: number, tiltZ: number, hex: number) => {
    const body = new THREE.CylinderGeometry(r, r, len, 6).translate(0, len / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6).translate(0, len + r * 1.1, 0);
    return [paint(body.rotateX(tiltX).rotateZ(tiltZ), hex), paint(tip.rotateX(tiltX).rotateZ(tiltZ), hex)];
  };
  return mergeNonIndexed([
    ...shard(1.3, 0.16, 0, 0, 0xd8c8ff),
    ...shard(0.9, 0.13, 0.45, 0.2, 0xb8a8f0),
    ...shard(0.7, 0.11, -0.35, -0.4, 0xe6dcff),
    ...shard(0.5, 0.1, 0.1, 0.6, 0xa898e8),
  ]);
}

/** A heap of junk: a rusted panel, a drum and a girder, half buried. */
function junkGeometry(): THREE.BufferGeometry {
  return mergeNonIndexed([
    paint(new THREE.BoxGeometry(0.9, 0.12, 0.6).rotateZ(0.35).translate(0, 0.2, 0), 0x9a5a3a),
    paint(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 7).rotateX(Math.PI / 2).translate(0.35, 0.18, 0.25), 0x6d7b86),
    paint(new THREE.BoxGeometry(1.1, 0.12, 0.12).rotateY(0.7).translate(-0.15, 0.1, -0.2), 0x5a524a),
    paint(new THREE.BoxGeometry(0.35, 0.3, 0.35).rotateY(0.3).translate(-0.35, 0.15, 0.25), 0x8a6a4a),
  ]);
}

/** A geyser's vent: a low mineral-crusted cone with a dark mouth and a pale rim (see world/traits.ts). */
function ventGeometry(): THREE.BufferGeometry {
  return mergeNonIndexed([
    paint(new THREE.CylinderGeometry(0.55, 1.3, 0.35, 9).translate(0, 0.12, 0), 0xc9b98a),
    paint(new THREE.CylinderGeometry(0.4, 0.55, 0.12, 9).translate(0, 0.33, 0), 0xe6dfc8),
    paint(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 9).translate(0, 0.4, 0), 0x2a2622),
  ]);
}

/** An ancient column lying where it fell, in drums (see world/traits.ts). */
function fallenColumnGeometry(): THREE.BufferGeometry {
  const stone = 0xd8cfb8;
  const drum = (x: number, turn: number) => paint(new THREE.CylinderGeometry(0.42, 0.42, 0.95, 10).rotateZ(Math.PI / 2).rotateY(turn).translate(x, 0.38, turn * 0.6), stone);
  return mergeNonIndexed([drum(-1, 0), drum(0, 0.05), drum(1.05, 0.25), paint(new THREE.BoxGeometry(0.95, 0.3, 0.95).translate(-1.9, 0.15, -0.1), 0xc6bda6)]);
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

/** How far the ground can drop under a plant before it's torn out (a quake, the land brush, a crater). */
const UPROOT_DROP = 0.3;

/**
 * Scenery is drawn with one InstancedMesh per prop kind, so hundreds cost a
 * couple of draw calls. When the ground under a prop moves, rocks go with it
 * (sinking into a crater or under the water); plants follow ground that rises
 * but are gone once the ground drops away from them or floods. Trees and
 * cacti have simpler shapes for zoomed out and for their shadows (see
 * PlantMesh): call `userData.setFar` each frame. Stops listening when
 * `dispose` (on the returned group's userData) is called.
 */
export function buildProps(field: Battlefield, props: Prop[], rng: Rng): THREE.Group {
  // Geometry is built only for the kinds this map has.
  const styles: Record<PropKind, () => PropStyle> = {
    tree: () => ({ geometry: treeGeometry(), far: treeGeometry('far'), shadow: treeGeometry('shadow'), color: 0x4f7a3c, baseOffset: -0.05 }),
    pine: () => ({ geometry: pineGeometry(false), far: pineGeometry(false, 'far'), shadow: pineGeometry(false, 'shadow'), color: 0xffffff, baseOffset: -0.05 }),
    snowPine: () => ({ geometry: pineGeometry(true), far: pineGeometry(true, 'far'), shadow: pineGeometry(true, 'shadow'), color: 0xffffff, baseOffset: -0.05 }),
    cactus: () => ({ geometry: cactusGeometry(), far: cactusGeometry('far'), shadow: cactusGeometry('shadow'), color: 0x5f8a4a, baseOffset: -0.05 }),
    shrub: () => ({ geometry: shrubGeometry(), color: 0x8a8a52, baseOffset: 0 }),
    deadTree: () => ({ geometry: deadTreeGeometry(), color: 0x7a6250, baseOffset: -0.05 }),
    rock: () => ({ geometry: rockGeometry(), color: 0x8d877c, baseOffset: 0.1 }),
    crystal: () => ({ geometry: crystalGeometry(), color: 0xffffff, baseOffset: -0.1 }),
    junk: () => ({ geometry: junkGeometry(), color: 0xffffff, baseOffset: -0.05 }),
    vent: () => ({ geometry: ventGeometry(), color: 0xffffff, baseOffset: -0.05 }),
    fallenColumn: () => ({ geometry: fallenColumnGeometry(), color: 0xffffff, baseOffset: -0.1 }),
  };
  const group = new THREE.Group();
  group.name = 'props';
  const dummy = new THREE.Object3D();
  /** Each drawn prop: its mesh and instance, the height it stands at now, and whether it's been torn out. */
  interface Drawn {
    prop: Prop;
    mesh: THREE.InstancedMesh;
    instance: number;
    offset: number;
    y: number;
    /** The highest the ground under it has been (a land brush lowers it a little at a time). */
    root: number;
    gone: boolean;
    /** Knocked flat with the dense forest round it (see woods.ts): which way it lies, or null standing. */
    down: number | null;
  }
  /** The drawn props by map cell, so a change to some cells finds its props quickly. */
  const byCell = new Map<number, Drawn[]>();
  /** The kinds drawn with near and far shapes (see PlantMesh), for setFar. */
  const plants: PlantMesh[] = [];
  const bounds = (mesh: THREE.InstancedMesh) => {
    const lod = plants.find((p) => p.mesh === mesh);
    if (lod) lod.computeBounds();
    else mesh.computeBoundingSphere();
  };
  const { cols } = field.config;
  const place = (d: Drawn) => {
    if (d.down === null) {
      dummy.position.set(d.prop.x, d.y + d.offset * d.prop.scale, d.prop.z);
      dummy.rotation.set(0, d.prop.rotation, 0);
    } else {
      dummy.position.set(d.prop.x, d.y + 0.08, d.prop.z);
      dummy.rotation.set(0, -d.down, -Math.PI / 2 + 0.1, 'YXZ');
    }
    dummy.scale.setScalar(d.gone ? 0 : d.prop.scale);
    dummy.updateMatrix();
    d.mesh.setMatrixAt(d.instance, dummy.matrix);
  };

  for (const kind of Object.keys(styles) as PropKind[]) {
    const list = props.filter((p) => p.kind === kind);
    if (list.length === 0) continue;
    const style = styles[kind]();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    const lod = style.far && style.shadow ? new PlantMesh({ near: style.geometry, far: style.far, shadow: style.shadow }, material, list.length) : null;
    if (lod) plants.push(lod);
    const mesh = lod?.mesh ?? new THREE.InstancedMesh(style.geometry, material, list.length);
    const base = new THREE.Color(style.color);
    list.forEach((p, i) => {
      const d: Drawn = { prop: p, mesh, instance: i, offset: style.baseOffset, y: p.y, root: p.y, gone: false, down: null };
      place(d);
      mesh.setColorAt(i, base.clone().offsetHSL(rng.range(-0.03, 0.03), 0, rng.range(-0.06, 0.06)));
      const [ci, cj] = field.cellAt(p.x, p.z);
      const key = cj * cols + ci;
      let cell = byCell.get(key);
      if (!cell) byCell.set(key, (cell = []));
      cell.push(d);
    });
    if (lod) {
      lod.computeBounds();
      group.add(...lod.objects);
    } else {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  const stop = field.onChange((area) => {
    const moved = new Set<THREE.InstancedMesh>();
    // A cell's corners are shared with its neighbours, so look one cell further out.
    for (let j = area.j0 - 1; j <= area.j1 + 1; j++) {
      for (let i = area.i0 - 1; i <= area.i1 + 1; i++) {
        if (i < 0 || i >= cols) continue;
        for (const d of byCell.get(j * cols + i) ?? []) {
          if (d.gone) continue;
          const h = field.heightAt(d.prop.x, d.prop.z);
          if (Math.abs(h - d.y) < 1e-4) continue;
          if (d.prop.kind !== 'rock' && (h < d.root - UPROOT_DROP || h < field.seaLevel + 0.05)) d.gone = true;
          d.y = h;
          d.root = Math.max(d.root, h);
          place(d);
          moved.add(d.mesh);
        }
      }
    }
    for (const mesh of moved) {
      mesh.instanceMatrix.needsUpdate = true;
      bounds(mesh);
    }
  });
  // Small trees a big dense-forest tree falls across go down with it, the way it fell. (Driving
  // through ordinary woods leaves them be: only the dense forest's own falling trees do this.)
  const knock = (k: number) => {
    const t = field.woods.trees[k];
    if (t.fell === null) return;
    const len = FALLEN_REACH * t.size;
    const ex = t.x + Math.cos(t.fell) * len;
    const ez = t.z + Math.sin(t.fell) * len;
    const [i0, j0] = field.cellAt(Math.min(t.x, ex) - 1.5, Math.min(t.z, ez) - 1.5);
    const [i1, j1] = field.cellAt(Math.max(t.x, ex) + 1.5, Math.max(t.z, ez) + 1.5);
    const moved = new Set<THREE.InstancedMesh>();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const d of byCell.get(j * cols + i) ?? []) {
          if (d.gone || d.down !== null || d.prop.kind === 'rock' || d.prop.kind === 'shrub') continue;
          if (segmentDistance(d.prop.x, d.prop.z, t.x, t.z, ex, ez) > KNOCK_REACH) continue;
          // Not quite the same way, so a row of them doesn't lie in lockstep.
          d.down = t.fell + (((d.instance * 7) % 5) - 2) * 0.15;
          place(d);
          moved.add(d.mesh);
        }
      }
    }
    for (const mesh of moved) mesh.instanceMatrix.needsUpdate = true;
  };
  for (let k = 0; k < field.woods.trees.length; k++) knock(k);
  const stopFell = field.woods.onFell(knock);
  group.userData.setFar = (far: boolean) => {
    for (const p of plants) p.setFar(far);
  };
  group.userData.dispose = () => {
    stop();
    stopFell();
  };
  return group;
}

/** How far a fallen dense-forest tree reaches along the ground at size 1, and how close to it a small tree goes down too. */
const FALLEN_REACH = 3;
const KNOCK_REACH = 1.2;

function segmentDistance(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

function ensureNonIndexed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return g.index ? g.toNonIndexed() : g;
}
