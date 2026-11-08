import * as THREE from 'three';
import { box, cylinder, factionColors, gableRoof, glowBox, registerModel, setRig } from '../models';
import { TownStyle } from '../../world/biomes';

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

// Doctrine signature buildings.
registerModel('bld:tankDepot', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.4, 0.25, 5.0, CONCRETE, 0, 0.12, 0));
  g.add(box(4.6, 2.4, 4.0, METAL, -0.2, 1.45, 0)); // hangar
  g.add(box(4.8, 0.3, 4.2, primary, -0.2, 2.8, 0));
  g.add(box(0.06, 1.9, 3.0, DARK, 2.11, 1.2, 0)); // vehicle door
  g.add(box(0.12, 0.25, 3.2, secondary, 2.13, 2.3, 0));
  return g;
});

registerModel('bld:airpad', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  // A landing pad with its marking, a small control hut and a windsock mast.
  g.add(box(5.4, 0.3, 5.4, CONCRETE, 0, 0.15, 0));
  g.add(box(3.2, 0.04, 0.5, secondary, 0.3, 0.32, 0));
  g.add(box(0.5, 0.06, 2.4, secondary, -0.9, 0.33, 0));
  g.add(box(0.5, 0.06, 2.4, secondary, 1.5, 0.33, 0));
  g.add(box(1.4, 1.3, 1.2, METAL, -1.9, 0.95, -1.9));
  g.add(box(1.5, 0.2, 1.3, primary, -1.9, 1.7, -1.9));
  g.add(box(0.12, 2.2, 0.12, DARK, 2.3, 1.4, -2.3));
  g.add(box(0.5, 0.2, 0.2, primary, 2.6, 2.35, -2.3));
  return g;
});

registerModel('bld:motorPool', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.2, 4.6, CONCRETE, 0, 0.1, 0));
  // An open shed on posts, a truck parked under it and a fuel tank out back.
  for (const x of [-1.8, 1.8]) for (const z of [-1.7, 1.7]) g.add(box(0.25, 2.0, 0.25, secondary, x, 1.2, z));
  g.add(box(4.2, 0.2, 3.9, primary, 0, 2.3, 0));
  g.add(box(1.4, 0.6, 0.8, METAL, 0.2, 0.6, 0.6));
  g.add(cylinder(0.5, 0.5, 1.6, 8, METAL, -2.0, 1.0, -1.9));
  return g;
});

// Bastion's sensor mast: a lattice tower with a turning radar dish.
registerModel('bld:sensorMast', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(2.6, 0.3, 2.6, CONCRETE, 0, 0.15, 0));
  g.add(box(0.8, 0.8, 1.0, WALLS[1], -0.85, 0.7, 0)); // equipment hut
  for (const x of [-0.35, 0.35]) for (const z of [-0.35, 0.35]) g.add(box(0.12, 5.4, 0.12, DARK, x, 3.0, z));
  for (const y of [1.5, 3, 4.5]) for (const z of [-0.35, 0.35]) g.add(box(0.84, 0.08, 0.08, secondary, 0, y, z));
  g.add(box(1.0, 0.12, 1.0, primary, 0, 5.76, 0));
  const dish = new THREE.Group();
  dish.position.y = 5.82;
  dish.add(box(0.1, 0.3, 0.1, METAL, 0, 0.15, 0));
  dish.add(box(0.15, 0.7, 1.1, secondary, 0.12, 0.55, 0));
  g.add(dish);
  const beacon = glowBox(0.15, 0.15, 0.15, 0xff5040);
  beacon.position.set(0.35, 5.95, 0.35);
  g.add(beacon);
  return setRig(g, {
    animate: (s) => {
      dish.rotation.y += s.dt * 1.2;
    },
  });
});

// Talon's mech forge: a tall hall with a gantry crane and smoking chimneys.
registerModel('bld:mechForge', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.4, 0.25, 5.0, CONCRETE, 0, 0.12, 0));
  g.add(box(4.4, 3.0, 4.0, METAL, -0.3, 1.75, 0));
  g.add(box(4.6, 0.3, 4.2, primary, -0.3, 3.4, 0));
  g.add(box(0.06, 2.6, 2.6, DARK, 1.93, 1.55, 0)); // walker door
  g.add(box(0.12, 0.3, 2.9, secondary, 1.95, 3.0, 0));
  g.add(box(0.3, 0.3, 3.6, secondary, 0.8, 3.75, 0)); // crane beam
  for (const z of [-1.2, 1.2]) g.add(cylinder(0.35, 0.45, 1.8, 6, DARK, -1.6, 4.4, z));
  return g;
});

