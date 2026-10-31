import * as THREE from 'three';
import { Rng } from '../core/rng';
import { Battlefield } from '../world/battlefield';

const SAND = new THREE.Color(0xd8c690);
const GRASS = new THREE.Color(0x7fa35a);
const GRASS_DARK = new THREE.Color(0x5e8446);
const ROCK = new THREE.Color(0x8a8378);
const PAD = new THREE.Color(0x9b9a86);
const SOIL = new THREE.Color(0x5a4636);
const BOARD = new THREE.Color(0x2b2622);

/** Depth of the soil cross-section shown at the edge of the board. */
const SKIRT_BOTTOM = -3;

function faceColor(field: Battlefield, cx: number, cz: number, avgY: number, slope: number, rng: Rng): THREE.Color {
  const c = new THREE.Color();
  const sea = field.seaLevel;
  if (avgY < sea + 0.35) c.copy(SAND);
  else c.lerpColors(GRASS, GRASS_DARK, Math.min(1, (avgY - sea) / (field.config.maxHeight * 0.8)));
  if (slope > 0.55) c.lerp(ROCK, Math.min(1, (slope - 0.55) * 2.5));
  for (const site of field.baseSites) {
    const d = Math.hypot(cx - site.x, cz - site.z);
    if (d < site.radius * 0.85) c.lerp(PAD, 0.55);
  }
  // Per-face jitter gives the faceted low-poly look.
  const j = rng.range(-0.04, 0.04);
  c.offsetHSL(0, 0, j);
  return c;
}

/**
 * Builds the ground as a flat-shaded, vertex-coloured mesh, plus a soil
 * "skirt" around the edges so the map looks like a cut-out diorama board.
 */
export function buildTerrain(field: Battlefield, rng: Rng): THREE.Group {
  const { cols, rows } = field.config;
  const positions: number[] = [];
  const colors: number[] = [];

  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) colors.push(color.r, color.g, color.b);
  };

  const v = (i: number, j: number) => new THREE.Vector3(field.vertexX(i), field.vertexHeight(i, j), field.vertexZ(j));

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p00 = v(i, j);
      const p10 = v(i + 1, j);
      const p01 = v(i, j + 1);
      const p11 = v(i + 1, j + 1);
      // Alternate the diagonal so the facets don't all line up.
      const flip = (i + j) % 2 === 0;
      const tris = flip
        ? [
            [p00, p01, p11],
            [p00, p11, p10],
          ]
        : [
            [p00, p01, p10],
            [p10, p01, p11],
          ];
      for (const [a, b, c] of tris) {
        const cx = (a.x + b.x + c.x) / 3;
        const cz = (a.z + b.z + c.z) / 3;
        const avgY = (a.y + b.y + c.y) / 3;
        const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        const slope = Math.sqrt(1 - normal.y * normal.y) / Math.max(0.05, normal.y);
        pushTri(a, b, c, faceColor(field, cx, cz, avgY, slope, rng));
      }
    }
  }

  const ground = new THREE.BufferGeometry();
  ground.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ground.computeVertexNormals();
  const groundMesh = new THREE.Mesh(
    ground,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  groundMesh.receiveShadow = true;
  groundMesh.castShadow = true;

  const group = new THREE.Group();
  group.name = 'terrain';
  group.add(groundMesh, buildSkirt(field), buildWater(field));
  return group;
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
      color: 0x3f7fa8,
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
