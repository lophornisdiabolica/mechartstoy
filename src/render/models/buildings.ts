import * as THREE from 'three';
import { box, cylinder, factionColors, gableRoof, glowBox, registerModel, setRig } from '../models';

/**
 * Low-poly building models, built facing +x (the front door side) and sized
 * to roughly fill their BuildingDef radius.
 */

const DARK = 0x2b2b2e;
const METAL = 0x7a7e85;
const CONCRETE = 0xb9b4a8;
const WALLS = [0xe8e0d0, 0xd9cfbd, 0xf0ece4, 0xcfc6b4];
const CIVIC_ROOFS = [0xb5654a, 0x8c4a3a, 0x6d7b86, 0x5d6b5a];
const WINDOW = 0x40525e;

const pick = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

/**
 * A random size from a handful of steps. Box geometry is cached by size, so
 * continuous random sizes would add new geometry for every building forever.
 */
const stepped = (min: number, max: number, steps = 5) => min + ((max - min) * Math.floor(Math.random() * steps)) / (steps - 1);

/** Civilian buildings get a varied roof; faction buildings use the faction colour. */
function roofColor(faction: number): number {
  return faction < 0 ? pick(CIVIC_ROOFS) : factionColors(faction).primary;
}

registerModel('bld:hq', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.6, 0.4, 5.6, CONCRETE, 0, 0.2, 0));
  g.add(box(4.4, 2.4, 4.4, WALLS[0], 0, 1.6, 0));
  g.add(box(4.5, 0.35, 4.5, primary, 0, 2.2, 0));
  g.add(box(3, 1.3, 3, secondary, -0.2, 3.45, 0));
  g.add(box(3.1, 0.2, 3.1, primary, -0.2, 4.2, 0));
  g.add(box(0.06, 1.2, 1.6, DARK, 2.2, 1.0, 0)); // doors
  for (const z of [-1.4, 1.4]) g.add(box(0.06, 0.5, 0.8, WINDOW, 2.21, 1.9, z));
  g.add(box(0.12, 2.6, 0.12, METAL, -1.0, 5.4, 0.8)); // antenna mast
  g.add(box(0.7, 0.08, 0.7, METAL, -1.0, 6.2, 0.8));
  const beacon = glowBox(0.2, 0.2, 0.2, 0xff5040);
  beacon.position.set(-1.0, 6.75, 0.8);
  g.add(beacon);
  return g;
});

registerModel('bld:barracks', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.2, 0.25, 3.0, CONCRETE, 0, 0.12, 0));
  // Long hut running front to back, door on the +x gable end.
  g.add(box(3.8, 1.3, 2.6, WALLS[1], 0, 0.9, 0));
  g.add(gableRoof(4.0, 2.9, 0.9, primary, 1.55));
  g.add(box(0.06, 0.9, 0.8, DARK, 1.91, 0.7, 0));
  for (const x of [-1.2, 0, 1.0]) {
    for (const z of [-1.31, 1.31]) g.add(box(0.5, 0.35, 0.04, WINDOW, x, 1.0, z));
  }
  return g;
});

registerModel('bld:factory', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.6, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  g.add(box(5, 2.4, 4.2, METAL, -0.2, 1.45, 0));
  // Sawtooth roof: three slanted panels.
  for (let i = 0; i < 3; i++) {
    const panel = box(1.7, 0.12, 4.2, i % 2 ? primary : secondary, -1.75 + i * 1.6, 2.95, 0);
    panel.rotation.z = 0.35;
    g.add(panel);
  }
  g.add(box(0.06, 1.9, 2.8, DARK, 2.31, 1.2, 0)); // vehicle door
  g.add(box(0.12, 0.2, 3.0, primary, 2.32, 2.25, 0));
  g.add(cylinder(0.3, 0.38, 2.2, 6, DARK, -2.0, 3.7, 1.5)); // chimney
  return g;
});

registerModel('bld:mechbay', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.4, 0.3, 4.4, CONCRETE, 0, 0.15, 0));
  g.add(box(2.6, 0.08, 2.6, DARK, 0, 0.32, 0)); // pit
  // Gantry frame with a crane beam across the top.
  for (const x of [-1.8, 1.8]) {
    for (const z of [-1.8, 1.8]) g.add(box(0.3, 4.2, 0.3, secondary, x, 2.4, z));
  }
  // Beams are a touch longer and thicker than the frame so their faces don't sit flush with the posts.
  for (const z of [-1.8, 1.8]) g.add(box(4.0, 0.3, 0.36, primary, 0, 4.4, z));
  g.add(box(0.4, 0.3, 3.9, primary, -0.4, 4.6, 0));
  g.add(box(0.3, 1.2, 0.3, METAL, -0.4, 3.85, 0));
  g.add(box(1.4, 0.8, 1.2, METAL, -0.4, 1.0, 0)); // half-built chassis
  g.add(box(0.8, 1.6, 0.25, METAL, -0.4, 0.8, 0.7));
  return g;
});

registerModel('bld:tower', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(0.75, 0.9, 1.6, 8, CONCRETE, 0, 0.8, 0));
  g.add(cylinder(0.85, 0.85, 0.2, 8, secondary, 0, 1.65, 0));
  const turret = new THREE.Group();
  turret.position.y = 1.75;
  turret.add(box(0.9, 0.55, 0.8, primary, 0, 0.3, 0));
  turret.add(box(1.0, 0.12, 0.12, DARK, 0.85, 0.35, 0.15));
  turret.add(box(1.0, 0.12, 0.12, DARK, 0.85, 0.35, -0.15));
  g.add(turret);
  return setRig(g, { turret });
});

