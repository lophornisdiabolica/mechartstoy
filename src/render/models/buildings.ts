import * as THREE from 'three';
import { barrelPivot, box, cylinder, factionColors, gableRoof, getRig, glowBox, markShared, mounted, registerModel, setRig } from '../models';
import { mountOf } from '../../game/mounts';
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
/** Rime's pale ice. */
const ICE = 0xcfe9f5;

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
    // A touch deeper than the walls so their ends overhang rather than sit flush with them.
    const panel = box(1.7, 0.12, 4.3, i % 2 ? primary : secondary, -1.75 + i * 1.6, 2.95, 0);
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

registerModel('bld:tower', (faction) => guardTower(faction));

/** A guard tower: a concrete drum with a twin-gun turret on top. */
function guardTower(faction: number): THREE.Object3D {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(0.75, 0.9, 1.6, 8, CONCRETE, 0, 0.8, 0));
  g.add(cylinder(0.85, 0.85, 0.2, 8, secondary, 0, 1.65, 0));
  const turret = new THREE.Group();
  turret.position.y = 1.75;
  turret.add(box(0.9, 0.55, 0.8, primary, 0, 0.3, 0));
  const guns = barrelPivot('bld:tower', turret);
  for (const side of [-1, 1]) guns.add(box(1.0, 0.12, 0.12, DARK, 0.5, 0, side * 0.15));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:tower', g, turret, [guns]) });
}

// Rime's field tower: a guard tower with a little frost mortar on its roof, turning on its own.
registerModel('bld:frostTower', (faction) => {
  const g = guardTower(faction);
  const rig = getRig(g)!;
  const mount = mountOf('frostTower#mortar')!;
  const t = new THREE.Group();
  t.position.set(...mount.turret);
  t.add(cylinder(0.2, 0.24, 0.1, 8, METAL, 0, 0.05, 0));
  // A cheek either side and a pin through them that the mortar tips on.
  for (const z of [-0.12, 0.12]) t.add(box(0.14, 0.2, 0.03, METAL, 0, 0.17, z));
  const pin = cylinder(0.04, 0.04, 0.28, 6, DARK, 0, 0.2, 0);
  pin.rotation.x = Math.PI / 2;
  t.add(pin);
  const tube = barrelPivot('frostTower#mortar', t);
  tube.add(box(0.6, 0.18, 0.18, DARK, 0.15, 0, 0));
  tube.add(box(0.3, 0.2, 0.2, ICE, 0.1, 0, 0)); // coolant sleeve
  mounted('frostTower#mortar', g, t, [tube]);
  g.add(t);
  return setRig(g, { ...rig, mounts: [{ turret: t, barrels: [tube] }] });
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
  // The roof is a touch shorter than the hangar so its end caps don't sit flush with the end walls.
  g.add(cylinder(0.8, 0.8, 2.1, 8, secondary, -1.2, 1.1, -1.1).rotateZ(Math.PI / 2));
  g.add(box(0.05, 0.8, 1.0, DARK, -0.08, 0.5, -1.1)); // hangar door
  g.add(box(0.1, 1.6, 0.1, DARK, 2.3, 0.8, -1.4));
  g.add(box(0.5, 0.18, 0.18, primary, 2.6, 1.5, -1.4));
  return g;
});

/** King of the hill's beacon: a stepped stone cairn with a tall mast flying a big banner in the holder's colour, and a steady lamp on top. */
registerModel('bld:hillBeacon', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(1.5, 1.7, 0.5, 8, 0x9a9588, 0, 0.25, 0));
  g.add(cylinder(1.1, 1.3, 0.5, 8, 0x8a8578, 0, 0.75, 0));
  g.add(cylinder(1.12, 1.12, 0.08, 8, secondary, 0, 1.02, 0));
  g.add(cylinder(0.09, 0.12, 5.6, 6, DARK, 0, 3.8, 0));
  g.add(box(0.5, 0.1, 0.1, METAL, 0, 6.5, 0));
  const banner = new THREE.Group();
  banner.position.set(0, 6.2, 0);
  banner.add(box(1.9, 1.15, 0.05, primary, 0.97, -0.6, 0));
  banner.add(box(1.84, 0.14, 0.06, secondary, 0.97, -1.12, 0)); // a touch narrower, so its ends don't sit flush with the banner's
  g.add(banner);
  const lamp = glowBox(0.22, 0.22, 0.22, 0xffd070);
  lamp.position.set(0, 6.75, 0);
  g.add(lamp);
  return setRig(g, {
    // A slow sway, no blinking.
    animate: ({ dt }) => {
      banner.userData.t = (banner.userData.t ?? Math.random() * 6) + dt;
      banner.rotation.y = Math.sin(banner.userData.t * 0.9) * 0.3;
    },
  });
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
  const barrel = barrelPivot('bld:bigGun', turret);
  barrel.add(box(2.6, 0.22, 0.22, DARK, 1.3, 0, 0));
  barrel.add(box(0.4, 0.34, 0.34, METAL, 0.15, -0.05, 0)); // breech, sticking out behind the barrel's end
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:bigGun', g, turret, [barrel]) });
});

/** Land armies' shore battery: a low sandbagged ring with a squat, wide turret behind a shield plate and two short barrels side by side. */
registerModel('bld:shoreBattery', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(1.1, 1.25, 0.45, 8, 0x8f8a7c, 0, 0.22, 0)); // sandbag ring
  g.add(cylinder(1.12, 1.12, 0.08, 8, secondary, 0, 0.48, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.52;
  turret.add(box(1.0, 0.42, 1.1, primary, -0.15, 0.21, 0));
  turret.add(box(0.14, 0.5, 1.2, METAL, 0.38, 0.27, 0)); // shield plate
  const barrels = barrelPivot('bld:shoreBattery', turret);
  for (const z of [-0.24, 0.24]) {
    barrels.add(box(0.95, 0.16, 0.16, DARK, 0.47, 0, z));
    barrels.add(box(0.14, 0.22, 0.22, METAL, 0.92, 0, z)); // muzzle brake
  }
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:shoreBattery', g, turret, [barrels]) });
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

/** Skyline's forward helipad: a small pad of steel plates with an H, landing lights, fuel drums and a windsock, put up by its engineers at outposts. */
registerModel('bld:helipad', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(3.4, 0.16, 3.4, METAL, 0, 0.08, 0));
  g.add(box(2.6, 0.04, 2.6, DARK, 0, 0.18, 0));
  // The H.
  for (const z of [-0.55, 0.55]) g.add(box(1.5, 0.03, 0.22, secondary, 0, 0.21, z));
  g.add(box(0.22, 0.03, 0.9, secondary, 0, 0.205, 0));
  const lights: THREE.Object3D[] = [];
  for (const x of [-1.55, 1.55]) {
    for (const z of [-1.55, 1.55]) {
      const l = glowBox(0.12, 0.1, 0.12, 0xffc040);
      l.position.set(x, 0.22, z);
      lights.push(l);
      g.add(l);
    }
  }
  // Fuel drums and a crate of rounds by the edge.
  for (const z of [-0.6, -0.1]) g.add(cylinder(0.22, 0.22, 0.5, 8, primary, -2.05, 0.25, z));
  g.add(box(0.6, 0.4, 0.5, WALLS[1], -2.05, 0.2, 0.6));
  g.add(box(0.07, 1.6, 0.07, DARK, 1.95, 0.8, -1.95));
  g.add(box(0.4, 0.14, 0.14, primary, 2.15, 1.55, -1.95));
  return setRig(g, {
    animate: ({ dt }) => {
      g.userData.t = (g.userData.t ?? Math.random() * 2) + dt;
      const on = g.userData.t % 1.2 < 0.6;
      lights.forEach((l, i) => (l.visible = on === (i % 2 === 0)));
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

/** A shipyard's slipway: a sloping ramp under a gantry crane, a boat hull on the ways, and a shed. */
registerModel('bld:slipway', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.4, 0.25, 3.6, CONCRETE, 0, 0.12, 0));
  const ramp = box(1.8, 0.2, 3.9, 0x6f6c66, 0.5, 0.3, 0.2);
  ramp.rotation.x = -0.08;
  g.add(ramp);
  // The hull on the ways: a long box with a pointed bow.
  g.add(box(0.9, 0.55, 2.2, 0x8a8f96, 0.5, 0.72, -0.1));
  g.add(cylinder(0.01, 0.46, 0.7, 4, 0x8a8f96, 0.5, 0.71, 1.3).rotateX(Math.PI / 2).rotateY(Math.PI / 4));
  g.add(box(0.5, 0.42, 0.7, primary, 0.5, 1.2, -0.5)); // wheelhouse
  // The gantry over it.
  for (const x of [-0.7, 1.7]) for (const z of [-1.2, 0.9]) g.add(box(0.16, 3.0, 0.16, secondary, x, 1.6, z));
  for (const z of [-1.2, 0.9]) g.add(box(2.6, 0.18, 0.2, secondary, 0.5, 3.05, z));
  g.add(box(0.3, 0.3, 2.4, DARK, 0.5, 2.85, -0.15));
  g.add(box(1.3, 1.3, 1.5, WALLS[3], -1.5, 0.9, -0.9)); // shed
  g.add(box(1.42, 0.14, 1.62, primary, -1.5, 1.6, -0.9));
  return g;
});

/** A sensor station: a radome on a squat block, a small rotating radar beside it. */
registerModel('bld:sensorStation', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(3.0, 0.25, 3.0, CONCRETE, 0, 0.12, 0));
  g.add(box(1.8, 1.4, 1.8, WALLS[2], 0, 0.95, 0));
  g.add(box(1.9, 0.14, 1.9, primary, 0, 1.7, 0));
  dome(g, 0.85, 1.77, 0xe6e2d8);
  g.add(box(0.14, 1.6, 0.14, DARK, 1.15, 1.05, 1.1));
  const radar = new THREE.Group();
  radar.position.set(1.15, 1.9, 1.1);
  radar.add(box(1.0, 0.32, 0.08, secondary, 0, 0, 0.06));
  g.add(radar);
  return setRig(g, {
    animate: ({ dt }) => {
      radar.rotation.y += dt * 1.4;
    },
  });
});