// Tidewater's dock: a boathouse on the shore with piers running out over the water.
registerModel('bld:dock', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.6, 0.3, 4.6, CONCRETE, 0, 0.15, 0));
  g.add(box(3.0, 1.8, 3.4, WALLS[3], -0.6, 1.2, 0));
  g.add(gableRoof(3.2, 3.6, 0.8, primary, 2.1));
  g.add(box(0.06, 1.2, 2.0, DARK, 0.91, 0.9, 0)); // boat doors
  for (const z of [-1.2, 1.2]) g.add(box(3.2, 0.2, 0.6, 0x7a5a3a, 3.6, 0.22, z)); // piers
  g.add(box(0.25, 3.3, 0.25, secondary, 1.6, 1.95, -1.9)); // crane
  g.add(box(2.6, 0.2, 0.2, secondary, 2.6, 3.4, -1.9));
  return g;
});

// Tidewater's hover pad, for bases without a coast: a round apron, a control hut and a fan house.
registerModel('bld:hoverPad', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(2.4, 2.5, 0.3, 12, CONCRETE, 0, 0.15, 0));
  g.add(cylinder(1.6, 1.6, 0.04, 12, secondary, 0.3, 0.32, 0));
  g.add(cylinder(1.3, 1.3, 0.06, 12, DARK, 0.3, 0.33, 0));
  g.add(box(1.1, 1.1, 1.0, METAL, -1.6, 0.85, -1.4));
  g.add(box(1.2, 0.15, 1.1, primary, -1.6, 1.47, -1.4));
  g.add(cylinder(0.5, 0.5, 0.6, 8, METAL, -1.7, 0.6, 1.3));
  return g;
});

// Firestorm's fuel depot: storage tanks, a pump shed and pipework. It goes up when destroyed.
registerModel('bld:fuelDepot', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  for (const z of [-1.2, 1.2]) {
    g.add(cylinder(0.9, 0.9, 2.0, 10, METAL, -1.2, 1.25, z));
    g.add(cylinder(0.92, 0.92, 0.25, 10, primary, -1.2, 1.7, z));
    g.add(cylinder(0.6, 0.9, 0.3, 10, METAL, -1.2, 2.4, z));
  }
  g.add(box(1.6, 1.2, 1.6, WALLS[1], 1.1, 0.85, 0.9)); // pump shed
  g.add(box(1.7, 0.15, 1.7, secondary, 1.1, 1.52, 0.9));
  g.add(box(2.2, 0.15, 0.15, DARK, 0.1, 0.5, -1.2)); // pipes
  g.add(box(0.18, 0.18, 2.0, DARK, 0.3, 0.5, -0.2));
  return g;
});

registerModel('bld:barracksBlock', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.2, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  g.add(box(4.4, 2.8, 3.8, WALLS[2], 0, 1.65, 0));
  g.add(box(4.5, 0.3, 3.9, primary, 0, 3.2, 0));
  g.add(box(0.06, 1.1, 1.0, DARK, 2.21, 0.8, 0));
  for (const x of [-1.4, 0, 1.4]) {
    for (const y of [1.3, 2.4]) for (const z of [-1.91, 1.91]) g.add(box(0.6, 0.35, 0.04, WINDOW, x, y, z));
  }
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
/** An engineer's wall segment: a low concrete wall across the way it faces, with a stripe in the side's colour. */
registerModel('bld:wall', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(0.7, 0.2, 2.6, 0x8f8a7e, 0, 0.1, 0));
  g.add(box(0.5, 1.0, 2.5, 0xa6a194, 0, 0.6, 0));
  g.add(box(0.52, 0.12, 2.52, primary, 0, 1.14, 0));
  return g;
});