/** An outpost's post: a small hut on a round pad, with a radio mast flying its holder's flag. */
registerModel('bld:outpost', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(1.6, 1.75, 0.25, 8, CONCRETE, 0, 0.125, 0));
  g.add(box(1.2, 0.9, 1.0, WALLS[2], -0.25, 0.7, -0.15));
  g.add(box(1.34, 0.12, 1.14, secondary, -0.25, 1.2, -0.15));
  g.add(box(0.06, 0.6, 0.4, DARK, 0.36, 0.55, -0.15)); // door
  g.add(box(0.1, 3.4, 0.1, METAL, 0.75, 1.85, 0.55)); // mast
  const flag = box(0.9, 0.55, 0.04, primary, 1.24, 3.2, 0.55);
  g.add(flag);
  const beacon = glowBox(0.16, 0.16, 0.16, 0xffd060);
  beacon.position.set(0.75, 3.63, 0.55);
  g.add(beacon);
  return setRig(g, {
    animate: ({ dt }) => {
      // The flag flutters.
      flag.userData.t = (flag.userData.t ?? Math.random() * 10) + dt;
      flag.rotation.y = Math.sin(flag.userData.t * 3) * 0.2;
    },
  });
});

/** An outpost bunker: a low concrete blockhouse with a firing slit. */
registerModel('bld:bunker', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(3.0, 1.0, 2.4, 0x9a9588, 0, 0.5, 0));
  g.add(box(3.2, 0.2, 2.6, primary, 0, 1.08, 0));
  g.add(box(0.06, 0.2, 1.4, DARK, 1.52, 0.72, 0)); // firing slit
  g.add(box(0.06, 0.7, 0.6, DARK, -1.52, 0.38, 0.5)); // back door
  return g;
});

registerModel('bld:house', (faction) => {
  const g = new THREE.Group();
  const walls = pick(WALLS);
  const h = stepped(0.9, 1.3);
  g.add(box(1.9, h, 1.5, walls, 0, h / 2, 0));
  g.add(gableRoof(2.1, 1.75, 0.7, roofColor(faction), h));
  g.add(box(0.05, 0.6, 0.4, DARK, 0.96, 0.3, 0));
  g.add(box(0.4, 0.3, 0.04, WINDOW, -0.4, h * 0.6, 0.76));
  g.add(box(0.4, 0.3, 0.04, WINDOW, -0.4, h * 0.6, -0.76));
  if (Math.random() < 0.5) g.add(box(0.25, 0.6, 0.25, 0x8a5a48, -0.5, h + 0.45, 0.4)); // chimney
  return g;
});

registerModel('bld:block', (faction) => {
  const g = new THREE.Group();
  const walls = pick(WALLS);
  const floors = 3 + Math.floor(Math.random() * 3);
  const floorH = 0.75;
  const h = floors * floorH;
  g.add(box(2.4, h, 2.4, walls, 0, h / 2, 0));
  // Window bands, slightly proud of the walls.
  for (let f = 0; f < floors; f++) {
    g.add(box(2.44, 0.28, 2.44, WINDOW, 0, f * floorH + 0.45, 0));
  }
  g.add(box(2.5, 0.15, 2.5, faction < 0 ? 0x8a8478 : factionColors(faction).primary, 0, h + 0.07, 0));
  g.add(box(0.8, 0.5, 0.8, METAL, -0.4, h + 0.4, 0.4)); // rooftop unit
  return g;
});

registerModel('bld:spire', (faction) => {
  const g = new THREE.Group();
  const accent = faction < 0 ? 0x6d7b86 : factionColors(faction).primary;
  g.add(cylinder(0.9, 1.0, 0.5, 6, CONCRETE, 0, 0.25, 0));
  g.add(cylinder(0.45, 0.75, 4.5, 6, pick(WALLS), 0, 2.75, 0));
  g.add(cylinder(0.65, 0.65, 0.5, 6, accent, 0, 4.2, 0));
  g.add(box(0.08, 1.6, 0.08, METAL, 0, 5.8, 0));
  const light = glowBox(0.16, 0.16, 0.16, 0xffd060);
  light.position.y = 6.65;
  g.add(light);
  return g;
});

registerModel('bld:silo', (faction) => {
  const g = new THREE.Group();
  const accent = faction < 0 ? pick(CIVIC_ROOFS) : factionColors(faction).primary;
  g.add(cylinder(0.85, 0.85, 2.4, 8, pick([0xd8d4cc, 0xc4c0b6, 0xb8c4c8]), 0, 1.2, 0));
  g.add(cylinder(0.05, 0.9, 0.7, 8, accent, 0, 2.75, 0));
  g.add(box(0.1, 2.4, 0.1, METAL, 0.9, 1.2, 0)); // ladder
  return g;
});

/** Charred heap built in a unit circle; Renderable.scale sizes it to the footprint. */
registerModel('rubble', () => {
  const g = new THREE.Group();
  const colors = [0x2e2a27, 0x3d3833, 0x5a544c, 0x8a8276, 0xb9b4a8];
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.75;
    const s = stepped(0.2, 0.5);
    const chunk = box(s * 1.4, s * 0.7, s, pick(colors), Math.cos(a) * r, s * 0.25, Math.sin(a) * r);
    chunk.rotation.set(Math.random() * 0.6, Math.random() * Math.PI, Math.random() * 0.6);
    g.add(chunk);
  }
  // A stub of standing wall.
  const wall = box(0.9, 0.5, 0.12, pick(WALLS), 0.2, 0.25, -0.3);
  wall.rotation.y = Math.random() * Math.PI;
  g.add(wall);
  return g;
});