/** A repair yard: a gantry over an open bay with a vehicle lift, a workshop and stacked parts. */
registerModel('bld:repairYard', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.6, 0.22, 4.0, 0x7d7a73, 0, 0.11, 0));
  g.add(box(1.8, 0.12, 2.6, 0xd8b23a, 0.8, 0.27, 0.3)); // the lift, in warning yellow
  for (const x of [-0.25, 1.85]) for (const z of [-1.1, 1.7]) g.add(box(0.18, 2.4, 0.18, secondary, x, 1.3, z));
  for (const x of [-0.25, 1.85]) g.add(box(0.22, 0.2, 3.0, secondary, x, 2.5, 0.3));
  g.add(box(2.3, 0.24, 0.24, primary, 0.8, 2.3, 0.3)); // crane beam
  g.add(box(0.1, 0.8, 0.1, DARK, 0.8, 1.8, 0.3)); // hook
  g.add(box(1.4, 1.5, 2.0, WALLS[1], -1.5, 0.95, -0.7)); // workshop
  g.add(box(1.52, 0.14, 2.12, primary, -1.5, 1.75, -0.7));
  g.add(box(0.05, 1.0, 1.0, DARK, -0.78, 0.75, -0.7));
  for (const [x, z] of [[-1.9, 1.3], [-1.0, 1.6]]) g.add(cylinder(0.32, 0.32, 0.3, 10, DARK, x, 0.37, z)); // spare wheels
  return g;
});

/** A signal fire: a stone beacon tower with a brazier on top, its flame burning in the holder's colour. */
registerModel('bld:signalFire', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(1.3, 1.45, 0.5, 8, 0x8a857a, 0, 0.25, 0));
  g.add(cylinder(0.85, 1.1, 2.6, 8, 0xa39d90, 0, 1.8, 0));
  g.add(cylinder(1.05, 0.9, 0.3, 8, 0x8a857a, 0, 3.2, 0));
  g.add(cylinder(0.7, 0.45, 0.5, 8, DARK, 0, 3.6, 0)); // brazier
  const flame = glowBox(0.6, 0.7, 0.6, 0xffa040);
  flame.position.set(0, 4.1, 0);
  g.add(flame);
  const tip = glowBox(0.3, 0.4, 0.3, primary);
  tip.position.set(0, 4.55, 0);
  g.add(tip);
  return setRig(g, {
    animate: ({ dt }) => {
      flame.userData.t = (flame.userData.t ?? Math.random() * 3) + dt;
      const s = 1 + Math.sin(flame.userData.t * 9) * 0.12;
      flame.scale.set(s, 2 - s, s);
      tip.rotation.y += dt * 2;
    },
  });
});

/** A citadel's keep: a heavy square tower with crenellations, a gatehouse front and the holder's banner. */
registerModel('bld:keep', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  const stone = 0x9a9486;
  g.add(box(3.8, 0.3, 3.8, 0x7d786c, 0, 0.15, 0));
  g.add(box(3.0, 3.6, 3.0, stone, 0, 2.05, 0));
  g.add(box(3.24, 0.3, 3.24, 0x8a8477, 0, 3.95, 0));
  for (let k = 0; k < 4; k++) {
    for (const s of [-0.9, 0, 0.9]) {
      const a = (k * Math.PI) / 2;
      const m = box(0.4, 0.42, 0.3, stone, Math.cos(a) * 1.45 - Math.sin(a) * s, 4.3, Math.sin(a) * 1.45 + Math.cos(a) * s);
      m.rotation.y = -a;
      g.add(m);
    }
  }
  g.add(box(0.1, 1.4, 1.1, DARK, 1.53, 1.0, 0)); // gate
  g.add(box(0.12, 0.3, 1.5, primary, 1.56, 1.9, 0));
  for (const z of [-0.8, 0.8]) g.add(box(0.06, 0.5, 0.22, DARK, 1.52, 2.9, z)); // arrow slits
  g.add(box(0.1, 1.8, 0.1, DARK, -0.8, 5.0, -0.8));
  g.add(box(0.05, 0.6, 0.9, secondary, -0.8, 5.5, -0.32));
  return g;
});

/** A length of citadel wall: tall stone with a walkway lip and crenellations. */
registerModel('bld:citadelWall', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(1.1, 0.3, 3.5, 0x7d786c, 0, 0.15, 0));
  g.add(box(0.8, 1.6, 3.4, 0x9a9486, 0, 1.1, 0));
  g.add(box(0.92, 0.12, 3.46, primary, 0, 1.96, 0));
  for (const z of [-1.4, -0.7, 0, 0.7, 1.4]) g.add(box(0.3, 0.32, 0.4, 0x9a9486, 0.22, 2.17, z));
  return g;
});

/** A rail station's house: a brick booking hall under a pitched roof, a platform canopy along the track side and a water tower. */
registerModel('bld:stationHouse', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.0, 0.3, 3.0, CONCRETE, 0, 0.15, 0)); // platform
  g.add(box(2.4, 1.5, 1.5, 0x8a5a44, -0.4, 1.05, -0.5)); // booking hall
  g.add(gableRoof(2.6, 1.7, 0.6, primary, 1.8).translateX(-0.4).translateZ(-0.5));
  g.add(box(0.05, 0.9, 0.6, DARK, -0.4, 0.75, 0.26)); // door
  for (const x of [-1.6, 0.8]) g.add(box(0.12, 1.5, 0.12, DARK, x, 1.05, 1.1)); // canopy posts
  g.add(box(2.8, 0.1, 1.0, secondary, -0.4, 1.86, 0.95));
  g.add(cylinder(0.45, 0.45, 0.9, 10, 0x6d6a64, 1.4, 2.25, -0.6)); // water tower
  for (const [x, z] of [[1.15, -0.85], [1.65, -0.35]]) g.add(box(0.1, 1.6, 0.1, DARK, x, 1.0, z));
  return g;
});

