import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield, Bridge } from '../world/battlefield';
import { BIOMES } from '../world/biomes';
import { CellArea, GROUND_DEFS, GROUND_IDS } from '../world/ground';

const SOIL = new THREE.Color(0x5a4636);
const BOARD = new THREE.Color(0x2b2622);

/** Depth of the soil cross-section shown at the edge of the board. */
const SKIRT_BOTTOM = -3;

/** A steady per-face jitter in -1..1, so a face keeps its shade when its cell is redrawn. */
function jitter(i: number, j: number, t: number): number {
  let h = (i * 374761393 + j * 668265263 + t * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

/** Colours for this map's biome, as Three.js colours. */
function palette(field: Battlefield) {
  const g = BIOMES[field.config.biome].ground;
  return { shore: new THREE.Color(g.shore), low: new THREE.Color(g.low), high: new THREE.Color(g.high), rock: new THREE.Color(g.rock), pad: new THREE.Color(g.pad) };
}

function faceColor(field: Battlefield, colors: ReturnType<typeof palette>, cell: number, cx: number, cz: number, avgY: number, slope: number, shade: number): THREE.Color {
  const c = new THREE.Color();
  const sea = field.seaLevel;
  if (avgY < sea + 0.35) c.copy(colors.shore);
  else c.lerpColors(colors.low, colors.high, Math.min(1, (avgY - sea) / (field.config.maxHeight * 0.8)));
  if (slope > 0.55) c.lerp(colors.rock, Math.min(1, (slope - 0.55) * 2.5));
  for (const site of field.baseSites) {
    const d = Math.hypot(cx - site.x, cz - site.z);
    if (d < site.radius * 0.85) c.lerp(colors.pad, 0.55);
  }
  // Scrap, roads and the like show through.
  const ground = GROUND_DEFS[GROUND_IDS[field.ground[cell]]];
  if (ground.tint > 0) c.lerp(new THREE.Color(ground.color), ground.tint);
  // Per-face jitter gives the faceted low-poly look.
  c.offsetHSL(0, 0, shade * 0.04);
  return c;
}

/**
 * Builds the ground as a flat-shaded, vertex-coloured mesh, plus a soil
 * "skirt" around the edges so the map looks like a cut-out diorama board,
 * the water, and the bridges. The ground redraws the cells that change when
 * the map changes mid-battle (see Battlefield.onChange); it stops listening
 * when `dispose` (on the returned group's userData) is called.
 */
export function buildTerrain(field: Battlefield, _rng: Rng): THREE.Group {
  const { cols, rows } = field.config;
  // Two triangles per cell, three vertices each, written in cell order so a cell's vertices are easy to find.
  const positions = new Float32Array(cols * rows * 18);
  const colors = new Float32Array(cols * rows * 18);
  const colorsOf = palette(field);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  const writeCell = (i: number, j: number) => {
    const cell = j * cols + i;
    const corner = (di: number, dj: number, out: THREE.Vector3) => out.set(field.vertexX(i + di), field.vertexHeight(i + di, j + dj), field.vertexZ(j + dj));
    // Alternate the diagonal so the facets don't all line up.
    const flip = (i + j) % 2 === 0;
    const tris: [number, number][][] = flip
      ? [
          [[0, 0], [0, 1], [1, 1]],
          [[0, 0], [1, 1], [1, 0]],
        ]
      : [
          [[0, 0], [0, 1], [1, 0]],
          [[1, 0], [0, 1], [1, 1]],
        ];
    tris.forEach((tri, t) => {
      corner(tri[0][0], tri[0][1], a);
      corner(tri[1][0], tri[1][1], b);
      corner(tri[2][0], tri[2][1], c);
      const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
      const slope = Math.sqrt(1 - normal.y * normal.y) / Math.max(0.05, normal.y);
      const color = faceColor(field, colorsOf, cell, (a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3, (a.y + b.y + c.y) / 3, slope, jitter(i, j, t));
      const base = cell * 18 + t * 9;
      [a, b, c].forEach((p, v) => {
        positions.set([p.x, p.y, p.z], base + v * 3);
        colors.set([color.r, color.g, color.b], base + v * 3);
      });
    });
  };
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) writeCell(i, j);

  const ground = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  ground.setAttribute('position', posAttr);
  ground.setAttribute('color', colAttr);
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  groundMesh.name = 'ground';
  groundMesh.receiveShadow = true;
  groundMesh.castShadow = true;

  const group = new THREE.Group();
  group.name = 'terrain';
  const bridges = new THREE.Group();
  bridges.name = 'bridges';
  for (const bridge of field.bridges) bridges.add(buildBridge(field, bridge));
  group.add(groundMesh, buildSkirt(field), buildWater(field), bridges);

  let drawnBridges = field.bridges.length;
  const stop = field.onChange((area: CellArea) => {
    for (let j = Math.max(0, area.j0 - 1); j <= Math.min(rows - 1, area.j1 + 1); j++) {
      for (let i = Math.max(0, area.i0 - 1); i <= Math.min(cols - 1, area.i1 + 1); i++) writeCell(i, j);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    ground.computeVertexNormals();
    ground.computeBoundingSphere();
    for (; drawnBridges < field.bridges.length; drawnBridges++) bridges.add(buildBridge(field, field.bridges[drawnBridges]));
  });
  group.userData.dispose = stop;
  return group;
}

/** A bridge: a concrete deck on piers, with railings, from bank to bank. */
function buildBridge(field: Battlefield, bridge: Bridge): THREE.Group {
  const g = new THREE.Group();
  const dx = bridge.bx - bridge.ax;
  const dz = bridge.bz - bridge.az;
  const length = Math.hypot(dx, dz);
  const heading = Math.atan2(-dz, dx);
  const deck = new THREE.MeshStandardMaterial({ color: 0x9c978c, flatShading: true, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x5f5b55, flatShading: true, roughness: 0.9 });
  const rail = new THREE.MeshStandardMaterial({ color: 0x6c7278, flatShading: true, roughness: 0.6, metalness: 0.3 });
  // The deck in short segments that follow its height (ramps at the ends).
  const steps = Math.max(2, Math.ceil(length / 1.5));
  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    const x0 = bridge.ax + dx * t0;
    const z0 = bridge.az + dz * t0;
    const x1 = bridge.ax + dx * t1;
    const z1 = bridge.az + dz * t1;
    const y0 = field.deckAt(x0, z0) ?? field.heightAt(x0, z0);
    const y1 = field.deckAt(x1, z1) ?? field.heightAt(x1, z1);
    const seg = Math.hypot(x1 - x0, z1 - z0, y1 - y0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(seg + 0.05, 0.35, bridge.width), deck);
    slab.position.set((x0 + x1) / 2, (y0 + y1) / 2 - 0.17, (z0 + z1) / 2);
    slab.rotation.set(0, heading, Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0)), 'YXZ');
    g.add(slab);
    for (const side of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(seg + 0.05, 0.3, 0.12), rail);
      const ox = Math.sin(heading) * side * (bridge.width / 2 - 0.06);
      const oz = Math.cos(heading) * side * (bridge.width / 2 - 0.06);
      r.position.set((x0 + x1) / 2 + ox, (y0 + y1) / 2 + 0.15, (z0 + z1) / 2 + oz);
      r.rotation.copy(slab.rotation);
      g.add(r);
    }
    // Piers where the deck is over water.
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    if (s % 3 === 1 && field.isWater(mx, mz)) {
      const bottom = field.heightAt(mx, mz) - 0.3;
      const top = (y0 + y1) / 2 - 0.35;
      const pier = new THREE.Mesh(new THREE.BoxGeometry(0.7, top - bottom, bridge.width * 0.8), dark);
      pier.position.set(mx, (top + bottom) / 2, mz);
      pier.rotation.y = heading;
      g.add(pier);
    }
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}