registerModel('bld:bunker', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(3.0, 1.0, 2.4, 0x9a9588, 0, 0.5, 0));
  g.add(box(3.2, 0.2, 2.6, primary, 0, 1.08, 0));
  g.add(box(0.06, 0.2, 1.4, DARK, 1.52, 0.72, 0)); // firing slit
  g.add(box(0.06, 0.7, 0.6, DARK, -1.52, 0.38, 0.5)); // back door
  return g;
});

// Outpost kinds' buildings (see OUTPOST_KINDS in game/outposts.ts).

/** An airstrip: a short runway with its markings, a hangar and a windsock. */
registerModel('bld:airstrip', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.6, 0.18, 2.0, 0x6f6c66, 0, 0.09, 0.9));
  for (const x of [-2, -0.7, 0.6, 1.9]) g.add(box(0.7, 0.04, 0.14, 0xe8e4da, x, 0.2, 0.9));
  g.add(box(2.2, 1.1, 1.6, METAL, -1.2, 0.55, -1.1));
  g.add(cylinder(0.8, 0.8, 2.2, 8, secondary, -1.2, 1.1, -1.1).rotateZ(Math.PI / 2));
  g.add(box(0.05, 0.8, 1.0, DARK, -0.08, 0.5, -1.1)); // hangar door
  g.add(box(0.1, 1.6, 0.1, DARK, 2.3, 0.8, -1.4));
  g.add(box(0.5, 0.18, 0.18, primary, 2.6, 1.5, -1.4));
  return g;
});

/** The hilltop gun: a sandbagged concrete emplacement with a long-barrelled gun on a turntable. */
registerModel('bld:bigGun', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(1.6, 1.8, 0.7, 10, 0x9a9588, 0, 0.35, 0));
  g.add(cylinder(1.65, 1.65, 0.12, 10, secondary, 0, 0.74, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.8;
  turret.add(box(1.4, 0.7, 1.2, primary, -0.1, 0.35, 0));
  turret.add(box(0.5, 0.5, 1.3, METAL, -0.6, 0.3, 0));
  const barrel = box(2.6, 0.22, 0.22, DARK, 1.6, 0.55, 0);
  barrel.rotation.z = 0.25;
  turret.add(barrel);
  turret.add(box(0.4, 0.34, 0.34, METAL, 0.6, 0.45, 0)); // breech
  g.add(turret);
  return setRig(g, { turret });
});

/** A comms relay: a guyed lattice mast with dishes, and a radio hut at its foot. */
registerModel('bld:relayMast', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(2.4, 0.25, 2.4, CONCRETE, 0, 0.12, 0));
  g.add(box(1.0, 0.9, 0.9, WALLS[2], -0.7, 0.7, 0.6)); // radio hut
  g.add(box(1.1, 0.12, 1.0, primary, -0.7, 1.2, 0.6));
  for (const x of [-0.25, 0.25]) for (const z of [-0.25, 0.25]) g.add(box(0.1, 6.0, 0.1, DARK, x + 0.3, 3.2, z - 0.3));
  for (const y of [1.6, 3.2, 4.8]) g.add(box(0.56, 0.07, 0.56, secondary, 0.3, y, -0.3));
  for (const [y, a] of [[4.2, 0], [5.4, 2.1], [3.0, 4.2]]) {
    const dish = cylinder(0.45, 0.2, 0.18, 10, 0xd8d6d0, 0.3 + Math.cos(a) * 0.45, y, -0.3 + Math.sin(a) * 0.45);
    dish.rotation.set(0, -a, Math.PI / 2);
    g.add(dish);
  }
  const beacon = glowBox(0.15, 0.15, 0.15, 0xff5040);
  beacon.position.set(0.3, 6.3, -0.3);
  g.add(beacon);
  return setRig(g, {
    animate: ({ dt }) => {
      beacon.userData.t = (beacon.userData.t ?? Math.random() * 2) + dt;
      beacon.visible = beacon.userData.t % 1.2 < 0.6;
    },
  });
});