/** A drawbridge's winch house: a squat stone tower with a timber roof, the big winch drum on its side and chains running down to the bridge. */
registerModel('bld:winchHouse', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  const stone = 0x948e80;
  g.add(box(3.0, 0.3, 3.0, 0x7d786c, 0, 0.15, 0));
  g.add(box(2.2, 2.4, 2.2, stone, 0, 1.5, 0));
  g.add(box(2.44, 0.2, 2.44, 0x857f72, 0, 2.8, 0));
  g.add(gableRoof(2.3, 2.3, 0.7, 0x6b4a32, 2.9));
  g.add(box(0.05, 1.1, 0.7, DARK, 1.13, 0.85, 0)); // door
  g.add(box(0.08, 0.26, 1.3, primary, 1.15, 1.6, 0));
  // The winch: a drum on two cheeks, with its crank wheel.
  for (const z of [-0.75, 0.75]) g.add(box(0.5, 0.9, 0.16, DARK, -1.3, 1.25, z));
  g.add(cylinder(0.36, 0.36, 1.3, 12, 0x5a4a3a, -1.35, 1.5, 0).rotateX(Math.PI / 2));
  g.add(cylinder(0.5, 0.5, 0.08, 10, secondary, -1.35, 1.5, 0.92).rotateX(Math.PI / 2));
  // Chains off the drum.
  for (const z of [-0.35, 0.35]) g.add(box(0.08, 0.08, 0.08, DARK, -1.75, 1.5, z), box(0.07, 1.2, 0.07, DARK, -1.75, 0.9, z));
  return g;
});

/** A stretch of a dam: a thick concrete wall with a walkway, its sluice gates on the water side. */
registerModel('bld:dam', () => {
  const g = new THREE.Group();
  g.add(box(1.8, 0.3, 3.3, 0x8a877e, 0, 0.15, 0));
  g.add(box(1.4, 1.9, 3.2, 0xa8a59c, 0, 1.25, 0));
  g.add(box(1.6, 0.14, 3.24, 0x8f8c84, 0, 2.27, 0));
  for (const z of [-0.9, 0.9]) g.add(box(0.12, 1.1, 0.8, 0x5a6670, -0.76, 1.0, z)); // sluice gates
  for (const z of [-1.5, 1.5]) g.add(box(0.1, 0.5, 0.1, DARK, 0.6, 2.58, z)); // railing posts
  g.add(box(0.06, 0.06, 2.96, DARK, 0.6, 2.75, 0));
  return g;
});

/** A dam control outpost's sluice house: a small concrete control room with the big gate wheel on its roof. */
registerModel('bld:sluiceHouse', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(3.2, 0.25, 3.2, CONCRETE, 0, 0.12, 0));
  g.add(box(2.4, 1.8, 2.0, 0xa8a59c, 0, 1.15, 0));
  g.add(box(2.6, 0.16, 2.2, primary, 0, 2.13, 0));
  g.add(box(0.05, 1.0, 0.6, DARK, 1.23, 0.75, 0)); // door
  g.add(box(0.06, 0.4, 1.2, 0x40525e, -1.23, 1.4, 0)); // window
  g.add(cylinder(0.08, 0.08, 0.5, 6, DARK, 0, 2.46, 0));
  g.add(cylinder(0.55, 0.55, 0.08, 12, secondary, 0, 2.75, 0).rotateX(Math.PI / 2));
  return g;
});

/** A landing field's flight tower: a glazed cab on a slim tower, a beacon on its roof and a windsock. */
registerModel('bld:flightTower', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(2.6, 0.25, 2.6, CONCRETE, 0, 0.12, 0));
  g.add(box(1.0, 3.4, 1.0, WALLS[0], 0, 1.95, 0));
  g.add(box(1.7, 0.9, 1.7, 0x40525e, 0, 4.05, 0)); // the glazed cab
  g.add(box(1.86, 0.16, 1.86, primary, 0, 4.58, 0));
  g.add(box(1.8, 0.1, 1.8, secondary, 0, 3.55, 0));
  const beacon = glowBox(0.2, 0.2, 0.2, 0x60ff80);
  beacon.position.set(0, 4.8, 0);
  g.add(beacon);
  g.add(box(0.08, 1.8, 0.08, DARK, 1.05, 0.95, 1.05));
  g.add(cylinder(0.08, 0.16, 0.6, 6, 0xf08a30, 1.05, 1.75, 1.35).rotateX(Math.PI / 2));
  return setRig(g, {
    animate: ({ dt }) => {
      beacon.userData.t = (beacon.userData.t ?? Math.random() * 2) + dt;
      beacon.visible = beacon.userData.t % 1.6 < 0.4;
    },
  });
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
  concrete: { walls: [0xa8a8a2, 0x9c9e9c, 0xb8b6ae, 0x8e9294], roofs: [0x6e7072, 0x7c7e80, 0x5e6466], trim: 0x6a6c6e },
  thatch: { walls: [0xa8865a, 0x8f6e48, 0xc2a070, 0x7a5c3c], roofs: [0xc8a860, 0xb8964e, 0xd4b46c], trim: 0x5a4028 },
  shanty: { walls: [0x7a6a5a, 0x8a7a64, 0x6d7b86, 0x9a6a4a, 0x5e6a5e], roofs: [0x9a5a3a, 0x8a7a6a, 0x6d7b86, 0xa8743e], trim: 0x4a4440 },
  yurt: { walls: [0xe6dcc6, 0xd8ccb2, 0xeae2d2, 0xc8b89a], roofs: [0xb05a3a, 0x3a6a8a, 0xc89a4a, 0x8a4a5a], trim: 0x7a5a3a },
  dome: { walls: [0xeef0f2, 0xe2e6ea, 0xd6dce2], roofs: [0xf6f8fa, 0x9ad0e0, 0xe8eef2], trim: 0x8aa0b0 },
};

/** Town styles built like halls (a big roof over timber or felt walls) rather than flat-roofed blocks. */
const HALLS: ReadonlySet<TownStyle> = new Set<TownStyle>(['alpine', 'timber', 'thatch', 'yurt', 'shanty']);

/** A low dome: three stacked rings narrowing to a point, sitting on a footprint of this radius at height y. */
function dome(g: THREE.Group, radius: number, y: number, color: number): void {
  g.add(cylinder(radius * 0.72, radius, radius * 0.32, 10, color, 0, y + radius * 0.16, 0));
  g.add(cylinder(radius * 0.3, radius * 0.72, radius * 0.3, 10, color, 0, y + radius * 0.47, 0));
  g.add(cylinder(0.02, radius * 0.3, radius * 0.16, 10, color, 0, y + radius * 0.7, 0));
}

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
 * parapet in adobe towns. `tight`: a house in a row (see bld:terrace), whose
 * roof stops at its own side walls (z) instead of overhanging next door's.
 */
function roofOn(g: THREE.Group, w: number, d: number, h: number, faction: number, tight = false): void {
  const style = faction < 0 ? townStyle : 'brick';
  const color = styledRoof(faction);
  /** How far past the side walls (z) a roof reaches, against the usual. */
  const sides = (usual: number) => (tight ? d - 0.01 : d + usual);
  if (style === 'shanty') {
    // A sheet of corrugated iron, laid on a slant from front to back, high enough that its low
    // edge clears the top of the wall (a big block's sheet drops further over its depth).
    const run = w + 0.3;
    const lift = h + (w / 2) * Math.tan(SHEET_TILT) + 0.06;
    const sheet = box(run, SHEET_THICK, sides(0.3), color, 0, lift, 0);
    sheet.rotation.z = SHEET_TILT;
    g.add(sheet);
    // Propped up on the high side (+x) by a post at each corner, from the wall top to just under
    // the sheet: the underside's height over the post's lower edge, so the post never pokes through.
    const x = w / 2 - SHEET_POST / 2;
    const under = lift + (x - SHEET_POST / 2 - (SHEET_THICK / 2) * Math.sin(SHEET_TILT)) * Math.tan(SHEET_TILT) - (SHEET_THICK / 2) * Math.cos(SHEET_TILT) - 0.01;
    const tall = under - h;
    if (tall > 0.05) {
      const edge = d / 2 - SHEET_POST / 2;
      for (const z of [edge, -edge]) g.add(box(SHEET_POST, tall, SHEET_POST, TOWN_COLORS.shanty.trim, x, h + tall / 2, z));
    }
    return;
  }
  if (style === 'dome') {
    g.add(box(w + 0.06, 0.1, sides(0.06), TOWN_COLORS.dome.trim, 0, h + 0.05, 0));
    dome(g, Math.min(w, d) * 0.45, h + 0.1, color);
    return;
  }
  if (style === 'adobe' || style === 'concrete') {
    g.add(box(w + 0.08, 0.12, sides(0.08), color, 0, h + 0.06, 0));
    // The parapets along the sides, inside the walls in a row.
    const edge = tight ? d / 2 - 0.06 : d / 2;
    g.add(box(w + 0.1, 0.18, 0.1, color, 0, h + 0.15, edge));
    g.add(box(w + 0.1, 0.18, 0.1, color, 0, h + 0.15, -edge));
    return;
  }
  const pitch = style === 'alpine' ? 1.15 : style === 'thatch' ? 1.05 : style === 'timber' ? 0.8 : style === 'yurt' ? 0.5 : 0.7;
  // Thatch hangs well past the walls.
  const eaves = style === 'thatch' ? 0.6 : 0.2;
  g.add(gableRoof(w + eaves, sides(eaves + 0.05), pitch, color, h));
}

