import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield, Bridge, Road } from '../world/battlefield';
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
  // Scrap and the like show through (roads laid as roads are drawn as strips on top instead).
  const ground = GROUND_DEFS[GROUND_IDS[field.ground[cell]]];
  if (ground.tint > 0 && !field.roadCell[cell]) c.lerp(new THREE.Color(ground.color), ground.tint);
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
  for (const bridge of field.bridges) {
    const mesh = buildBridge(field, bridge);
    mesh.visible = !bridge.gone;
    bridges.add(mesh);
  }
  const roads = new THREE.Group();
  roads.name = 'roads';
  /** Each road's strip, by its index in field.roads (null where nothing of it is drawn). */
  const roadMeshes: (THREE.Mesh | null)[] = [];
  const drawRoad = (k: number) => {
    const old = roadMeshes[k];
    if (old) {
      roads.remove(old);
      old.geometry.dispose();
      (old.material as THREE.Material).dispose();
    }
    roadMeshes[k] = buildRoad(field, field.roads[k]);
    if (roadMeshes[k]) roads.add(roadMeshes[k]);
  };
  field.roads.forEach((_, k) => drawRoad(k));
  group.add(groundMesh, buildSkirt(field), buildWater(field), bridges, roads);

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
    // Engineers' bridges come down.
    for (let k = 0; k < drawnBridges; k++) if (field.bridges[k]?.gone && bridges.children[k]?.visible) bridges.children[k].visible = false;
    // Roads follow the ground, so redraw any the ground under moved (and draw new ones).
    field.roads.forEach((r, k) => {
      const touched = k >= roadMeshes.length || r.points.some((p) => {
        const [i, j] = field.cellAt(p.x, p.z);
        return i >= area.i0 - 2 && i <= area.i1 + 2 && j >= area.j0 - 2 && j <= area.j1 + 2;
      });
      if (touched) drawRoad(k);
    });
    while (roadMeshes.length > field.roads.length) {
      const gone = roadMeshes.pop();
      if (gone) {
        roads.remove(gone);
        gone.geometry.dispose();
        (gone.material as THREE.Material).dispose();
      }
    }
  });
  group.userData.dispose = stop;
  return group;
}

