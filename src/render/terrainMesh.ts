import * as THREE from 'three';
import { disposeTree } from './dispose';
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
  const roadMeshes: (THREE.Group | null)[] = [];
  const drawRoad = (k: number) => {
    const old = roadMeshes[k];
    if (old) {
      roads.remove(old);
      disposeTree(old);
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
        disposeTree(gone);
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

/** The up-facing normal of the ground mesh's facet at (x, z) (the facet meshHeightAt reads). */
function groundNormal(field: Battlefield, x: number, z: number): THREE.Vector3 {
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
  // The facet's rise per cell across x and z, by the same diagonals as meshHeightAt.
  let sx: number;
  let sz: number;
  if ((i + j) % 2 === 0) [sx, sz] = fx < fz ? [h11 - h01, h01 - h00] : [h10 - h00, h11 - h10];
  else [sx, sz] = fx + fz < 1 ? [h10 - h00, h01 - h00] : [h11 - h01, h11 - h10];
  return new THREE.Vector3(-sx / cellSize, 1, -sz / cellSize).normalize();
}

const ROAD_COLOR = 0x77736b;
const ROAD_EDGE = 0x8f8a7e;
/** How far across the road the strip samples the ground (it follows the ground's facets at these points). */
const ROAD_ACROSS = [-1, -0.6, -0.2, 0.2, 0.6, 1];
/** How far out past each edge the road's embankment reaches at the least, and how far under the ground its foot is. */
const SKIRT_OUT = 0.3;
const SKIRT_DOWN = 0.12;
/** How far out a raised road's embankment reaches for each unit the road stands above the ground. */
const EMBANK_RUN = 1;
/**
 * How much deeper under the ground the foot goes for each unit of rise: a bank that meets the
 * ground at a shallow angle meets it along a ragged line (every little facet of the ground pokes
 * through), so it dives in a little more steeply.
 */
const EMBANK_DIVE = 0.5;
/** How far above the ground a road's end must stand to get an embankment down it too. */
const CAP_RISE = 0.08;
/** How many samples either side of a road sample set its direction (see buildRoad). */
const TANGENT_SPAN = 4;
/** The farthest apart a road's rows across get, on the straight (see buildRoad). */
const ROW_MAX = 1.5;
/** How far a road may turn (radians) before it gets another row across. */
const ROW_TURN = 0.1;
/** How far a row across may bow from a straight line to follow the ground. */
const ROW_BOW = 0.2;
/** How steeply the lift over a bump may ease off along the road (see liftOverGround). */
const LIFT_GRADE = 0.3;

/**
 * A road as a strip draped over the ground, following its line smoothly
 * rather than the cells under it. Gaps where it crosses water (a bridge
 * deck is road enough). Null if nothing's left to draw.
 */
function buildRoad(field: Battlefield, road: Road): THREE.Group | null {
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
  const dense = at.map((p, k) => {
    const a = at[Math.max(0, k - TANGENT_SPAN)];
    const b = at[Math.min(at.length - 1, k + TANGENT_SPAN)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x, z: p.z, dx: (b.x - a.x) / len, dz: (b.z - a.z) / len };
  });
  const dry = (p: (typeof dense)[number]) => !field.isWater(p.x, p.z) && field.deckAt(p.x, p.z) === null;
  let keptLast = dense[0];
  // Rows across the road only where they're needed: close together through a bend, so it stays
  // round, and up to ROW_MAX apart on the straight, so on rough ground the road is a few long
  // smooth panels rather than a sawtooth of small ones following every facet. Always where the
  // road meets water or a bridge, so its gaps are where they were.
  const samples = dense.filter((p, k) => {
    const last = keptLast;
    const turn = Math.acos(Math.max(-1, Math.min(1, p.dx * last.dx + p.dz * last.dz)));
    const ends = k === 0 || k === dense.length - 1;
    const shore = !ends && (dry(p) !== dry(dense[k - 1]) || dry(p) !== dry(dense[k + 1]));
    if (!ends && !shore && Math.hypot(p.x - last.x, p.z - last.z) + 1e-6 < ROW_MAX && turn < ROW_TURN) return false;
    keptLast = p;
    return true;
  });
  const fill = new THREE.Color(ROAD_COLOR);
  const edge = new THREE.Color(ROAD_EDGE);
  const half = road.width / 2;
  // A row across follows the ground loosely: the straight line that best fits the ground under
  // it, bowing towards the ground by at most ROW_BOW (the lift below then clears any bump left).
  const row = (p: (typeof samples)[number]) => {
    const pts = ROAD_ACROSS.map((f) => {
      const x = p.x - p.dz * half * f;
      const z = p.z + p.dx * half * f;
      return new THREE.Vector3(x, meshHeightAt(field, x, z) + 0.04, z);
    });
    const n = pts.length;
    const mf = ROAD_ACROSS.reduce((a, f) => a + f, 0) / n;
    const my = pts.reduce((a, v) => a + v.y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    ROAD_ACROSS.forEach((f, q) => {
      sxy += (f - mf) * (pts[q].y - my);
      sxx += (f - mf) * (f - mf);
    });
    const slope = sxy / sxx;
    pts.forEach((v, q) => {
      const line = my + slope * (ROAD_ACROSS[q] - mf);
      v.y = line + Math.max(-ROW_BOW, Math.min(ROW_BOW, v.y - line));
    });
    return pts;
  };
  const lifted = samples.map(row);
  // On the inside of a bend tighter than the road is wide, the rows across would cross over each
  // other and fold the strip (a sawtooth of dark, back-facing triangles). Hold a point that would
  // go backwards where the row before left it instead.
  for (let k = 1; k < lifted.length; k++) {
    const { dx, dz } = samples[k];
    lifted[k].forEach((p, q) => {
      const prev = lifted[k - 1][q];
      if ((p.x - prev.x) * dx + (p.z - prev.z) * dz < 0) p.copy(prev);
    });
  }
  liftOverGround(field, lifted);
  // Two layers: the kerb, the whole width in the edge colour, and the paving down the middle,
  // drawn after every kerb (see layerMesh). Every road's paving then covers every road's kerb, so
  // where roads fork, cross or overlap they read as one road, with kerb only round the outside.
  const kerb: Layer = { positions: [], colors: [], normals: [] };
  const paving: Layer = { positions: [], colors: [], normals: [] };
  const last = ROAD_ACROSS.length - 1;
  /**
   * A quad from row a (earlier) to row b (later), 0 the left-hand corner and 1 the right.
   * Wound anticlockwise seen from above, so only its top is drawn: where the strip tips away past
   * the line of sight (the far side of a crest, an embankment dropping off it) its underside is
   * culled rather than drawn dark.
   * Each triangle is lit as the ground facet under its middle is, flat: the road takes the light
   * and shade of the ground it lies on, facet for facet, so it reads as part of the low-poly
   * ground rather than a smooth ribbon laid over it (smoothed normals, or the strip's own, gave
   * raised roads and their banks a rounded look with a shaded edge of their own).
   */
  const quad = (a0: THREE.Vector3, a1: THREE.Vector3, b0: THREE.Vector3, b1: THREE.Vector3, paved: boolean) => {
    for (const t of [
      [a0, b1, b0],
      [a0, a1, b1],
    ]) {
      const own = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0])).normalize();
      const nv = groundNormal(field, (t[0].x + t[1].x + t[2].x) / 3, (t[0].z + t[1].z + t[2].z) / 3).add(own).normalize();
      for (const v of t) {
        kerb.positions.push(v.x, v.y, v.z);
        kerb.colors.push(edge.r, edge.g, edge.b);
        kerb.normals.push(nv.x, nv.y, nv.z);
        if (!paved) continue;
        paving.positions.push(v.x, v.y, v.z);
        paving.colors.push(fill.r, fill.g, fill.b);
        paving.normals.push(nv.x, nv.y, nv.z);
      }
    }
  };
  /**
   * The foot of the embankment below a point on the road's edge, out along (ox, oz): on the
   * ground just past the road, tucked a little under it, and farther out the more the road stands
   * over the ground (`rise`), so a raised road sits on a sloped bank (a trapezoid in section)
   * rather than on nothing.
   */
  const foot = (v: THREE.Vector3, ox: number, oz: number, rise = Math.max(0, v.y - meshHeightAt(field, v.x, v.z))) => {
    const w = SKIRT_OUT + rise * EMBANK_RUN;
    const x = v.x + ox * w;
    const z = v.z + oz * w;
    return new THREE.Vector3(x, Math.min(v.y, meshHeightAt(field, x, z)) - SKIRT_DOWN - rise * EMBANK_DIVE, z);
  };
  // How high each row's edges stand over the ground. The embankments' width runs smoothly between
  // rows from these (measured at every step, it jumped about with the ground's facets and gave the
  // bank a ragged foot).
  const rises = lifted.map((r) => [r[0], r[last]].map((v) => Math.max(0, v.y - meshHeightAt(field, v.x, v.z))));
  const drawn = (k: number) => k >= 1 && k < samples.length && dry(samples[k - 1]) && dry(samples[k]);
  for (let k = 1; k < samples.length; k++) {
    if (!drawn(k)) continue;
    const r0 = lifted[k - 1];
    const r1 = lifted[k];
    for (let q = 1; q <= last; q++) {
      quad(r0[q - 1], r0[q], r1[q - 1], r1[q], q > 1 && q < last);
    }
    // An embankment down each side, its foot following the ground every half unit or so (between
    // rows up to ROW_MAX apart the ground can dip away under the road's straight edge, and a foot
    // only at the rows left a gap under the road there, seen from low down).
    const a = samples[k - 1];
    const b = samples[k];
    for (const side of [-1, 1]) {
      const e = side < 0 ? 0 : last;
      const steps = Math.max(1, Math.ceil(r0[e].distanceTo(r1[e]) / 0.5));
      let prevTop = r0[e];
      let prevFoot: THREE.Vector3 | null = null;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const top = new THREE.Vector3().lerpVectors(r0[e], r1[e], t);
        const dx = a.dx + (b.dx - a.dx) * t;
        const dz = a.dz + (b.dz - a.dz) * t;
        const len = Math.hypot(dx, dz) || 1;
        const ri = side < 0 ? 0 : 1;
        const f = foot(top, (-dz / len) * side, (dx / len) * side, rises[k - 1][ri] + (rises[k][ri] - rises[k - 1][ri]) * t);
        if (prevFoot) {
          if (side < 0) quad(prevFoot, prevTop, f, top, false);
          else quad(prevTop, prevFoot, top, f, false);
        }
        prevTop = top;
        prevFoot = f;
      }
    }
  }
  // Where a raised road stops (at the ends of its run, and either side of water or a bridge), an
  // embankment down its end too, so from along the road there's no open underside to see.
  for (let k = 0; k < samples.length; k++) {
    const start = drawn(k + 1) && !drawn(k);
    const end = drawn(k) && !drawn(k + 1);
    if (!start && !end) continue;
    const r = lifted[k];
    if (Math.max(...r.map((v) => v.y - meshHeightAt(field, v.x, v.z))) < CAP_RISE) continue;
    const { dx, dz } = samples[k];
    const sign = start ? -1 : 1;
    // The end's own row with the side feet at its corners, and the feet out beyond it.
    const row = [foot(r[0], dz, -dx), ...r, foot(r[last], -dz, dx)];
    const toe = row.map((v, c) => (c === 0 || c === row.length - 1 ? v : foot(v, dx * sign, dz * sign)));
    for (let q = 1; q < row.length; q++) {
      const [a0, a1, b0, b1] = start ? [toe[q - 1], toe[q], row[q - 1], row[q]] : [row[q - 1], row[q], toe[q - 1], toe[q]];
      quad(a0, a1, b0, b1, false);
    }
  }
  if (kerb.positions.length === 0) return null;
  const group = new THREE.Group();
  group.name = 'road';
  group.add(layerMesh(kerb, -2, 1), layerMesh(paving, -4, 2));
  return group;
}