/** How steeply a shanty's iron sheet roof slants, radians, how thick the sheet is, and how thick the posts propping its high side are. */
const SHEET_TILT = 0.2;
const SHEET_THICK = 0.08;
const SHEET_POST = 0.08;

registerModel('bld:house', (faction) => {
  const g = new THREE.Group();
  const walls = wallColor(faction);
  if (faction < 0 && townStyle === 'yurt') {
    // A round felt tent under a shallow cone, a coloured band round it.
    g.add(cylinder(0.95, 0.95, 0.9, 10, walls, 0, 0.45, 0));
    g.add(cylinder(0.97, 0.97, 0.12, 10, styledRoof(faction), 0, 0.62, 0));
    g.add(cylinder(0.12, 1.05, 0.6, 10, walls, 0, 1.2, 0));
    g.add(box(0.05, 0.55, 0.35, styledRoof(faction), 0.95, 0.28, 0));
    return g;
  }
  if (faction < 0 && townStyle === 'dome') {
    // A domed habitat on a low ring wall.
    g.add(cylinder(0.95, 1.0, 0.45, 10, walls, 0, 0.22, 0));
    dome(g, 0.95, 0.45, pick(TOWN_COLORS.dome.roofs));
    g.add(box(0.05, 0.4, 0.35, WINDOW, 0.97, 0.22, 0));
    return g;
  }
  if (faction < 0 && townStyle === 'thatch') {
    // Up on stilts, out of the wet.
    for (const [x, z] of [[-0.85, -0.65], [0.85, -0.65], [-0.85, 0.65], [0.85, 0.65]]) g.add(box(0.12, 0.45, 0.12, TOWN_COLORS.thatch.trim, x, 0.22, z));
    const hut = new THREE.Group();
    hut.position.y = 0.4;
    const h = stepped(0.8, 1.0, 3);
    hut.add(box(1.9, h, 1.5, walls, 0, h / 2, 0));
    roofOn(hut, 1.9, 1.5, h, faction);
    hut.add(box(0.05, 0.55, 0.4, DARK, 0.96, 0.3, 0));
    g.add(hut);
    return g;
  }
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
  if (HALLS.has(style)) {
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
  if (style === 'dome') {
    // A slim tower with a domed lookout.
    g.add(cylinder(0.75, 0.85, 0.5, 10, wallColor(faction), 0, 0.25, 0));
    g.add(cylinder(0.35, 0.45, 4.2, 10, wallColor(faction), 0, 2.6, 0));
    g.add(cylinder(0.75, 0.6, 0.5, 10, TOWN_COLORS.dome.trim, 0, 4.9, 0));
    dome(g, 0.75, 5.15, accent);
    return g;
  }
  if (HALLS.has(style)) {
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
  const body =
    faction < 0 && townStyle === 'adobe'
      ? pick([0xd8c4a0, 0xcbb38a])
      : faction < 0 && (townStyle === 'timber' || townStyle === 'thatch')
        ? pick([0x9a7650, 0xb08a5c])
        : faction < 0 && townStyle === 'shanty'
          ? pick([0x8a5a3a, 0x7a6a5a])
          : pick([0xd8d4cc, 0xc4c0b6, 0xb8c4c8]);
  g.add(cylinder(0.85, 0.85, 2.4, 8, body, 0, 1.2, 0));
  g.add(cylinder(0.05, 0.9, 0.7, 8, accent, 0, 2.75, 0));
  g.add(box(0.1, 2.4, 0.1, METAL, 0.9, 1.2, 0)); // ladder
  return g;
});

/**
 * A city lot's row of townhouses (see world/city.ts): two or three narrow
 * houses side by side filling the 3-unit lot, each its own height and roof,
 * gable ends to the street.
 */
registerModel('bld:terrace', (faction) => {
  const g = new THREE.Group();
  const n = Math.random() < 0.5 ? 2 : 3;
  const span = 2.8;
  const w = span / n;
  let last = 0;
  for (let k = 0; k < n; k++) {
    const house = new THREE.Group();
    house.position.z = -span / 2 + w * (k + 0.5);
    // Never the same height as the house next door: their roofs overhang each other.
    let h = stepped(1.4, 2.0, 4);
    if (h === last) h = h >= 2 ? 1.4 : h + 0.2;
    last = h;
    // A hair narrower than its share, so neighbours' walls never share a plane, and every other
    // house a little shallower, so neighbours' overhanging roofs never end in the same plane.
    const deep = k % 2 === 0 ? 2.7 : 2.56;
    const face = deep / 2;
    house.add(box(deep, h, w - 0.04, wallColor(faction), 0, h / 2, 0));
    roofOn(house, deep, w - 0.04, h, faction, true);
    house.add(box(0.05, 0.6, 0.3, DARK, face + 0.025, 0.3, 0)); // door (proud of the windows above it)
    for (const y of [h * 0.45, h * 0.8].filter((y) => y < h - 0.25)) {
      house.add(box(0.05, 0.28, 0.32, WINDOW, face + 0.01, y, 0));
      house.add(box(0.05, 0.28, 0.32, WINDOW, -face - 0.01, y, 0));
    }
    g.add(house);
  }
  return g;
});

/** A city lot's apartment block: four to seven storeys in brick towns, stepped terraces in adobe ones, tall halls under steep roofs in alpine and timber ones. */
registerModel('bld:tenement', (faction) => {
  const g = new THREE.Group();
  const walls = wallColor(faction);
  const style = faction < 0 ? townStyle : 'brick';
  if (style === 'adobe') {
    const tiers = 3 + Math.floor(Math.random() * 2);
    for (let t = 0; t < tiers; t++) {
      const w = 2.8 - t * 0.5;
      g.add(box(w, 0.9, w, walls, -t * 0.12, t * 0.9 + 0.45, 0));
      g.add(box(w + 0.04, 0.2, 0.6, WINDOW, -t * 0.12, t * 0.9 + 0.5, 0));
      g.add(box(0.6, 0.2, w + 0.04, WINDOW, -t * 0.12, t * 0.9 + 0.5, 0));
    }
    g.add(box(0.06, 0.7, 0.5, DARK, 1.41, 0.35, 0));
    return g;
  }
  if (HALLS.has(style)) {
    const floors = 3 + Math.floor(Math.random() * 2);
    const h = floors * 0.8;
    g.add(box(2.7, h, 2.7, walls, 0, h / 2, 0));
    for (let f = 0; f < floors; f++) {
      for (const z of [-0.7, 0, 0.7]) {
        g.add(box(0.05, 0.32, 0.3, WINDOW, 1.36, f * 0.8 + 0.5, z));
        g.add(box(0.05, 0.32, 0.3, WINDOW, -1.36, f * 0.8 + 0.5, z));
      }
      if (f > 0) g.add(box(2.76, 0.1, 2.76, TOWN_COLORS[style].trim, 0, f * 0.8, 0)); // floor beams
    }
    roofOn(g, 2.7, 2.7, h, faction);
    g.add(box(0.06, 0.6, 0.5, DARK, 1.38, 0.3, 0));
    return g;
  }
  const floors = 4 + Math.floor(Math.random() * 4);
  const floorH = 0.7;
  const h = floors * floorH;
  g.add(box(2.7, h, 2.7, walls, 0, h / 2, 0));
  for (let f = 0; f < floors; f++) g.add(box(2.74, 0.26, 2.74, WINDOW, 0, f * floorH + 0.42, 0));
  g.add(box(2.8, 0.15, 2.8, 0x8a8478, 0, h + 0.07, 0)); // parapet
  g.add(box(0.06, 0.5, 0.8, DARK, 1.38, 0.25, 0)); // shop door
  if (Math.random() < 0.4) {
    // A water tank on legs.
    g.add(cylinder(0.4, 0.4, 0.6, 8, 0x7a5a48, -0.5, h + 0.75, 0.5));
    g.add(box(0.06, 0.4, 0.06, METAL, -0.5, h + 0.33, 0.5));
  } else {
    g.add(box(0.8, 0.45, 0.6, METAL, -0.5, h + 0.37, -0.5)); // rooftop unit
  }
  return g;
});

/** A long, low warehouse with a loading door, for a town's industrial district and harbour. */
registerModel('bld:warehouse', (faction) => {
  const g = new THREE.Group();
  const walls = faction < 0 && townStyle === 'brick' ? pick([0xa9a49a, 0xb7b0a2, 0x9aa0a4]) : wallColor(faction);
  g.add(box(3.4, 1.4, 2.0, walls, 0, 0.7, 0));
  if (faction < 0 && (townStyle === 'adobe' || townStyle === 'concrete' || townStyle === 'dome')) g.add(box(3.5, 0.14, 2.1, styledRoof(faction), 0, 1.47, 0));
  else g.add(gableRoof(3.55, 2.2, townStyle === 'alpine' || townStyle === 'thatch' ? 0.9 : 0.45, faction < 0 && townStyle === 'brick' ? pick([0x6d7b86, 0x7a7e85, 0x8c4a3a]) : styledRoof(faction), 1.4));
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

// Aegis: a hall with a tall dome emitter on its roof.
registerModel('bld:shieldWorks', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  g.add(box(3.6, 2.2, 3.4, WALLS[3], 0.2, 1.35, 0));
  g.add(box(3.7, 0.25, 3.5, primary, 0.2, 2.5, 0));
  g.add(box(0.06, 1.2, 1.4, DARK, 2.01, 0.85, 0)); // door
  g.add(cylinder(0.7, 0.95, 0.5, 10, secondary, 0, 2.85, 0));
  g.add(cylinder(0.18, 0.18, 1.2, 6, METAL, 0, 3.6, 0));
  const orb = glowBox(0.6, 0.6, 0.6, 0x9fe3ff);
  orb.position.set(0, 4.4, 0);
  g.add(orb);
  for (const z of [-1.3, 1.3]) g.add(box(0.5, 0.5, 0.5, 0x9fe3ff, -1.9, 0.5, z)); // capacitor cells
  return g;
});

// Rime: cooling towers and a coolant tank, frosted over.
registerModel('bld:cryoPlant', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  for (const z of [-1.2, 1.2]) {
    g.add(cylinder(0.8, 1.0, 2.6, 10, 0xdfeff5, -1.1, 1.55, z)); // cooling towers
    g.add(cylinder(0.82, 0.82, 0.22, 10, primary, -1.1, 2.4, z));
  }
  g.add(box(1.8, 1.3, 1.8, WALLS[2], 1.2, 0.9, 0.8)); // plant shed
  g.add(box(1.9, 0.15, 1.9, secondary, 1.2, 1.62, 0.8));
  const tank = cylinder(0.45, 0.45, 1.6, 10, 0xcfefff, 1.2, 0.75, -1.4);
  tank.rotation.x = Math.PI / 2;
  g.add(tank);
  g.add(box(0.15, 0.15, 2.0, DARK, 0.25, 0.5, 0)); // pipes
  return g;
});

// Sabre: a long hall with two crossed blades over its door.
registerModel('bld:duelHall', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  g.add(box(4.2, 2.4, 3.4, WALLS[1], 0, 1.45, 0));
  g.add(gableRoof(4.4, 3.6, 1.0, primary, 2.65));
  g.add(box(0.06, 1.4, 1.6, DARK, 2.11, 0.95, 0)); // door
  for (const side of [-1, 1]) {
    const blade = box(0.08, 2.0, 0.22, 0xc8ccd2, 2.2 + side * 0.03, 2.0, side * 0.35);
    blade.rotation.x = side * 0.6;
    g.add(blade);
  }
  g.add(box(0.3, 0.3, 0.3, secondary, 2.25, 2.0, 0));
  return g;
});

/** Cipher's signal glow. */
const CIPHER_GLOW = 0x6ab8aa;

// Cipher: a lattice mast with a dish on top that turns to lock on, beside a signal hut.
registerModel('bld:uplinkMast', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.6, 0.25, 4.4, CONCRETE, 0, 0.12, 0));
  g.add(box(2.2, 1.6, 1.8, WALLS[1], -0.9, 1.05, 1.25)); // signal hut
  g.add(box(2.3, 0.2, 1.9, primary, -0.9, 1.95, 1.25));
  g.add(box(0.06, 1.0, 0.8, DARK, 0.21, 0.75, 1.25)); // door
  for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) g.add(box(0.12, 3.7, 0.12, METAL, x, 2.1, z)); // the mast's legs
  g.add(box(0.8, 0.15, 0.8, secondary, 0, 4.0, 0));
  const turret = new THREE.Group();
  turret.position.set(0, 4.2, 0);
  turret.add(cylinder(0.2, 0.25, 0.3, 8, DARK, 0, 0.1, 0));
  const dish = barrelPivot('bld:uplinkMast', turret);
  dish.add(cylinder(0.55, 0.1, 0.22, 10, secondary, 0.25, 0, 0).rotateZ(-Math.PI / 2));
  const core = glowBox(0.14, 0.14, 0.14, CIPHER_GLOW);
  core.position.set(0.48, 0, 0);
  dish.add(core);
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:uplinkMast', g, turret, [dish]) });
});