/** The ground mesh's own height at a point: the plane of the triangle it's in (heightAt blends the four corners, which isn't quite the same). */
function meshHeightAt(field: Battlefield, x: number, z: number): number {
  const { cellSize, cols, rows } = field.config;
  const gx = Math.max(0, Math.min(cols - 1e-6, (x - field.bounds.minX) / cellSize));
  const gz = Math.max(0, Math.min(rows - 1e-6, (z - field.bounds.minZ) / cellSize));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const h00 = field.vertexHeight(i, j);
  const h10 = field.vertexHeight(i + 1, j);
  const h01 = field.vertexHeight(i, j + 1);
  const h11 = field.vertexHeight(i + 1, j + 1);
  // Same diagonals as writeCell.
  if ((i + j) % 2 === 0) return fx < fz ? h00 + (h11 - h01) * fx + (h01 - h00) * fz : h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  return fx + fz < 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

const ROAD_COLOR = 0x77736b;
const ROAD_EDGE = 0x8f8a7e;
/** How far across the road the strip samples the ground (it follows the ground's facets at these points). */
const ROAD_ACROSS = [-1, -0.6, -0.2, 0.2, 0.6, 1];
/** How far out past each edge the road's skirt reaches, and how far under the ground it ends. */
const SKIRT_OUT = 0.3;
const SKIRT_DOWN = 0.12;
/** How many samples either side of a road sample set its direction (see buildRoad). */
const TANGENT_SPAN = 2;
/** How far down a town street's ends dip, and over how long (see buildRoad). */
const END_DIP = 0.08;
const END_DIP_LENGTH = 1;

/**
 * A road as a strip draped over the ground, following its line smoothly
 * rather than the cells under it. Gaps where it crosses water (a bridge
 * deck is road enough). Null if nothing's left to draw.
 */
function buildRoad(field: Battlefield, road: Road): THREE.Mesh | null {
  // Points every half unit along the line.
  const at: { x: number; z: number }[] = [];
  for (let k = 1; k < road.points.length; k++) {
    const a = road.points[k - 1];
    const b = road.points[k];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let s = at.length === 0 ? 0 : 1; s <= steps; s++) at.push({ x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps });
  }
  // Each one's direction is the line's heading over a couple of units round it, so the rows
  // across the road turn smoothly through a bend instead of folding over each other on its inside.
  const samples = at.map((p, k) => {
    const a = at[Math.max(0, k - TANGENT_SPAN)];
    const b = at[Math.min(at.length - 1, k + TANGENT_SPAN)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x, z: p.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
  });
  const positions: number[] = [];
  const colors: number[] = [];
  const fill = new THREE.Color(ROAD_COLOR);
  const edge = new THREE.Color(ROAD_EDGE);
  const half = road.width / 2;
  const row = (p: (typeof samples)[number]) =>
    ROAD_ACROSS.map((f) => {
      const x = p.x - p.dz * half * f;
      const z = p.z + p.dx * half * f;
      return new THREE.Vector3(x, meshHeightAt(field, x, z) + 0.04, z);
    });
  const dry = (p: (typeof samples)[number]) => !field.isWater(p.x, p.z) && field.deckAt(p.x, p.z) === null;
  const lifted = samples.map(row);
  liftOverGround(field, lifted);
  // A town's main street (the one straight road: links curve) dips a touch at its ends, so the
  // link roads tucked into it there (see roads.ts) are drawn on top instead of the two fighting
  // over the overlap.
  const along = samples.length;
  if (road.points.length === 2) lifted.forEach((r, k) => {
    const fromEnd = Math.min(k, along - 1 - k) * 0.5;
    if (fromEnd < END_DIP_LENGTH) for (const v of r) v.y -= END_DIP * (1 - fromEnd / END_DIP_LENGTH);
  });
  // A skirt down each side, tucked just under the ground beside the road: where the road is lifted
  // over a crest it hides the gap under the road's edge (which showed as a dark line), and
  // elsewhere the ground covers it.
  const rows = lifted.map((r, k) => {
    const p = samples[k];
    const skirt = (v: THREE.Vector3, side: number) => {
      const x = v.x - p.dz * SKIRT_OUT * side;
      const z = v.z + p.dx * SKIRT_OUT * side;
      return new THREE.Vector3(x, Math.min(v.y, meshHeightAt(field, x, z)) - SKIRT_DOWN, z);
    };
    return [skirt(r[0], -1), ...r, skirt(r[r.length - 1], 1)];
  });
  const normals: number[] = [];
  /** The normal of the triangle a, b, c by its winding. */
  const up = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
  const last = ROAD_ACROSS.length + 1;
  for (let k = 1; k < samples.length; k++) {
    if (!dry(samples[k - 1]) || !dry(samples[k])) continue;
    const r0 = rows[k - 1];
    const r1 = rows[k];
    for (let q = 1; q <= last; q++) {
      const c = (globalThis as any).NOSH ? (q === 1 || q === last ? new THREE.Color(0xff0000) : q === 2 || q === last - 1 ? new THREE.Color(0x0000ff) : fill) : q <= 2 || q >= last - 1 ? edge : fill;
      // The skirts are shaded as the road edge beside them, so they read as more of the road's
      // edge, not as a dark slope.
      const nq = q === 1 ? 2 : q === last ? last - 1 : q;
      // Wound anticlockwise seen from above, so only the road's top is drawn: where a strip tips
      // away past the line of sight (the far side of a crest, a skirt dropping off it) its
      // underside is culled rather than drawn dark.
      const tris = [
        [r0[q - 1], r1[q], r1[q - 1]],
        [r0[q - 1], r0[q], r1[q]],
      ];
      const shade = [up(r0[nq - 1], r1[nq], r1[nq - 1]), up(r0[nq - 1], r0[nq], r1[nq])];
      tris.forEach((t, n) => {
        for (const v of t) {
          positions.push(v.x, v.y, v.z);
          colors.push(c.r, c.g, c.b);
          normals.push(shade[n].x, shade[n].y, shade[n].z);
        }
      });
    }
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}

/**
 * The road strip's corners sit on the ground, but between them the ground
 * can bulge up through it: over a hilltop, or a ridge between two of the
 * ground's triangles. Raise each quad of the strip by however far the ground
 * comes up inside it, raising the corners nearest the bulge most (a few
 * passes, as raising one quad's corners moves its neighbours').
 * Each quad is drawn as two triangles split from r0[q-1] to r1[q], as below.
 */
function liftOverGround(field: Battlefield, rows: THREE.Vector3[][]): void {
  const n = 4;
  for (let pass = 0; pass < 3; pass++) {
    const lift = rows.map((r) => r.map(() => 0));
    for (let k = 1; k < rows.length; k++) {
      for (let q = 1; q < rows[k].length; q++) {
        const a = rows[k - 1][q - 1];
        const b = rows[k][q - 1];
        const c = rows[k][q];
        const d = rows[k - 1][q];
        for (let su = 0; su <= n; su++) {
          for (let sv = 0; sv <= n; sv++) {
            // u across (a to d), v along (a to b).
            const u = su / n;
            const v = sv / n;
            const x = (a.x * (1 - u) + d.x * u) * (1 - v) + (b.x * (1 - u) + c.x * u) * v;
            const z = (a.z * (1 - u) + d.z * u) * (1 - v) + (b.z * (1 - u) + c.z * u) * v;
            // Which triangle, and how much each of its corners counts here.
            const upper = v >= u;
            const wa = upper ? 1 - v : 1 - u;
            const wm = upper ? v - u : u - v;
            const wc = upper ? u : v;
            const mid = upper ? b : d;
            const y = a.y * wa + mid.y * wm + c.y * wc;
            const poke = meshHeightAt(field, x, z) + 0.03 - y;
            if (poke <= 0) continue;
            // Raise the corners in proportion to their weight here, the least that covers the ground.
            const per = poke / (wa * wa + wm * wm + wc * wc);
            const raise = (kk: number, qq: number, w: number) => (lift[kk][qq] = Math.max(lift[kk][qq], per * w));
            raise(k - 1, q - 1, wa);
            raise(k, q, wc);
            if (upper) raise(k, q - 1, wm);
            else raise(k - 1, q, wm);
          }
        }
      }
    }
    rows.forEach((r, k) => r.forEach((p, q) => (p.y += lift[k][q])));
  }
}

/** A bridge: a concrete deck on piers, with railings, from bank to bank. */
function buildBridge(field: Battlefield, bridge: Bridge): THREE.Group {
  const g = new THREE.Group();
  const dx = bridge.bx - bridge.ax;
  const dz = bridge.bz - bridge.az;
  const length = Math.hypot(dx, dz);
  const heading = Math.atan2(-dz, dx);
  // Engineers' bridges are timber on trestles; the map's are concrete.
  const timber = bridge.builtBy !== undefined;
  const deck = new THREE.MeshStandardMaterial({ color: timber ? 0x8a6a46 : 0x9c978c, flatShading: true, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: timber ? 0x5a4630 : 0x5f5b55, flatShading: true, roughness: 0.9 });
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