function buildSkirt(field: Battlefield): THREE.Mesh {
  const { cols, rows } = field.config;
  const positions: number[] = [];
  // Walk the perimeter counter-clockwise (seen from above) so faces point outward.
  const ring: [number, number][] = [];
  for (let i = 0; i < cols; i++) ring.push([i, 0]);
  for (let j = 0; j < rows; j++) ring.push([cols, j]);
  for (let i = cols; i > 0; i--) ring.push([i, rows]);
  for (let j = rows; j > 0; j--) ring.push([0, j]);
  ring.push(ring[0]);

  for (let k = 0; k < ring.length - 1; k++) {
    const [i0, j0] = ring[k];
    const [i1, j1] = ring[k + 1];
    const x0 = field.vertexX(i0);
    const z0 = field.vertexZ(j0);
    const x1 = field.vertexX(i1);
    const z1 = field.vertexZ(j1);
    const y0 = field.vertexHeight(i0, j0);
    const y1 = field.vertexHeight(i1, j1);
    positions.push(x0, y0, z0, x0, SKIRT_BOTTOM, z0, x1, SKIRT_BOTTOM, z1);
    positions.push(x0, y0, z0, x1, SKIRT_BOTTOM, z1, x1, y1, z1);
  }
  const b = field.bounds;
  // Board underside, so nothing is see-through from a low angle.
  positions.push(b.minX, SKIRT_BOTTOM, b.minZ, b.maxX, SKIRT_BOTTOM, b.minZ, b.maxX, SKIRT_BOTTOM, b.maxZ);
  positions.push(b.minX, SKIRT_BOTTOM, b.minZ, b.maxX, SKIRT_BOTTOM, b.maxZ, b.minX, SKIRT_BOTTOM, b.maxZ);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const colors = new Float32Array(positions.length);
  for (let k = 0; k < positions.length; k += 3) {
    // Darken toward the bottom for a layered soil look.
    const t = Math.max(0, Math.min(1, (positions[k + 1] - SKIRT_BOTTOM) / 4));
    const c = new THREE.Color().lerpColors(BOARD, SOIL, t);
    colors.set([c.r, c.g, c.b], k);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, side: THREE.DoubleSide }),
  );
}

function buildWater(field: Battlefield): THREE.Mesh {
  const b = field.bounds;
  const geo = new THREE.PlaneGeometry(b.maxX - b.minX, b.maxZ - b.minZ);
  geo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: BIOMES[field.config.biome].water,
      transparent: true,
      opacity: 0.78,
      roughness: 0.25,
      metalness: 0.1,
    }),
  );
  water.position.y = field.seaLevel;
  water.receiveShadow = true;
  water.name = 'water';
  return water;
}