// Veil: a soot-dark works with tall smoke stacks.
registerModel('bld:smokeStacks', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  g.add(box(3.2, 2.0, 3.0, WALLS[2], 0.6, 1.25, 0));
  g.add(box(3.3, 0.2, 3.1, primary, 0.6, 2.35, 0));
  g.add(box(0.06, 1.2, 1.4, DARK, 2.21, 0.85, 0)); // door
  for (const z of [-1.4, 0, 1.4]) {
    g.add(cylinder(0.35, 0.45, 3.6, 8, 0x34303a, -1.6, 2.0, z)); // stacks
    g.add(cylinder(0.37, 0.37, 0.18, 8, secondary, -1.6, 3.4, z));
  }
  return g;
});

// Zenith: an ops block under a tall drop tube, its beacon lit, and a landing ring painted on the pad.
registerModel('bld:dropControl', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, CONCRETE, 0, 0.12, 0));
  g.add(box(2.6, 2.0, 3.0, WALLS[1], 0.9, 1.25, 0));
  g.add(box(2.7, 0.2, 3.1, primary, 0.9, 2.35, 0));
  g.add(box(0.06, 1.2, 1.4, DARK, 2.21, 0.85, 0)); // door
  // The drop tube: a tall hexagonal shaft with bands round it.
  g.add(cylinder(0.75, 0.9, 3.6, 6, METAL, -1.3, 2.05, 0));
  for (const y of [1.2, 2.4, 3.4]) g.add(cylinder(0.8, 0.8, 0.16, 6, secondary, -1.3, y, 0));
  // The targeting laser on top, which turns to paint attackers for a strike.
  const turret = new THREE.Group();
  turret.position.set(-1.3, 3.95, 0);
  turret.add(box(0.5, 0.2, 0.5, DARK, 0, 0.1, 0));
  const laser = barrelPivot('bld:dropControl', turret);
  laser.add(box(0.5, 0.16, 0.16, METAL, 0.15, 0, 0));
  const lens = glowBox(0.06, 0.1, 0.1, 0xff6a3a);
  lens.position.set(0.42, 0, 0);
  laser.add(lens);
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:dropControl', g, turret, [laser]) });
});

// A drop pod: a squat hexagonal capsule on four fins, scorched from coming down, in the side's colours.
registerModel('bld:dropPod', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(cylinder(0.75, 0.85, 1.1, 6, primary, 0, 0.6, 0));
  g.add(cylinder(0.3, 0.75, 0.5, 6, 0x4a4640, 0, 1.4, 0)); // heat-scorched nose
  g.add(cylinder(0.8, 0.8, 0.12, 6, secondary, 0, 0.95, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const fin = box(0.5, 0.7, 0.08, DARK, Math.cos(a) * 0.8, 0.35, Math.sin(a) * 0.8);
    fin.rotation.y = -a;
    g.add(fin);
  }
  g.add(box(0.06, 0.7, 0.5, DARK, 0.8, 0.5, 0)); // hatch
  return g;
});