/** One layer of a road's strip (see buildRoad). */
interface Layer {
  positions: number[];
  colors: number[];
  normals: number[];
}

/**
 * A layer as a mesh. Kerbs are drawn after the ground and write no depth, and
 * pavings after them, so any road's paving covers any road's kerb wherever
 * they overlap, even where the two strips sit at slightly different heights.
 */
function layerMesh(layer: Layer, offset: number, order: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(layer.positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(layer.colors, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(layer.normals, 3));
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset, depthWrite: order > 1 }),
  );
  mesh.renderOrder = order;
  mesh.receiveShadow = true;
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
  for (let pass = 0; pass < 3; pass++) {
    const lift = rows.map((r) => r.map(() => 0));
    for (let k = 1; k < rows.length; k++) {
      for (let q = 1; q < rows[k].length; q++) {
        const a = rows[k - 1][q - 1];
        const b = rows[k][q - 1];
        const c = rows[k][q];
        const d = rows[k - 1][q];
        // Checked at least every 0.4 or so either way, however long the panel.
        const n = Math.max(4, Math.ceil(Math.max(a.distanceTo(b), a.distanceTo(d)) / 0.4));
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
    // Each row rises as one, by the most any of its points needs: raising single corners
    // crumpled the strip into a sawtooth of facets on rough ground.
    // and the lift eases in and out along the road (rising at most LIFT_GRADE per unit), so a
    // panel lifted over a bump doesn't stand as a step above the next.
    const most = lift.map((l) => Math.max(...l));
    const gap = (k: number) => rows[k][0].distanceTo(rows[k - 1][0]) + rows[k][rows[k].length - 1].distanceTo(rows[k - 1][rows[k].length - 1]);
    for (let k = 1; k < rows.length; k++) most[k] = Math.max(most[k], most[k - 1] - (LIFT_GRADE * gap(k)) / 2);
    for (let k = rows.length - 2; k >= 0; k--) most[k] = Math.max(most[k], most[k + 1] - (LIFT_GRADE * gap(k + 1)) / 2);
    rows.forEach((r, k) => {
      for (const p of r) p.y += most[k];
    });
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