/** Bastion's comms array: a lattice mast on a skid, a big dish facing the front and a blinking light, put up by its engineers. */
registerModel('bld:commsArray', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(1.8, 0.2, 1.4, METAL, 0, 0.1, 0)); // skid
  g.add(box(0.7, 0.6, 0.6, primary, -0.45, 0.5, 0.35)); // generator
  for (const x of [-0.18, 0.18]) for (const z of [-0.18, 0.18]) g.add(box(0.07, 4.6, 0.07, DARK, x + 0.3, 2.5, z - 0.2));
  for (const y of [1.2, 2.4, 3.6]) g.add(box(0.44, 0.06, 0.44, secondary, 0.3, y, -0.2));
  const dish = cylinder(0.75, 0.25, 0.22, 12, 0xd8d6d0, 0.75, 3.9, -0.2);
  dish.rotation.set(0, 0, Math.PI / 2 - 0.35);
  g.add(dish);
  g.add(cylinder(0.05, 0.05, 0.6, 5, DARK, 0.95, 3.95, -0.2));
  const beacon = glowBox(0.14, 0.14, 0.14, 0x60c0ff);
  beacon.position.set(0.3, 4.9, -0.2);
  g.add(beacon);
  return setRig(g, {
    animate: ({ dt }) => {
      beacon.userData.t = (beacon.userData.t ?? Math.random() * 2) + dt;
      beacon.visible = beacon.userData.t % 0.9 < 0.45;
    },
  });
});

/** An outpost's fuel tanks: three round tanks in a bund, with pipework. They go up when destroyed. */
registerModel('bld:fuelTanks', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(3.6, 0.3, 3.4, CONCRETE, 0, 0.15, 0));
  for (const [x, z, r] of [[-0.8, -0.8, 0.75], [0.8, -0.6, 0.65], [-0.2, 0.9, 0.7]]) {
    g.add(cylinder(r, r, 1.5, 10, 0xc9c4b8, x, 1.05, z));
    g.add(cylinder(r + 0.02, r + 0.02, 0.18, 10, primary, x, 1.4, z));
    g.add(cylinder(r * 0.7, r, 0.25, 10, 0xb0aba0, x, 1.9, z));
  }
  g.add(box(2.6, 0.12, 0.12, DARK, 0, 0.45, 0.1));
  return g;
});

/** A ruined factory: a hall with broken walls and half its roof gone, patched with a new door and a crane. */
registerModel('bld:ruinedFactory', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.4, CONCRETE, 0, 0.12, 0));
  const brick = 0x8a6a58;
  g.add(box(3.9, 2.2, 0.35, brick, 0.05, 1.3, -1.8)); // back wall
  g.add(box(0.35, 2.1, 3.8, brick, -2.05, 1.3, 0)); // side wall
  g.add(box(2.0, 1.2, 0.35, brick, -1.1, 0.85, 1.8)); // broken front wall
  g.add(box(0.8, 0.6, 0.35, brick, 1.6, 0.55, 1.8));
  g.add(box(4.0, 0.18, 2.0, 0x5d5a55, -0.05, 2.45, -0.8)); // what's left of the roof
  g.add(box(0.35, 2.0, 2.2, primary, 2.0, 1.2, -0.6)); // patched door frame
  g.add(box(0.06, 1.6, 1.6, DARK, 2.2, 1.0, -0.6));
  g.add(cylinder(0.3, 0.4, 2.6, 6, DARK, -1.5, 2.6, -1.3)); // chimney
  g.add(box(0.8, 0.5, 0.6, 0x6b6560, 0.6, 0.45, 0.8)); // rubble
  g.add(box(0.5, 0.35, 0.5, 0x6b6560, 1.0, 0.3, 1.3));
  g.add(box(0.2, 2.6, 0.2, secondary, 1.6, 1.4, 1.4)); // crane
  g.add(box(1.6, 0.16, 0.16, secondary, 1.0, 2.7, 1.4));
  return g;
});

/**
 * How civilian buildings look on this map (see BiomeDef.town). Set by the
 * stage when a battle loads; faction buildings keep their own look.
 */
let townStyle: TownStyle = 'brick';

export function setTownStyle(style: TownStyle): void {
  townStyle = style;
}