// Hive's Recycler: a great maw in a mound of plating, scrap heaped round it, vats glowing, and an acid spout on top.
registerModel('bld:recycler', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.0, 0.25, 4.8, 0x4a4238, 0, 0.12, 0));
  g.add(cylinder(2.3, 2.5, 1.6, 8, 0x3b2a1e, 0, 1.0, 0));
  g.add(cylinder(1.9, 2.3, 0.9, 8, primary, 0, 2.2, 0));
  g.add(cylinder(2.0, 2.0, 0.14, 8, secondary, 0, 1.8, 0));
  // The maw: a dark pit in the front, with teeth round it.
  g.add(box(0.2, 0.9, 1.6, 0x15100c, 2.35, 0.9, 0));
  for (let i = 0; i < 5; i++) g.add(box(0.3, 0.12, 0.12, 0x8a8a8a, 2.45, 0.45 + i * 0.22, (i % 2 ? 0.6 : -0.6)));
  for (const [x, z] of [[-1.6, 1.6], [-1.8, -1.4], [0.6, -2.1]]) {
    const vat = glowBox(0.6, 0.8, 0.6, 0xbcc232);
    vat.position.set(x, 0.65, z);
    g.add(vat);
  }
  // Scrap heaped by the maw.
  g.add(box(0.8, 0.4, 0.6, 0x5a5650, 2.6, 0.35, 1.5));
  g.add(box(0.6, 0.3, 0.9, 0x6a5040, 2.8, 0.3, -1.4));
  const turret = new THREE.Group();
  turret.position.set(-0.4, 2.65, 0);
  turret.add(box(0.8, 0.4, 0.8, 0x3b2a1e, 0, 0.15, 0));
  const spout = barrelPivot('bld:recycler', turret);
  spout.add(box(0.6, 0.22, 0.22, 0x3b2a1e, 0.25, 0, 0));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:recycler', g, turret, [spout]) });
});

// Nomad's crawler yard: a long shed with a gantry over its open end, where the crawlers come out.
registerModel('bld:crawlerYard', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(6.4, 0.25, 5.6, 0x8a8478, 0, 0.12, 0));
  g.add(box(4.6, 3.0, 4.6, 0x8e8a80, -0.6, 1.75, 0));
  g.add(box(4.7, 0.3, 4.7, primary, -0.6, 3.4, 0));
  g.add(box(0.08, 2.6, 3.2, 0x2a2a2a, 1.72, 1.55, 0)); // the open end
  for (const z of [-2.0, 2.0]) g.add(box(0.3, 3.8, 0.3, 0x707070, 2.4, 2.0, z)); // gantry legs
  g.add(box(0.4, 0.4, 4.4, secondary, 2.4, 3.9, 0));
  return g;
});

// A crawler set up as a camp: the rig on its jacks, the factory hall opened out with awnings, the crane raised, and pennants round it marking its ground.
registerModel('bld:crawlerCamp', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(4.0, 0.6, 2.8, 0x707070, 0, 0.75, 0)); // chassis, lowered
  for (const x of [-1.7, 1.7]) for (const z of [-1.7, 1.7]) g.add(box(0.3, 0.6, 0.3, 0x444444, x, 0.3, z)); // jacks
  g.add(box(2.6, 1.3, 2.6, primary, -0.6, 1.7, 0));
  g.add(box(2.7, 0.14, 2.7, secondary, -0.6, 2.4, 0));
  // Awnings folded out from the hall's sides.
  for (const side of [-1, 1]) {
    const awning = box(2.4, 0.06, 1.4, secondary, -0.6, 2.0, side * 1.95);
    awning.rotation.x = side * 0.3;
    g.add(awning);
  }
  // The crane, raised.
  const crane = box(0.14, 2.6, 0.14, 0x707070, -1.6, 3.6, 0.9);
  crane.rotation.z = 0.5;
  g.add(crane);
  g.add(box(1.1, 0.8, 2.4, primary, 1.45, 1.45, 0)); // cab
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    g.add(box(0.06, 1.0, 0.06, 0x444444, Math.cos(a) * 3.6, 0.5, Math.sin(a) * 3.6));
    g.add(box(0.03, 0.22, 0.32, primary, Math.cos(a) * 3.6, 0.88, Math.sin(a) * 3.6 + 0.16));
  }
  const turret = new THREE.Group();
  turret.position.set(1.45, 1.85, 0);
  turret.add(box(0.6, 0.3, 0.6, 0x2a2a2a, 0, 0.15, 0));
  const guns = barrelPivot('bld:crawlerCamp', turret);
  for (const side of [-1, 1]) guns.add(box(0.6, 0.07, 0.07, 0x2a2a2a, 0.3, 0, side * 0.12));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:crawlerCamp', g, turret, [guns]) });
});

// Antiquity's castrum: a square palisade fort with corner towers, a gate, standards, and a ballista on the gatehouse.
registerModel('bld:castrum', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const WOOD = 0x8a6440;
  const g = new THREE.Group();
  g.add(box(6.7, 0.2, 6.7, 0x9a8a68, 0, 0.1, 0));
  for (const side of [-1, 1]) {
    g.add(box(5.4, 1.6, 0.3, WOOD, 0, 0.9, side * 2.7));
    g.add(box(0.3, 1.64, 5.4, WOOD, -side * 2.7, 0.9, 0));
  }
  for (const x of [-2.7, 2.7]) for (const z of [-2.7, 2.7]) g.add(box(0.8, 2.4, 0.8, WOOD, x, 1.25, z)); // corner towers
  g.add(box(1.0, 2.0, 1.8, 0x7a5638, 2.75, 1.1, 0)); // gatehouse
  g.add(box(1.4, 1.2, 2.0, primary, -0.6, 0.7, 0)); // the commander's tent
  g.add(box(1.5, 0.12, 2.1, secondary, -0.6, 1.36, 0));
  g.add(box(0.06, 1.6, 0.06, BRONZE_POLE, -1.6, 1.8, 1.2));
  g.add(box(0.04, 0.5, 0.4, primary, -1.6, 2.4, 1.42));
  const turret = new THREE.Group();
  turret.position.set(2.75, 2.2, 0);
  turret.add(box(0.2, 0.2, 0.2, WOOD, 0, 0.1, 0));
  const bow = barrelPivot('bld:castrum', turret);
  bow.add(box(0.8, 0.08, 0.08, WOOD, 0.2, 0, 0));
  bow.add(box(0.06, 0.06, 0.8, WOOD, 0.45, 0, 0));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:castrum', g, turret, [bow]) });
});
const BRONZE_POLE = 0xc08a3a;

// Tin Soldiers' toy box: a giant painted wooden chest, lid propped open, with a jack-in-the-box cannon springing out of it.
registerModel('bld:toyBox', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(5.4, 0.2, 5.0, 0xc8b898, 0, 0.1, 0));
  g.add(box(4.2, 2.0, 3.6, primary, 0, 1.2, 0));
  g.add(box(4.25, 0.25, 3.65, secondary, 0, 0.5, 0)); // painted band
  g.add(box(4.25, 0.25, 3.65, secondary, 0, 1.9, 0));
  const lid = box(4.2, 0.2, 3.6, primary, -2.0, 3.0, 0);
  lid.rotation.z = 1.2;
  g.add(lid);
  for (const [x, z, c] of [[1.6, 2.1, 0xd04040], [-1.4, 2.2, 0x40a0d0], [2.3, -1.9, 0xe0c040]] as const) g.add(box(0.6, 0.6, 0.6, c, x, 0.5, z)); // toy blocks
  const turret = new THREE.Group();
  turret.position.set(0.4, 2.3, 0);
  turret.add(box(0.3, 0.6, 0.3, 0x8a8a8a, 0, 0.3, 0)); // the spring
  turret.add(box(0.6, 0.5, 0.6, 0xf0d0b0, 0, 0.85, 0)); // the jack's head
  const barrel = barrelPivot('bld:toyBox', turret);
  barrel.add(box(0.7, 0.16, 0.16, 0x2a2a2a, 0.3, 0, 0));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:toyBox', g, turret, [barrel]) });
});