/** Wall and roof colours per town style. */
const TOWN_COLORS: Record<TownStyle, { walls: number[]; roofs: number[]; trim: number }> = {
  brick: { walls: WALLS, roofs: CIVIC_ROOFS, trim: 0x8a8478 },
  adobe: { walls: [0xe2c99c, 0xd8b787, 0xeedbb8, 0xcfa978], roofs: [0xc9a06c, 0xb98a58, 0x8fa3a8], trim: 0xb08a5c },
  alpine: { walls: [0x6e4c35, 0x80593c, 0xe6ddcc, 0x5c4030], roofs: [0xeef2f5, 0xe2e8ec], trim: 0x4a3426 },
  timber: { walls: [0x9a7650, 0xb08a5c, 0xd9cfbd, 0x8c6a46], roofs: [0x4f6b3a, 0x6b4a32, 0x7a5a3a, 0x5d6b4a], trim: 0x5b4030 },
};

/** A civilian building's wall colour, or the usual walls for faction buildings. */
function wallColor(faction: number): number {
  return pick(faction < 0 ? TOWN_COLORS[townStyle].walls : WALLS);
}

/** A civilian roof colour in the town style, or the faction colour. */
function styledRoof(faction: number): number {
  return faction < 0 ? pick(TOWN_COLORS[townStyle].roofs) : factionColors(faction).primary;
}

/**
 * The roof on a box of the given footprint whose walls end at `h`: a gable
 * (steep and deep in alpine towns, with snow on it), or a flat roof with a
 * parapet in adobe towns.
 */
function roofOn(g: THREE.Group, w: number, d: number, h: number, faction: number): void {
  const style = faction < 0 ? townStyle : 'brick';
  const color = styledRoof(faction);
  if (style === 'adobe') {
    g.add(box(w + 0.08, 0.12, d + 0.08, color, 0, h + 0.06, 0));
    g.add(box(w + 0.1, 0.18, 0.1, color, 0, h + 0.15, d / 2));
    g.add(box(w + 0.1, 0.18, 0.1, color, 0, h + 0.15, -d / 2));
    return;
  }
  const pitch = style === 'alpine' ? 1.15 : style === 'timber' ? 0.8 : 0.7;
  g.add(gableRoof(w + 0.2, d + 0.25, pitch, color, h));
}

registerModel('bld:house', (faction) => {
  const g = new THREE.Group();
  const walls = wallColor(faction);
  const h = stepped(0.9, 1.3);
  g.add(box(1.9, h, 1.5, walls, 0, h / 2, 0));
  roofOn(g, 1.9, 1.5, h, faction);
  g.add(box(0.05, 0.6, 0.4, DARK, 0.96, 0.3, 0));
  g.add(box(0.4, 0.3, 0.04, WINDOW, -0.4, h * 0.6, 0.76));
  g.add(box(0.4, 0.3, 0.04, WINDOW, -0.4, h * 0.6, -0.76));
  if (faction < 0 && townStyle === 'adobe') {
    // A little rooftop dome or a water barrel.
    if (Math.random() < 0.4) g.add(cylinder(0.35, 0.4, 0.3, 8, 0xe8dcc0, -0.4, h + 0.3, 0.3));
  } else if (Math.random() < 0.5) {
    g.add(box(0.25, 0.6, 0.25, 0x8a5a48, -0.5, h + 0.45, 0.4)); // chimney
  }
  return g;
});