// Mirage's mirror array: a crystal spire in a ring of angled mirrors on posts, with a prism emitter on top.
registerModel('bld:mirrorArray', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const PRISM = 0xbfe8ff;
  const g = new THREE.Group();
  g.add(cylinder(2.7, 2.8, 0.3, 8, 0x8a8a90, 0, 0.15, 0));
  g.add(cylinder(0.8, 1.2, 3.0, 6, primary, 0, 1.8, 0));
  g.add(cylinder(1.25, 1.25, 0.16, 6, secondary, 0, 0.6, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    g.add(box(0.12, 1.2, 0.12, 0x707070, Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2));
    const mirror = box(0.06, 0.9, 0.8, PRISM, Math.cos(a) * 2.25, 1.8, Math.sin(a) * 2.25);
    mirror.rotation.y = -a;
    mirror.rotation.z = 0.3;
    g.add(mirror);
  }
  const turret = new THREE.Group();
  turret.position.set(0, 3.3, 0);
  turret.add(box(0.5, 0.2, 0.5, 0x2a2a2a, 0, 0.1, 0));
  const lens = barrelPivot('bld:mirrorArray', turret);
  const crystal = glowBox(0.5, 0.36, 0.36, PRISM);
  crystal.rotation.x = Math.PI / 4;
  crystal.position.x = 0.04;
  lens.add(crystal);
  lens.add(box(0.4, 0.1, 0.1, 0x8a8a8a, 0.4, 0, 0));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:mirrorArray', g, turret, [lens]) });
});

/** A greenhouse's panes: see-through, so the plants inside show. */
// Lambert (no shine), so each pane is one flat tint like everything else in the game, not a glossy gradient.
const greenhouseGlass = markShared(new THREE.MeshLambertMaterial({ color: 0xc4ecf0, transparent: true, opacity: 0.4, depthWrite: false }));

/** A pane of greenhouse glass. */
function pane(geometry: THREE.BufferGeometry): THREE.Mesh {
  const m = new THREE.Mesh(geometry, greenhouseGlass);
  m.userData.noShadow = true;
  m.renderOrder = 1;
  return m;
}

// Verdant's glasshouse: a greenhouse, glass walls and a pitched glass roof in a framework of glazing bars over a low wall, beds of glowing plants inside, and a vine turret on its ridge.
registerModel('bld:glasshouse', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  /** Wall top, ridge height above it, and the glass's half-length and half-depth. */
  const WALL = 1.75;
  const RISE = 0.9;
  const HX = 2.45;
  const HZ = 1.75;
  g.add(box(6.0, 0.2, 5.0, 0x7a6a50, 0, 0.1, 0));
  g.add(box(5.0, 0.5, 3.7, primary, 0, 0.45, 0)); // the low wall
  // Beds of plants inside, under the glass.
  for (const z of [-0.85, 0.85]) {
    g.add(box(4.4, 0.3, 1.0, 0x5a4030, 0, 0.85, z));
    for (const x of [-1.65, -0.55, 0.55, 1.65]) {
      const plant = glowBox(0.6, 0.55, 0.6, 0x6ab84a);
      plant.position.set(x, 1.27, z);
      g.add(plant);
    }
  }
  const walls = pane(new THREE.BoxGeometry(HX * 2, WALL - 0.7, HZ * 2));
  walls.position.y = (WALL + 0.7) / 2;
  g.add(walls);
  const roof = pane(gableRoof(HX * 2, HZ * 2, RISE, 0, WALL).geometry);
  roof.position.y = WALL;
  g.add(roof);
  // The glazing bars: posts round the walls, an eave rail, rafters down the roof and a ridge beam.
  for (const x of [-HX, -1.2, 0, 1.2, HX]) {
    for (const z of [-HZ - 0.02, HZ + 0.02]) g.add(box(0.08, WALL - 0.63, 0.06, secondary, x, (WALL + 0.69) / 2, z));
  }
  for (const z of [-0.9, 0, 0.9]) {
    for (const x of [-HX - 0.01, HX + 0.01]) g.add(box(0.06, WALL - 0.63, 0.08, secondary, x, (WALL + 0.69) / 2, z));
  }
  for (const z of [-HZ - 0.02, HZ + 0.02]) g.add(box(HX * 2 + 0.12, 0.08, 0.08, secondary, 0, WALL + 0.02, z));
  const slope = Math.atan2(RISE, HZ);
  const run = Math.hypot(RISE, HZ);
  for (const side of [-1, 1]) {
    for (const x of [-HX, -1.2, 0, 1.2, HX]) {
      const rafter = box(0.07, 0.06, run, secondary, x, WALL + RISE / 2 + Math.cos(slope) * 0.04, side * (HZ / 2 + Math.sin(slope) * 0.04));
      rafter.rotation.x = side * slope;
      g.add(rafter);
    }
  }
  g.add(box(HX * 2 + 0.16, 0.12, 0.14, secondary, 0, WALL + RISE + 0.02, 0));
  const turret = new THREE.Group();
  turret.position.set(0, 2.78, 0);
  turret.add(box(0.5, 0.3, 0.5, 0x5a4030, 0, 0.15, 0));
  const vine = barrelPivot('bld:glasshouse', turret);
  vine.add(box(0.8, 0.12, 0.12, 0x4a8a3a, 0.35, 0, 0));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:glasshouse', g, turret, [vine]) });
});

// Lodestar's scrapyard: heaps of scrap inside a fence, a shed, and a magnet gantry that flings wrecks.
registerModel('bld:scrapyard', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(6.0, 0.2, 5.6, 0x6a6458, 0, 0.1, 0));
  g.add(box(2.6, 1.8, 2.4, primary, -1.4, 1.1, -1.2)); // shed
  g.add(box(2.7, 0.16, 2.5, secondary, -1.4, 2.08, -1.2));
  for (const [x, z, w, h] of [[1.6, 1.6, 1.4, 0.7], [-1.6, 1.6, 1.2, 0.5], [1.8, -1.4, 1.0, 0.6]]) g.add(box(w, h, w, 0x5a5650, x, 0.2 + h / 2, z)); // scrap heaps
  const turret = new THREE.Group();
  turret.position.set(0.6, 2.6, 0.2);
  turret.add(box(0.3, 2.4, 0.3, 0x707070, 0, -1.2, 0)); // the gantry post
  turret.add(box(0.6, 0.3, 0.6, 0x707070, 0, 0.15, 0));
  const jib = barrelPivot('bld:scrapyard', turret);
  jib.add(box(1.8, 0.16, 0.16, primary, 0.8, 0, 0));
  jib.add(cylinder(0.3, 0.3, 0.14, 10, 0xb83a32, 1.6, -0.3, 0));
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:scrapyard', g, turret, [jib]) });
});

// A scrap wall: wrecked hulls and plates dragged together into a low, ragged line.
registerModel('bld:scrapWall', (faction) => {
  const { primary } = factionColors(faction);
  const g = new THREE.Group();
  g.add(box(0.9, 0.9, 0.7, 0x4a4640, -0.9, 0.45, 0));
  g.add(box(1.0, 1.1, 0.8, 0x5a5650, 0.05, 0.55, 0.05));
  g.add(box(0.8, 0.8, 0.75, 0x524c44, 0.95, 0.4, -0.05));
  const plate = box(1.4, 0.08, 0.6, primary, 0.2, 1.15, 0);
  plate.rotation.z = 0.15;
  g.add(plate);
  return g;
});

// Leviathan's shrine: a stepped stone platform with standing stones round it and a great idol of the beast whose eyes burn.
registerModel('bld:shrine', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const STONE = 0x6a6a64;
  const g = new THREE.Group();
  g.add(box(5.6, 0.3, 5.6, STONE, 0, 0.15, 0));
  g.add(box(4.2, 0.4, 4.2, 0x5a5a54, 0, 0.5, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(box(0.4, 1.6, 0.3, STONE, Math.cos(a) * 2.5, 1.1, Math.sin(a) * 2.5));
  }
  g.add(box(1.4, 1.6, 1.4, 0x2e4a4a, 0, 1.5, 0)); // the idol's body
  g.add(box(1.5, 0.2, 1.5, primary, 0, 1.0, 0));
  g.add(box(0.12, 0.8, 1.8, secondary, -0.2, 2.6, 0)); // its frill
  const turret = new THREE.Group();
  turret.position.set(0, 2.3, 0);
  turret.add(box(1.0, 0.8, 1.0, 0x2e4a4a, 0.1, 0.4, 0)); // head
  const eyes = barrelPivot('bld:shrine', turret);
  for (const side of [-1, 1]) {
    const eye = glowBox(0.08, 0.16, 0.2, 0xd8f070);
    eye.position.set(0.04, 0, side * 0.25);
    eyes.add(eye);
  }
  g.add(turret);
  return setRig(g, { turret, ...mounted('bld:shrine', g, turret, [eyes]) });
});

// Relics: what map traits leave standing, nobody's (see world/traits.ts). Their colours are their own, not a side's.

const RUST = 0x5a3c2e;
const SOOT = 0x3a3532;
const OLD_CONCRETE = 0x9c978a;
const MARBLE = 0xddd5c2;

/** An old tank hulk: a burnt-out, rusted hull, its turret knocked askew and its gun drooping, tracks gone. */
registerModel('bld:oldHulk', () => {
  const g = new THREE.Group();
  const tilt = (Math.random() - 0.5) * 0.25;
  const hull = new THREE.Group();
  hull.add(box(2.3, 0.6, 1.5, RUST, 0, 0.35, 0));
  hull.add(box(2.1, 0.35, 0.32, SOOT, 0, 0.2, 0.8));
  hull.add(box(2.1, 0.35, 0.32, SOOT, 0, 0.2, -0.8));
  const turret = new THREE.Group();
  turret.add(box(1.0, 0.45, 0.95, 0x4e3529, 0, 0, 0));
  const gun = box(1.2, 0.12, 0.12, SOOT, 0.95, -0.08, 0);
  gun.rotation.z = -0.25;
  turret.add(gun);
  turret.position.set(-0.15, 0.85, 0);
  turret.rotation.y = (Math.random() - 0.5) * 1.6;
  turret.rotation.z = (Math.random() - 0.5) * 0.3;
  hull.add(turret);
  hull.rotation.z = tilt;
  hull.position.y = -0.1;
  g.add(hull);
  return g;
});

/** A stretch of an old concrete wall across the way it faces, chipped along the top, with a stain of rust. */
registerModel('bld:oldWall', () => {
  const g = new THREE.Group();
  g.add(box(0.8, 0.2, 2.7, 0x878275, 0, 0.1, 0));
  g.add(box(0.6, 1.1, 2.6, OLD_CONCRETE, 0, 0.65, 0));
  // Chipped top: a few blocks missing.
  for (const z of [-0.9, 0.1, 0.95]) if (Math.random() < 0.6) g.add(box(0.62, 0.25, stepped(0.3, 0.6, 3), OLD_CONCRETE, 0, 1.3, z));
  g.add(box(0.66, 0.5, 0.18, RUST, 0, 0.75, stepped(-0.95, 0.95, 3)));
  return g;
});

/** An old pillbox: a squat hexagonal concrete blockhouse, its slits empty and blackened. */
registerModel('bld:pillbox', () => {
  const g = new THREE.Group();
  g.add(cylinder(1.45, 1.6, 1.3, 6, OLD_CONCRETE, 0, 0.65, 0));
  g.add(cylinder(1.55, 1.55, 0.25, 6, 0x878275, 0, 1.38, 0));
  for (const a of [0, Math.PI / 3, -Math.PI / 3]) {
    const slit = box(0.12, 0.18, 0.7, SOOT, Math.cos(a) * 1.42, 0.95, -Math.sin(a) * 1.42);
    slit.rotation.y = a;
    g.add(slit);
  }
  return g;
});

/** A crashed giant machine: a huge armoured torso half buried on its side, a leg in the air, a broken arm, ribs showing. */
registerModel('bld:crashedHulk', () => {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.add(box(6.5, 3.4, 4.2, 0x5d5a57, 0, 1.4, 0)); // torso, on its side
  body.add(box(5.5, 0.6, 3.6, RUST, 0.2, 3.3, 0)); // armour plate, rusted
  body.add(box(2.4, 2.0, 2.4, 0x4a4744, 3.9, 1.7, 0.4)); // head
  body.add(glowBox(0.9, 0.3, 0.08, 0x5a1a10).translateX(5.05).translateY(2.1).translateZ(0.4)); // a dead eye, still faintly lit
  // A leg sticking up at an angle, and a broken arm in the dirt.
  const leg = new THREE.Group();
  leg.add(box(1.3, 4.5, 1.3, 0x55524f, 0, 2.25, 0));
  leg.add(box(1.8, 0.8, 2.2, SOOT, 0, 4.6, 0.3));
  leg.position.set(-2.6, 2.2, -1.1);
  leg.rotation.z = 0.7;
  leg.rotation.x = -0.3;
  body.add(leg);
  const arm = box(4.2, 1.0, 1.0, 0x4f4c49, 0.5, 0.4, 3.0);
  arm.rotation.y = 0.5;
  body.add(arm);
  // Torn ribs where the plating's gone.
  for (let n = 0; n < 4; n++) body.add(box(0.18, 1.6, 0.18, SOOT, -1.6 + n * 0.8, 3.6, -1.4));
  body.rotation.x = 0.12;
  g.add(body);
  return g;
});

/** An oil derrick: a lattice tower over the well, with a pumpjack nodding beside it (it keeps working, whoever's fighting round it). */
registerModel('bld:derrick', () => {
  const g = new THREE.Group();
  g.add(box(2.0, 0.2, 2.0, 0x4a4540, 0, 0.1, 0));
  const steel = 0x6b6258;
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
    const leg = box(0.12, 5.2, 0.12, steel, x * 0.6, 2.6, z * 0.6);
    leg.rotation.x = z * 0.1;
    leg.rotation.z = -x * 0.1;
    g.add(leg);
  }
  for (const y of [1.2, 2.4, 3.6]) g.add(box(1.2 - y * 0.12, 0.08, 1.2 - y * 0.12, steel, 0, y, 0));
  g.add(box(0.5, 0.3, 0.5, 0x3d3833, 0, 5.2, 0));
  // The pumpjack.
  const beam = new THREE.Group();
  beam.add(box(1.6, 0.16, 0.16, 0x8a3a2a, 0, 0, 0));
  beam.add(box(0.2, 0.45, 0.3, 0x8a3a2a, 0.8, -0.15, 0));
  beam.position.set(1.0, 1.05, 0.9);
  g.add(box(0.14, 0.9, 0.14, SOOT, 1.0, 0.5, 0.9));
  g.add(beam);
  return setRig(g, {
    animate: ({ dt }) => {
      beam.userData.t = (beam.userData.t ?? Math.random() * 10) + dt;
      beam.rotation.z = Math.sin(beam.userData.t * 1.6) * 0.3;
    },
  });
});

/** An ancient column: a fluted shaft on a plinth, its capital weathered, the odd one snapped short. */
registerModel('bld:column', () => {
  const g = new THREE.Group();
  const snapped = Math.random() < 0.3;
  const shaft = snapped ? stepped(1.4, 2.2, 3) : 2.7;
  g.add(box(1.0, 0.25, 1.0, 0xcfc6b0, 0, 0.12, 0));
  g.add(cylinder(0.38, 0.44, shaft, 10, MARBLE, 0, 0.25 + shaft / 2, 0));
  if (!snapped) g.add(box(0.95, 0.25, 0.95, 0xcfc6b0, 0, 3.05, 0));
  return g;
});

/** What's left of a temple wall: big stone blocks, stepped down where the top has fallen. */
registerModel('bld:ruinWall', () => {
  const g = new THREE.Group();
  g.add(box(0.8, 0.6, 2.6, 0xcfc6b0, 0, 0.3, 0));
  g.add(box(0.7, 0.55, stepped(1.4, 2.4, 3), MARBLE, 0, 0.85, -0.05));
  if (Math.random() < 0.6) g.add(box(0.7, 0.45, stepped(0.6, 1.2, 3), 0xd6cdb8, 0, 1.35, -0.5));
  return g;
});