registerModel('bld:block', (faction) => {
  const g = new THREE.Group();
  const walls = wallColor(faction);
  const style = faction < 0 ? townStyle : 'brick';
  if (style === 'adobe') {
    // Stepped terraces, each storey set back from the one below.
    const tiers = 2 + Math.floor(Math.random() * 2);
    for (let t = 0; t < tiers; t++) {
      const w = 2.5 - t * 0.55;
      g.add(box(w, 0.9, w, walls, -t * 0.15, t * 0.9 + 0.45, 0));
      g.add(box(w + 0.04, 0.18, 0.5, WINDOW, -t * 0.15, t * 0.9 + 0.5, 0));
    }
    g.add(box(0.06, 0.7, 0.5, DARK, 1.26, 0.35, 0));
    return g;
  }
  if (style === 'alpine' || style === 'timber') {
    // A tall hall: two storeys under a big roof.
    const h = 2.2;
    g.add(box(2.4, h, 2.2, walls, 0, h / 2, 0));
    for (const y of [0.7, 1.6]) {
      g.add(box(0.4, 0.35, 0.04, WINDOW, 0.5, y, 1.11));
      g.add(box(0.4, 0.35, 0.04, WINDOW, -0.5, y, 1.11));
      g.add(box(0.4, 0.35, 0.04, WINDOW, 0.5, y, -1.11));
      g.add(box(0.4, 0.35, 0.04, WINDOW, -0.5, y, -1.11));
    }
    g.add(box(2.46, 0.12, 2.26, TOWN_COLORS[style].trim, 0, 1.15, 0)); // floor beam
    roofOn(g, 2.4, 2.2, h, faction);
    g.add(box(0.06, 0.8, 0.5, DARK, 1.21, 0.4, 0));
    return g;
  }
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
  const style = faction < 0 ? townStyle : 'brick';
  const accent = faction < 0 ? pick(TOWN_COLORS[style].roofs) : factionColors(faction).primary;
  if (style === 'adobe') {
    // A minaret: a slim tower with a balcony and a little dome.
    g.add(cylinder(0.8, 0.9, 0.6, 8, wallColor(faction), 0, 0.3, 0));
    g.add(cylinder(0.4, 0.5, 4.2, 8, wallColor(faction), 0, 2.7, 0));
    g.add(cylinder(0.6, 0.6, 0.2, 8, TOWN_COLORS.adobe.trim, 0, 4.4, 0));
    g.add(cylinder(0.32, 0.36, 0.7, 8, wallColor(faction), 0, 4.85, 0));
    g.add(cylinder(0.02, 0.36, 0.6, 8, accent, 0, 5.5, 0));
    return g;
  }
  if (style === 'alpine' || style === 'timber') {
    // A steeple: a square tower with a pointed cap.
    g.add(box(1.4, 3.8, 1.4, wallColor(faction), 0, 1.9, 0));
    g.add(box(0.5, 0.6, 0.06, WINDOW, 0.71, 3.1, 0));
    g.add(box(0.06, 0.6, 0.5, WINDOW, 0, 3.1, 0.71));
    g.add(cylinder(0.02, 1.05, 1.9, 4, accent, 0, 4.75, 0));
    g.add(box(0.06, 0.9, 0.06, METAL, 0, 6.1, 0));
    return g;
  }
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
  const accent = faction < 0 ? pick(TOWN_COLORS[townStyle].roofs) : factionColors(faction).primary;
  const body = faction < 0 && townStyle === 'adobe' ? pick([0xd8c4a0, 0xcbb38a]) : faction < 0 && townStyle === 'timber' ? pick([0x9a7650, 0xb08a5c]) : pick([0xd8d4cc, 0xc4c0b6, 0xb8c4c8]);
  g.add(cylinder(0.85, 0.85, 2.4, 8, body, 0, 1.2, 0));
  g.add(cylinder(0.05, 0.9, 0.7, 8, accent, 0, 2.75, 0));
  g.add(box(0.1, 2.4, 0.1, METAL, 0.9, 1.2, 0)); // ladder
  return g;
});

/** A long, low warehouse with a loading door, for a town's industrial district and harbour. */
registerModel('bld:warehouse', (faction) => {
  const g = new THREE.Group();
  const walls = faction < 0 && townStyle === 'brick' ? pick([0xa9a49a, 0xb7b0a2, 0x9aa0a4]) : wallColor(faction);
  g.add(box(3.4, 1.4, 2.0, walls, 0, 0.7, 0));
  if (faction < 0 && townStyle === 'adobe') g.add(box(3.5, 0.14, 2.1, styledRoof(faction), 0, 1.47, 0));
  else g.add(gableRoof(3.55, 2.2, townStyle === 'alpine' ? 0.9 : 0.45, faction < 0 && townStyle === 'brick' ? pick([0x6d7b86, 0x7a7e85, 0x8c4a3a]) : styledRoof(faction), 1.4));
  g.add(box(0.06, 1.0, 1.0, DARK, 1.71, 0.5, 0)); // loading door
  g.add(box(0.8, 0.5, 0.6, pick([0x8a5a38, 0x6d7b86, 0xb5654a]), 2.2, 0.25, 0.4)); // crates outside
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
