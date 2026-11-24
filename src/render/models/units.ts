import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { mountOf } from '../../game/mounts';
import { AnimState, barrelPivot, box, cylinder, glowBox, factionColors, flatMaterial, markShared, mounted, registerModel, setRig } from '../models';

/**
 * Low-poly unit models. Each is a handful of boxes built facing +x, with
 * turrets and legs as separate groups so the rig can animate them.
 */

const DARK = 0x2b2b2e;
const METAL = 0x5d6066;
const GLASS = 0x9fe3ff;

/** A two-segment walker leg. Rotating `hip` swings it; `knee` bends the shin. */
interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

/** Which side of the body a leg hangs from (+1 or -1 along z), and whether it's at the front (+1) or back (-1). */
const sideOf = (leg: Leg) => (leg.hip.position.z < 0 ? -1 : 1);
const endOf = (leg: Leg) => Math.sign(leg.hip.position.x);

function makeLeg(thigh: number, shin: number, thickness: number, color: number, footColor: number): Leg {
  const hip = new THREE.Group();
  hip.name = 'leg';
  hip.add(box(thickness, thigh, thickness, color, 0, -thigh / 2, 0));
  const knee = new THREE.Group();
  knee.position.y = -thigh;
  knee.add(box(thickness * 0.85, shin, thickness * 0.85, color, 0, -shin / 2, 0));
  knee.add(box(thickness * 2.2, thickness * 0.5, thickness * 1.6, footColor, thickness * 0.3, -shin, 0));
  hip.add(knee);
  return { hip, knee };
}

/**
 * A walker's rig: the walk cycle, legs swinging in opposite phase with the
 * amplitude easing in with speed, and how it falls when wrecked.
 */
function walker(legs: Leg[], body: THREE.Object3D, stride: number, swing: number) {
  return { animate: walkCycle(legs, body, stride, swing), wreck: walkerWreck(legs, body) };
}

/**
 * How a walker breaks (see render/wrecks.ts). Two-legged ones buckle onto
 * their knees, keel over where a leg is blown off, or topple onto their
 * side or back; four-legged ones buckle, sag onto a lost leg, or belly-flop
 * with every leg splayed. Each leg is bent a little differently every time.
 */
function walkerWreck(legs: Leg[], body: THREE.Object3D) {
  const four = legs.length > 2;
  return (rng: Rng) => {
    const r = (a: number, b: number) => rng.range(a, b);
    const way = rng.int(0, 2);
    if (way === 0) {
      // Knees buckle and it sinks onto them, slumping forward.
      for (const leg of legs) {
        leg.hip.rotation.z = r(1.05, 1.5);
        leg.knee.rotation.z = -leg.hip.rotation.z - (four ? r(1.1, 1.5) : r(1.0, 1.45));
        leg.hip.rotation.x = -sideOf(leg) * r(0, 0.25);
      }
      body.rotation.z = four ? r(-0.15, 0.1) : -r(0.12, 0.42);
      body.rotation.x = r(-0.15, 0.15);
    } else if (way === 1) {
      // A leg is blown away at the knee (or snapped sideways) and it keels over that way.
      const lost = rng.pick(legs);
      const s = sideOf(lost);
      for (const leg of legs) {
        if (leg === lost) continue;
        // The others fold under it as it goes down.
        leg.hip.rotation.z = r(0.8, 1.4);
        leg.knee.rotation.z = -leg.hip.rotation.z - r(0.8, 1.4);
        leg.hip.rotation.x = -sideOf(leg) * r(0.05, 0.45);
      }
      // What's left of it swings up out of the way as it goes over.
      lost.hip.rotation.z = (rng.chance(0.5) ? 1 : -1) * r(1.0, 1.5);
      if (rng.chance(0.55)) lost.knee.visible = false;
      else {
        lost.knee.rotation.x = s * r(1.2, 1.8);
        lost.knee.rotation.z = -r(0, 0.8);
      }
      body.rotation.x = s * (four ? r(0.3, 0.55) : r(0.75, 1.25));
      body.rotation.z = four ? -endOf(lost) * r(0.15, 0.35) : r(-0.3, 0.2);
    } else if (!four) {
      // Toppled: over on its side (its guns would prop it up face down) or flat on its back.
      if (rng.chance(0.6)) {
        const s = rng.chance(0.5) ? 1 : -1;
        body.rotation.x = s * r(1.25, 1.5);
        body.rotation.z = r(-0.3, 0.2);
        body.position.z += s * body.position.y * r(0.25, 0.45);
        for (const leg of legs) {
          leg.hip.rotation.z = r(-0.8, 0.8);
          leg.knee.rotation.z = -r(0, 1.3);
        }
      } else {
        body.rotation.z = r(1.2, 1.45);
        body.rotation.x = r(-0.3, 0.3);
        body.position.x -= body.position.y * r(0.25, 0.45);
        for (const leg of legs) {
          // Swung on round with the fall, so they lie along the ground, not prop it up.
          leg.hip.rotation.z = r(0, 0.5);
          leg.knee.rotation.z = -r(0, 0.4);
          leg.hip.rotation.x = -sideOf(leg) * r(0, 0.4);
        }
      }
    } else {
      // Belly-flop: the legs give out sideways and it comes down on its belly.
      for (const leg of legs) {
        leg.hip.rotation.x = -sideOf(leg) * r(1.35, 1.6);
        leg.knee.rotation.x = sideOf(leg) * r(-0.4, 0.15);
        leg.hip.rotation.z = endOf(leg) * r(0, 0.4);
      }
      body.rotation.x = r(-0.12, 0.12);
      body.rotation.z = r(-0.15, 0.15);
    }
    return body;
  };
}

/** Walk cycle: legs swing in opposite phase; amplitude eases in with speed. */
function walkCycle(legs: Leg[], body: THREE.Object3D, stride: number, swing: number) {
  let phase = 0;
  let amount = 0;
  const bodyY = body.position.y;
  return (s: AnimState) => {
    phase += (s.speed * s.dt * Math.PI) / stride;
    amount += ((s.speed > 0.05 ? 1 : 0) - amount) * Math.min(1, s.dt * 6);
    legs.forEach((leg, i) => {
      const p = phase + i * Math.PI;
      leg.hip.rotation.z = Math.sin(p) * swing * amount;
      leg.knee.rotation.z = -Math.max(0, Math.cos(p)) * swing * 1.2 * amount;
    });
    body.position.y = bodyY + Math.abs(Math.sin(phase)) * 0.06 * amount;
  };
}

registerModel('strider', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.55;
  root.add(body);

  // The cockpit pod is the "turret": the whole upper body twists to aim.
  const turret = new THREE.Group();
  turret.add(box(1.1, 0.5, 0.75, primary, 0, 0.1, 0));
  turret.add(box(0.35, 0.22, 0.5, GLASS, 0.5, 0.22, 0));
  turret.add(box(0.5, 0.15, 0.85, secondary, -0.15, 0.42, 0));
  for (const side of [-1, 1]) {
    turret.add(box(0.7, 0.14, 0.14, DARK, 0.5, -0.08, side * 0.45));
  }
  body.add(turret);

  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.75, 0.8, 0.16, METAL, DARK);
    leg.hip.position.set(-0.05, -0.05, side * 0.3);
    body.add(leg.hip);
    return leg;
  });

  return setRig(root, { turret, ...walker(legs, body, 0.9, 0.5), ...mounted('strider', root, turret) });
});

registerModel('titan', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.5;
  root.add(body);

  // Pelvis stays with the legs; the torso twists to aim.
  body.add(box(1.0, 0.45, 1.3, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.3;
  turret.add(box(1.6, 1.1, 1.6, primary, 0, 0.6, 0));
  turret.add(box(0.5, 0.3, 1.0, GLASS, 0.75, 0.85, 0));
  turret.add(box(1.2, 0.2, 1.7, secondary, -0.15, 1.2, 0));
  for (const side of [-1, 1]) {
    // Shoulder missile pods with dark launch tubes facing forward.
    const pod = new THREE.Group();
    pod.position.set(-0.1, 1.35, side * 1.0);
    pod.add(box(1.0, 0.6, 0.6, secondary));
    pod.add(box(0.05, 0.45, 0.45, DARK, 0.5, 0, 0));
    turret.add(pod);
    // Arm cannons.
    turret.add(box(0.5, 0.5, 0.4, primary, 0.1, 0.45, side * 1.0));
    turret.add(box(1.1, 0.18, 0.18, DARK, 0.75, 0.45, side * 1.0));
  }
  body.add(turret);

  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.25, 1.25, 0.38, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.55);
    body.add(leg.hip);
    return leg;
  });

  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.35), ...mounted('titan', root, turret) });
});

function tracks(length: number, width: number, height: number, gap: number): THREE.Object3D[] {
  return [-1, 1].map((side) => box(length, height, width, DARK, 0, height / 2, side * gap));
}

registerModel('tank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.3, 0.4, 0.45, 0.6));
  root.add(box(2.1, 0.45, 1.1, primary, 0, 0.6, 0));
  root.add(box(0.5, 0.25, 1.16, secondary, 0.85, 0.5, 0)); // bumper, a touch wider than the hull

  const turret = new THREE.Group();
  turret.position.set(-0.1, 0.83, 0);
  turret.add(box(1.0, 0.4, 0.85, primary, 0, 0.2, 0));
  turret.add(box(0.4, 0.12, 0.6, secondary, -0.2, 0.45, 0));
  const gun = barrelPivot('tank', turret);
  gun.add(box(1.3, 0.14, 0.14, DARK, 0.65, 0, 0));
  root.add(turret);

  return setRig(root, { turret, ...mounted('tank', root, turret, [gun]) });
});

registerModel('howitzer', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.2, 0.38, 0.4, 0.55));
  root.add(box(2.0, 0.4, 1.0, primary, 0, 0.55, 0));

  const turret = new THREE.Group();
  turret.position.set(-0.3, 0.75, 0);
  turret.add(box(1.1, 0.55, 0.95, secondary, 0, 0.27, 0));
  // Long barrel elevated for lobbed shots.
  const barrel = barrelPivot('howitzer', turret);
  barrel.add(box(2.0, 0.16, 0.16, DARK, 1.0, 0, 0));
  barrel.add(box(0.3, 0.24, 0.24, METAL, 1.9, 0, 0));
  root.add(turret);

  return setRig(root, { turret, ...mounted('howitzer', root, turret, [barrel]) });
});

/** Four (or more) block wheels down each side of a wheeled vehicle. */
function wheels(xs: number[], gap: number, size: number): THREE.Object3D[] {
  return xs.flatMap((x) => [-1, 1].map((side) => box(size, size, size * 0.45, DARK, x, size / 2, side * gap)));
}

// Armour doctrine: the Lancer, a longer, heavier tank with a long gun.
registerModel('lancer', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.8, 0.5, 0.55, 0.75));
  root.add(box(2.6, 0.55, 1.4, primary, 0, 0.75, 0));
  root.add(box(0.56, 0.3, 1.46, secondary, 1.1, 0.62, 0)); // glacis plate, just short of the tracks' ends
  const turret = new THREE.Group();
  turret.position.set(-0.15, 1.03, 0);
  turret.add(box(1.3, 0.5, 1.1, primary, 0, 0.25, 0));
  turret.add(box(0.6, 0.14, 0.7, secondary, -0.25, 0.57, 0));
  const gun = barrelPivot('lancer', turret);
  gun.add(box(1.9, 0.18, 0.18, DARK, 0.85, 0, 0));
  gun.add(box(0.25, 0.26, 0.26, METAL, 1.8, 0, 0)); // muzzle brake
  root.add(turret);
  return setRig(root, { turret, ...mounted('lancer', root, turret, [gun]) });
});

// Raiders doctrine: trucks.
registerModel('mgTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.55, 0.55], 0.42, 0.42));
  root.add(box(1.7, 0.25, 0.8, METAL, 0, 0.5, 0));
  root.add(box(0.6, 0.55, 0.78, primary, 0.5, 0.88, 0)); // cab
  root.add(box(0.06, 0.25, 0.6, GLASS, 0.81, 0.98, 0));
  root.add(box(0.95, 0.2, 0.84, secondary, -0.35, 0.72, 0)); // bed
  const turret = new THREE.Group();
  turret.position.set(-0.35, 0.82, 0);
  turret.add(box(0.12, 0.4, 0.12, DARK, 0, 0.2, 0));
  const gun = barrelPivot('mgTruck', turret);
  gun.add(box(0.8, 0.1, 0.1, DARK, 0.35, 0, 0));
  gun.add(box(0.08, 0.3, 0.5, primary, 0.12, 0, 0)); // gun shield
  root.add(turret);
  return setRig(root, { turret, ...mounted('mgTruck', root, turret, [gun]) });
});

registerModel('buggy', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.45, 0.45], 0.38, 0.34));
  root.add(box(1.2, 0.22, 0.6, primary, 0, 0.42, 0));
  for (const x of [-0.25, 0.25]) for (const z of [-0.26, 0.26]) root.add(box(0.06, 0.4, 0.06, DARK, x, 0.73, z)); // roll cage
  root.add(box(0.62, 0.05, 0.6, DARK, 0, 0.955, 0));
  const turret = new THREE.Group();
  turret.position.set(-0.25, 0.98, 0);
  const gun = barrelPivot('buggy', turret);
  gun.add(box(0.6, 0.08, 0.08, DARK, 0.25, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('buggy', root, turret, [gun]) });
});

/** Leviathan's cult drives whatever it could get: rust and patches. */
const RUST = 0x7a4a32;

// A rusty pilgrim pickup: a patched cab, a scrap plate, and a machine gun on a post in the bed.
registerModel('pilgrimTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.55, 0.5], 0.38, 0.36));
  root.add(box(1.7, 0.2, 0.8, RUST, 0, 0.42, 0)); // chassis
  root.add(box(0.6, 0.45, 0.76, primary, 0.45, 0.745, 0)); // cab
  root.add(box(0.06, 0.3, 0.6, DARK, 0.77, 0.8, 0)); // windscreen
  root.add(box(0.4, 0.3, 0.04, secondary, 0.45, 0.72, 0.4)); // a scrap plate wired over the door
  for (const z of [-0.36, 0.36]) root.add(box(0.9, 0.2, 0.06, 0x5a4a3a, -0.4, 0.62, z)); // bed sides
  const turret = new THREE.Group();
  turret.position.set(-0.4, 0.98, 0);
  turret.add(box(0.08, 0.46, 0.08, DARK, 0, -0.2, 0)); // the post
  const gun = barrelPivot('pilgrimTruck', turret);
  gun.add(box(0.7, 0.08, 0.08, DARK, 0.25, 0, 0));
  gun.add(box(0.05, 0.22, 0.36, METAL, 0.02, 0.02, 0)); // a gun shield cut from a road sign
  root.add(turret);
  return setRig(root, { turret, ...mounted('pilgrimTruck', root, turret, [gun]) });
});

// A farm tractor: big back wheels, small front ones, an exhaust stack, and a whaling harpoon gun on the bonnet.
registerModel('harpoonTractor', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.4], 0.42, 0.66));
  root.add(...wheels([0.55], 0.3, 0.36));
  root.add(box(1.1, 0.34, 0.46, primary, 0.2, 0.62, 0)); // bonnet
  root.add(box(0.42, 0.5, 0.56, RUST, -0.35, 0.79, 0)); // the seat's housing
  root.add(box(0.36, 0.06, 0.6, secondary, -0.35, 1.07, 0)); // a tin roof over it
  root.add(box(0.06, 0.44, 0.06, DARK, 0.55, 0.99, 0.14)); // exhaust stack
  const turret = new THREE.Group();
  turret.position.set(0.3, 0.92, 0);
  turret.add(box(0.24, 0.16, 0.24, DARK, 0, 0.0, 0));
  const gun = barrelPivot('harpoonTractor', turret);
  gun.add(box(0.8, 0.1, 0.1, DARK, 0.3, 0, 0));
  gun.add(box(0.28, 0.06, 0.06, 0xd8cfb8, 0.84, 0, 0)); // the harpoon, loaded
  root.add(turret);
  return setRig(root, { turret, ...mounted('harpoonTractor', root, turret, [gun]) });
});

registerModel('rocketTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.7, 0, 0.7], 0.44, 0.42));
  root.add(box(2.0, 0.25, 0.85, METAL, 0, 0.5, 0));
  root.add(box(0.6, 0.6, 0.82, primary, 0.68, 0.92, 0)); // cab, just short of the chassis end
  root.add(box(0.06, 0.26, 0.62, GLASS, 1.01, 1.02, 0));
  const turret = new THREE.Group();
  turret.position.set(-0.4, 0.62, 0);
  turret.add(box(0.5, 0.2, 0.5, primary, 0, 0.1, 0));
  // The rack tilts up for lobbed rockets.
  const rack = barrelPivot('rocketTruck', turret);
  rack.add(box(1.2, 0.45, 0.8, secondary));
  rack.add(box(0.05, 0.35, 0.65, DARK, 0.6, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('rocketTruck', root, turret, [rack]) });
});

// The Land-train: an armoured tractor hauling two armoured cars, rocket batteries on the first.
registerModel('landTrain', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(1.4, 0.45, 1.5, DARK, 1.55, 0.23, 0)); // running gear under each car
  root.add(box(1.8, 0.45, 1.5, DARK, -0.25, 0.23, 0));
  root.add(box(1.5, 0.45, 1.5, DARK, -2.05, 0.23, 0));
  root.add(box(1.3, 1.0, 1.3, primary, 1.55, 0.95, 0)); // tractor
  root.add(box(0.06, 0.3, 0.9, GLASS, 2.21, 1.2, 0));
  root.add(box(1.7, 0.9, 1.36, secondary, -0.25, 0.9, 0)); // first car
  root.add(box(1.4, 0.95, 1.32, primary, -2.05, 0.92, 0)); // second car
  root.add(box(0.3, 0.2, 0.4, METAL, 0.75, 0.6, 0)); // couplings
  root.add(box(0.3, 0.2, 0.4, METAL, -1.2, 0.6, 0));
  const turret = new THREE.Group();
  turret.position.set(-0.25, 1.35, 0);
  turret.add(box(0.9, 0.45, 0.9, primary, 0, 0.23, 0));
  turret.add(box(0.05, 0.32, 0.7, DARK, 0.47, 0.25, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('landTrain', root, turret) });
});

// Legion doctrine.
registerModel('lightTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.0, 0.34, 0.38, 0.52));
  root.add(box(1.8, 0.38, 0.95, primary, 0, 0.52, 0));
  root.add(box(0.4, 0.2, 1.0, secondary, 0.75, 0.44, 0));
  const turret = new THREE.Group();
  turret.position.set(-0.05, 0.71, 0);
  turret.add(box(0.8, 0.32, 0.7, primary, 0, 0.16, 0));
  const gun = barrelPivot('lightTank', turret);
  gun.add(box(1.0, 0.11, 0.11, DARK, 0.47, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('lightTank', root, turret, [gun]) });
});

registerModel('carrier', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.2, 0.4, 0.42, 0.58));
  root.add(box(2.1, 0.7, 1.2, primary, 0, 0.75, 0));
  root.add(box(0.5, 0.4, 1.26, secondary, 0.9, 0.62, 0)); // nose plate
  root.add(box(0.06, 0.5, 0.7, DARK, -1.06, 0.75, 0)); // rear door the squad piles out of
  const turret = new THREE.Group();
  turret.position.set(0.3, 1.1, 0);
  turret.add(box(0.5, 0.25, 0.45, secondary, 0, 0.12, 0));
  const gun = barrelPivot('carrier', turret);
  gun.add(box(0.7, 0.08, 0.08, DARK, 0.3, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('carrier', root, turret, [gun]) });
});

// The Siege Crawler: a slab of a fortress on four track pods, with twin siege mortars on top.
registerModel('siegeCrawler', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  for (const x of [-1.0, 1.0]) for (const z of [-1.1, 1.1]) root.add(box(1.4, 0.6, 0.6, DARK, x, 0.3, z));
  root.add(box(3.2, 1.1, 2.0, primary, 0, 1.15, 0));
  root.add(box(2.4, 0.2, 1.8, secondary, -0.3, 1.8, 0));
  root.add(box(0.06, 0.6, 0.9, DARK, -1.61, 1.0, 0)); // squad hatch
  const turret = new THREE.Group();
  turret.position.set(0.3, 1.9, 0);
  turret.add(box(1.2, 0.5, 1.2, primary, 0, 0.25, 0));
  const tubes = barrelPivot('siegeCrawler', turret);
  for (const z of [-0.3, 0.3]) tubes.add(box(1.2, 0.3, 0.3, DARK, 0.4, 0, z));
  root.add(turret);
  return setRig(root, { turret, ...mounted('siegeCrawler', root, turret, [tubes]) });
});

// Infantry are camera-facing sprites: cheap to draw in crowds.
const TROOPER_W = 8;
const TROOPER_H = 12;

/** Pixel-art soldier, two walk frames side by side. Coloured per faction. */
/** What an infantry sprite carries: a rifle, an AT launcher on the shoulder, a mortar tube, a flamethrower and its fuel tank, or an engineer's wrench (with a hard hat). */
type Kit = 'rifle' | 'launcher' | 'mortar' | 'flamer' | 'cryo' | 'operator' | 'wrench' | 'civilian0' | 'civilian1' | 'civilian2' | 'militia' | 'cultist' | 'zealot';

/** Townsfolk's clothes (see game/towns.ts): shirt, hair or hat, and trousers. */
const TOWN_CLOTHES: Record<string, [string, string, string]> = {
  civilian0: ['#c9a25e', '#4a3222', '#5a5048'],
  civilian1: ['#6f8fa8', '#2a1e16', '#3d4a5a'],
  civilian2: ['#a8574a', '#8a6a3a', '#4e4a40'],
  militia: ['#7d7458', '#3a2a1c', '#4a4636'],
};

/** Two walk frames of an infantry sprite. */
function trooperSheet(faction: number, kit: Kit): THREE.CanvasTexture {
  const { primary, secondary } = factionColors(faction);
  const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  const canvas = document.createElement('canvas');
  canvas.width = TROOPER_W * 2;
  canvas.height = TROOPER_H;
  const g = canvas.getContext('2d')!;
  for (let frame = 0; frame < 2; frame++) {
    const ox = frame * TROOPER_W;
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      g.fillStyle = c;
      g.fillRect(ox + x, y, w, h);
    };
    if (kit === 'cultist' || kit === 'zealot') {
      // Leviathan's cult: dark hooded robes with a sash in the side's colour, faces in shadow.
      const robe = '#3a2a3a';
      px(2, 0, 4, 3, robe); // hood
      px(3, 1, 2, 2, '#1a1418'); // the shadow in it
      px(3, 2, 1, 1, '#d8d0c0'); // a pale chin
      px(2, 3, 4, kit === 'cultist' ? 7 : 5, robe); // robe, short for running in
      px(2, 5, 4, 1, hex(primary)); // sash
      px(2, 0, 4, 1, hex(secondary)); // hood trim
      px(1, 3, 1, 3, robe); // arm
      if (kit === 'cultist') {
        px(5, 4, 3, 1, '#5a3c22'); // old rifle
        px(7, 4, 1, 1, '#222');
        // The robe's hem sways between frames.
        if (frame === 0) px(2, 10, 4, 1, robe);
        else px(1, 10, 6, 1, robe);
        for (const x of frame === 0 ? [2, 4] : [1, 5]) px(x, 11, 2, 1, '#1d1d1d');
      } else {
        px(6, 1, 1, 4, '#6b4a2a'); // torch, held high
        px(6, 0, 1, 1, '#ffb43a');
        px(7, 0, 1, 1, '#ff7a2a');
        px(0, 5, 2, 2, '#6a5a3a'); // satchel charge
        for (const [x, y, w, h] of frame === 0 ? [[2, 8, 2, 3], [4, 8, 2, 3]] : [[1, 8, 2, 3], [5, 8, 2, 2]]) px(x, y, w, h, '#2a2228');
        px(1, 11, 3, 1, '#1d1d1d');
        px(4, 11, 3, 1, '#1d1d1d');
      }
      continue;
    }
    const clothes = TOWN_CLOTHES[kit];
    if (clothes) {
      // Townsfolk: bare heads (a flat cap for the militia), everyday clothes.
      px(2, 0, 4, 1, clothes[1]); // hair, or the cap's crown
      if (kit === 'militia') px(1, 1, 6, 1, clothes[1]); // cap brim
      else {
        px(2, 1, 1, 1, clothes[1]);
        px(5, 1, 1, 1, clothes[1]);
      }
      px(3, 1, 2, 2, '#e0b48a'); // face
      px(2, 3, 4, 4, clothes[0]); // shirt
      px(1, 3, 1, 3, clothes[0]); // arm
      if (kit === 'militia') {
        px(2, 4, 4, 1, '#d8d0b8'); // armband / bandolier
        px(5, 4, 3, 1, '#5a3c22'); // hunting rifle
      }
      for (const [x, y, w, h] of frame === 0 ? [[2, 7, 2, 4], [4, 7, 2, 4]] : [[1, 7, 2, 4], [5, 7, 2, 3]]) px(x, y, w, h, clothes[2]);
      px(1, 11, 3, 1, '#2a2018');
      px(4, 11, 3, 1, '#2a2018');
      continue;
    }
    px(2, 0, 4, 3, kit === 'wrench' ? '#f0c419' : hex(secondary)); // helmet (an engineer's hard hat)
    px(3, 2, 2, 1, '#e0b48a'); // face
    px(2, 3, 4, 4, hex(primary)); // torso
    if (kit === 'launcher') {
      px(0, 2, 8, 1, '#56603f'); // launcher tube over the shoulder
      px(0, 2, 1, 1, '#222');
    } else if (kit === 'mortar') {
      px(6, 0, 1, 6, '#4a4f3a'); // mortar tube carried upright
      px(5, 6, 3, 1, '#222'); // base plate
    } else if (kit === 'flamer') {
      px(0, 3, 1, 4, '#b0451c'); // fuel tank on the back
      px(5, 5, 2, 1, '#333'); // flame gun
      px(7, 5, 1, 1, '#ff8a2a');
    } else if (kit === 'cryo') {
      px(0, 3, 1, 4, '#bfe9ff'); // coolant tank on the back
      px(5, 5, 2, 1, '#333'); // sprayer
      px(7, 5, 1, 1, '#dff6ff');
    } else if (kit === 'operator') {
      px(0, 3, 2, 3, '#4a4f58'); // drone rack on the back
      px(0, 0, 1, 3, '#6a6f78'); // antenna
      px(0, 0, 1, 1, '#6ab8aa');
      px(5, 5, 2, 1, '#333'); // carbine
    } else if (kit === 'wrench') {
      px(1, 2, 1, 1, '#f0c419'); // hard hat brim, either side of the face
      px(6, 2, 1, 1, '#f0c419');
      px(6, 3, 1, 4, '#9aa0a8'); // wrench
      px(5, 3, 3, 1, '#9aa0a8');
      px(0, 4, 1, 3, '#6b4a2a'); // tool bag
    } else {
      px(5, 4, 3, 1, '#222'); // rifle
    }
    px(1, 3, 1, 3, hex(primary)); // arm
    // Legs alternate between frames.
    if (frame === 0) {
      px(2, 7, 2, 4, '#3a3a3a');
      px(4, 7, 2, 4, '#3a3a3a');
    } else {
      px(1, 7, 2, 4, '#3a3a3a');
      px(5, 7, 2, 3, '#3a3a3a');
    }
    px(1, 11, 3, 1, '#1d1d1d');
    px(4, 11, 3, 1, '#1d1d1d');
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(0.5, 1);
  return tex;
}

/** Sheets are keyed by colours, since faction colours can change between battles. */
const trooperSheets = new Map<string, THREE.CanvasTexture>();
const blobShadowGeometry = markShared(new THREE.CircleGeometry(0.22, 8).rotateX(-Math.PI / 2));
const blobShadowMaterial = markShared(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));

function infantry(faction: number, kit: Kit): THREE.Object3D {
  const { primary, secondary } = factionColors(faction);
  const key = `${primary}|${secondary}|${kit}`;
  let sheet = trooperSheets.get(key);
  if (!sheet) {
    sheet = markShared(trooperSheet(faction, kit));
    trooperSheets.set(key, sheet);
  }
  // Each sprite gets its own texture view (sharing the image) so frames animate independently.
  const tex = sheet.clone();
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 }));
  sprite.center.set(0.5, 0);
  // The batcher draws every sprite off one sheet together (see batcher.ts).
  sprite.userData.sheet = sheet;
  sprite.scale.set(0.5, 0.75, 1);
  const root = new THREE.Group();
  root.add(sprite);
  // A tiny blob shadow, since sprites don't cast real ones.
  const shadow = new THREE.Mesh(blobShadowGeometry, blobShadowMaterial);
  shadow.position.y = 0.03;
  shadow.userData.noShadow = true;
  root.add(shadow);

  let phase = Math.random() * 2;
  return setRig(root, {
    animate(s) {
      phase += s.dt * (s.speed > 0.05 ? 6 : 0);
      tex.offset.x = Math.floor(phase) % 2 === 0 ? 0 : 0.5;
    },
  });
}

// Armour's flak tank: a low hull with a squat turret and two short, raised barrels.
registerModel('flakTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.2, 0.4, 0.42, 0.58));
  root.add(box(2.0, 0.45, 1.1, primary, 0, 0.62, 0));
  const turret = new THREE.Group();
  turret.position.set(-0.1, 0.85, 0);
  turret.add(box(0.95, 0.42, 0.9, secondary, 0, 0.21, 0));
  const guns = barrelPivot('flakTank', turret);
  for (const side of [-1, 1]) {
    guns.add(box(1.1, 0.1, 0.1, DARK, 0.55, 0, side * 0.22));
    guns.add(box(0.2, 0.15, 0.15, METAL, 1.05, 0, side * 0.22));
  }
  root.add(turret);
  return setRig(root, { turret, ...mounted('flakTank', root, turret, [guns]) });
});

/** Spins rotor groups round their mast: `spin` is radians per second. */
function rotors(parts: { group: THREE.Group; spin: number }[]) {
  return (s: AnimState) => {
    for (const p of parts) p.group.rotation.y += p.spin * s.dt;
  };
}

/** A two-blade rotor on a mast, as a group to spin. */
function rotor(span: number, y: number, x = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  g.add(box(span, 0.03, 0.12, DARK, 0, 0, 0));
  g.add(box(0.12, 0.04, span, DARK, 0, 0, 0));
  return g;
}

// Aircraft. Their origin rides at flying height (see MoveRules.altitude); the models sit round it.
registerModel('scout', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(0.9, 0.4, 0.5, primary, 0.1, 0.25, 0)); // cabin
  root.add(box(0.3, 0.25, 0.42, GLASS, 0.6, 0.27, 0));
  root.add(box(1.1, 0.12, 0.12, primary, -0.85, 0.32, 0)); // tail boom
  root.add(box(0.12, 0.35, 0.05, secondary, -1.35, 0.45, 0)); // fin
  for (const side of [-1, 1]) root.add(box(0.8, 0.05, 0.05, DARK, 0.1, 0, side * 0.3)); // skids
  const blades = rotor(1.8, 0.55, 0.05);
  root.add(blades);
  const turret = new THREE.Group();
  turret.position.set(0.55, 0.05, 0);
  const gun = barrelPivot('scout', turret);
  gun.add(box(0.35, 0.08, 0.08, DARK, 0.18, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('scout', root, turret, [gun]), bank: 0.25, flies: true, animate: rotors([{ group: blades, spin: 30 }]) });
});

registerModel('gunship', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(1.5, 0.55, 0.7, primary, 0, 0.35, 0));
  root.add(box(0.4, 0.3, 0.5, GLASS, 0.85, 0.45, 0));
  root.add(box(1.4, 0.18, 0.18, primary, -1.3, 0.45, 0));
  root.add(box(0.15, 0.5, 0.06, secondary, -1.95, 0.6, 0));
  root.add(box(0.5, 0.06, 1.8, secondary, 0, 0.3, 0)); // stub wings
  for (const side of [-1, 1]) root.add(box(0.6, 0.16, 0.16, DARK, 0.1, 0.18, side * 0.85)); // rocket pods
  const blades = rotor(2.6, 0.75);
  root.add(blades);
  const turret = new THREE.Group();
  turret.position.set(0.7, 0.05, 0);
  turret.add(box(0.4, 0.1, 0.1, DARK, 0.2, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('gunship', root, turret), bank: 0.25, flies: true, animate: rotors([{ group: blades, spin: 26 }]) });
});

registerModel('bomber', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(2.2, 0.4, 0.55, primary, 0, 0.3, 0)); // fuselage
  root.add(box(0.35, 0.25, 0.4, GLASS, 1.1, 0.38, 0));
  root.add(box(0.8, 0.08, 3.0, secondary, 0.1, 0.35, 0)); // wings
  root.add(box(0.45, 0.06, 1.1, secondary, -1.0, 0.45, 0)); // tailplane
  root.add(box(0.4, 0.45, 0.06, primary, -1.0, 0.65, 0)); // fin
  for (const side of [-1, 1]) {
    root.add(box(0.6, 0.22, 0.22, METAL, 0.3, 0.24, side * 0.9)); // engines
  }
  root.add(box(0.9, 0.1, 0.3, DARK, 0.1, 0.08, 0)); // bomb bay
  // Bombs fall straight out of the bay: a fixed "turret" under the belly.
  const turret = new THREE.Group();
  turret.position.set(0.1, 0.05, 0);
  root.add(turret);
  return setRig(root, { turret, ...mounted('bomber', root, turret), bank: 0.8, flies: true });
});

// Skyline's strike jet: swept wings, twin tails, and cannon in the nose.
registerModel('jet', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(2.0, 0.3, 0.38, primary, 0, 0.3, 0)); // fuselage
  root.add(box(0.5, 0.2, 0.26, primary, 1.2, 0.28, 0)); // nose
  root.add(box(0.45, 0.18, 0.28, GLASS, 0.65, 0.48, 0)); // canopy
  for (const side of [-1, 1]) {
    const wing = box(0.9, 0.05, 1.1, secondary, -0.15, 0.27, side * 0.7);
    wing.rotation.y = side * 0.45; // swept back
    root.add(wing);
    const fin = box(0.4, 0.4, 0.05, primary, -0.85, 0.55, side * 0.16);
    fin.rotation.x = side * 0.25;
    root.add(fin);
    root.add(box(0.3, 0.04, 0.45, secondary, -0.9, 0.3, side * 0.35)); // tailplanes
    root.add(box(0.5, 0.05, 0.05, DARK, 1.35, 0.22, side * 0.1)); // cannon
  }
  root.add(glowBox(0.08, 0.16, 0.16, 0xffa040).translateX(-1.04).translateY(0.3)); // afterburner
  return setRig(root, { ...mounted('jet', root, null), bank: 0.6, flies: true });
});

registerModel('drone', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(0.45, 0.16, 0.45, primary, 0, 0.15, 0));
  const parts: { group: THREE.Group; spin: number }[] = [];
  for (const [x, z] of [[0.35, 0.35], [0.35, -0.35], [-0.35, 0.35], [-0.35, -0.35]]) {
    root.add(box(0.3, 0.04, 0.06, DARK, x / 2, 0.18, z / 2));
    const g = new THREE.Group();
    g.position.set(x, 0.22, z);
    g.add(box(0.4, 0.02, 0.06, DARK, 0, 0, 0));
    root.add(g);
    parts.push({ group: g, spin: 40 });
  }
  const turret = new THREE.Group();
  turret.position.set(0.2, 0.05, 0);
  const gun = barrelPivot('drone', turret);
  gun.add(box(0.2, 0.05, 0.05, DARK, 0.1, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('drone', root, turret, [gun]), flies: true, animate: rotors(parts) });
});

// Skyline's anti-air walker: a flak turret on long legs.
registerModel('flakWalker', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.7;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.0, 0.5, 0.9, primary, 0, 0.15, 0));
  turret.add(box(0.5, 0.15, 0.95, secondary, -0.2, 0.47, 0));
  const guns = barrelPivot('flakWalker', turret);
  for (const side of [-1, 1]) for (const up of [-1, 1]) guns.add(box(0.9, 0.08, 0.08, DARK, 0.45, up * 0.09, side * 0.25));
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.8, 0.85, 0.18, METAL, DARK);
    leg.hip.position.set(-0.05, -0.1, side * 0.35);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 0.9, 0.45), ...mounted('flakWalker', root, turret, [guns]) });
});

// Skyline's super unit: a slow armoured airship with a flight deck that launches drones.
registerModel('airship', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(4.6, 1.3, 1.7, primary, 0, 1.1, 0)); // envelope
  root.add(box(3.6, 1.5, 1.3, primary, 0, 1.1, 0));
  root.add(box(0.5, 0.9, 1.1, primary, 2.5, 1.1, 0)); // rounded nose
  root.add(box(2.4, 0.35, 0.9, METAL, 0.3, 0.25, 0)); // gondola and flight deck
  root.add(box(1.4, 0.06, 0.95, secondary, -0.4, 0.45, 0));
  for (const side of [-1, 1]) {
    root.add(box(0.8, 0.7, 0.08, secondary, -2.3, 1.2, side * 0.9)); // tail fins
    root.add(box(0.4, 0.3, 0.3, METAL, -1.0, 0.9, side * 1.0)); // engine pods
  }
  root.add(box(0.7, 0.08, 2.4, secondary, -2.3, 1.1, 0));
  const props = [-1, 1].map((side) => {
    const g = new THREE.Group();
    g.position.set(-1.25, 0.9, side * 1.0);
    g.add(box(0.03, 0.6, 0.08, DARK, 0, 0, 0));
    root.add(g);
    return g;
  });
  const turret = new THREE.Group();
  turret.position.set(1.0, 0.1, 0);
  turret.add(box(0.5, 0.25, 0.5, secondary, 0, 0, 0));
  const guns = barrelPivot('airship', turret);
  for (const side of [-1, 1]) guns.add(box(0.6, 0.08, 0.08, DARK, 0.3, 0, side * 0.1));
  root.add(turret);
  return setRig(root, {
    turret,
    ...mounted('airship', root, turret, [guns]),
    flies: true,
    animate: (s: AnimState) => {
      for (const g of props) g.rotation.x += 20 * s.dt;
    },
  });
});

// Bastion: a railgun on a tracked hull, and the Fortress Walker with a sensor mast on its back.
registerModel('railgun', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.3, 0.4, 0.42, 0.6));
  root.add(box(2.1, 0.42, 1.08, primary, 0, 0.6, 0));
  const turret = new THREE.Group();
  turret.position.set(-0.3, 0.81, 0);
  turret.add(box(1.0, 0.45, 0.9, secondary, 0, 0.22, 0));
  const gun = barrelPivot('railgun', turret);
  gun.add(box(0.5, 0.18, 0.36, METAL, 0.35, 0, 0)); // capacitor housing
  for (const side of [-1, 1]) gun.add(box(2.6, 0.1, 0.08, DARK, 1.3, 0, side * 0.12)); // twin rails
  gun.add(box(0.2, 0.08, 0.34, METAL, 2.52, 0, 0)); // muzzle brace, across the rails' ends
  root.add(turret);
  return setRig(root, { turret, ...mounted('railgun', root, turret, [gun]) });
});

registerModel('fortress', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.6;
  root.add(body);
  body.add(box(1.2, 0.5, 1.5, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.3;
  turret.add(box(2.0, 1.2, 1.9, primary, 0, 0.6, 0));
  turret.add(box(1.6, 0.25, 2.0, secondary, -0.1, 1.3, 0)); // armoured roof
  turret.add(box(0.3, 0.3, 1.0, GLASS, 1.05, 0.85, 0));
  for (const side of [-1, 1]) turret.add(box(1.6, 0.26, 0.26, DARK, 1.4, 0.45, side * 0.6)); // twin siege guns
  turret.add(box(0.1, 0.8, 0.1, METAL, -0.6, 1.8, 0)); // sensor mast
  turret.add(box(0.12, 0.5, 0.6, secondary, -0.5, 2.2, 0));
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.3, 1.3, 0.42, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.6);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.3), ...mounted('fortress', root, turret) });
});

/**
 * Spider legs: `pairs` legs down each side, splayed out and up to a knee and
 * down to the ground, scuttling in alternating threes. `height` is the body's
 * height above the ground.
 */
function spiderLegs(body: THREE.Group, pairs: number, length: number, spread: number, height: number, thickness: number) {
  const reach = length * 0.45;
  const raise = 0.6;
  const splay = 0.3;
  const shin = (height + reach * Math.sin(raise)) / Math.cos(splay);
  const hips: THREE.Group[] = [];
  const joints: { thigh: THREE.Group; knee: THREE.Group; side: number }[] = [];
  for (let i = 0; i < pairs; i++) {
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.name = 'leg';
      hip.position.set((i - (pairs - 1) / 2) * (length / pairs), 0, side * spread);
      const thigh = new THREE.Group();
      thigh.rotation.x = -side * raise;
      thigh.add(box(thickness, thickness, reach, METAL, 0, 0, (side * reach) / 2));
      const knee = new THREE.Group();
      knee.position.z = side * reach;
      knee.rotation.x = side * (raise - splay);
      knee.add(box(thickness * 0.8, shin, thickness * 0.8, DARK, 0, -shin / 2, 0));
      thigh.add(knee);
      hip.add(thigh);
      body.add(hip);
      hips.push(hip);
      joints.push({ thigh, knee, side });
    }
  }
  let phase = 0;
  let amount = 0;
  return {
    animate: (s: AnimState) => {
      phase += s.speed * s.dt * 6;
      amount += ((s.speed > 0.05 ? 1 : 0) - amount) * Math.min(1, s.dt * 6);
      hips.forEach((hip, k) => (hip.rotation.y = Math.sin(phase + (k % 2 === Math.floor(k / 2) % 2 ? 0 : Math.PI)) * 0.35 * amount));
    },
    /** A dead spider: it drops onto its belly, some legs splayed flat, some curled up under it, one or two gone. */
    wreck: (rng: Rng) => {
      joints.forEach(({ thigh, knee, side }, k) => {
        let net: number;
        if (rng.chance(0.5)) {
          thigh.rotation.x = -side * rng.range(0, 0.35);
          net = -side * rng.range(1.3, 1.55);
        } else {
          // Curled: the knee up, the shin folded in under the body.
          thigh.rotation.x = -side * rng.range(0.5, 0.9);
          net = side * rng.range(1.35, 1.65);
        }
        knee.rotation.x = net - thigh.rotation.x;
        if (rng.chance(0.15)) knee.visible = false;
        hips[k].rotation.y = rng.range(-0.4, 0.4);
      });
      body.rotation.x = rng.range(-0.12, 0.12);
      body.rotation.z = rng.range(-0.15, 0.15);
      return body;
    },
  };
}

// Talon: the spider walker, the Warhound and the Juggernaut.
registerModel('spider', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.7;
  root.add(body);
  body.add(box(1.0, 0.35, 0.8, primary, 0, 0, 0));
  body.add(box(0.5, 0.12, 0.6, secondary, -0.15, 0.235, 0));
  const turret = new THREE.Group();
  turret.position.set(0.25, 0.18, 0);
  turret.add(box(0.4, 0.22, 0.4, METAL, 0, 0.11, 0));
  const guns = barrelPivot('spider', turret);
  for (const side of [-1, 1]) guns.add(box(0.6, 0.07, 0.07, DARK, 0.25, 0, side * 0.1));
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 3, 1.0, 0.35, 0.7, 0.11), ...mounted('spider', root, turret, [guns]) });
});

// Bastion's test super unit: a howitzer on a giant spider's back.
registerModel('siegeSpider', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.3;
  root.add(body);
  body.add(box(3.0, 0.9, 2.2, primary, 0, 0, 0));
  body.add(box(2.4, 0.3, 1.8, secondary, -0.2, 0.6, 0));
  body.add(box(0.7, 0.5, 1.2, METAL, 1.65, -0.1, 0)); // head
  for (const side of [-1, 1]) body.add(glowBox(0.12, 0.12, 0.12, 0xffd27a).translateX(2.0).translateZ(side * 0.35));
  const turret = new THREE.Group();
  turret.position.set(-0.3, 0.75, 0);
  turret.add(box(1.5, 0.8, 1.4, METAL, 0, 0.4, 0));
  turret.add(box(1.2, 0.2, 1.5, secondary, -0.1, 0.9, 0));
  const barrel = barrelPivot('siegeSpider', turret);
  barrel.add(box(3.4, 0.3, 0.3, DARK, 1.7, 0, 0));
  barrel.add(box(0.5, 0.42, 0.42, METAL, 3.3, 0, 0));
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 4, 3.0, 0.9, 2.3, 0.3), ...mounted('siegeSpider', root, turret, [barrel]) });
});

registerModel('warhound', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.0;
  root.add(body);
  body.add(box(0.9, 0.4, 1.1, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.25;
  turret.add(box(1.4, 0.8, 1.3, primary, 0, 0.4, 0));
  turret.add(box(0.3, 0.22, 0.8, GLASS, 0.62, 0.55, 0));
  turret.add(box(1.0, 0.18, 1.36, secondary, -0.15, 0.85, 0));
  for (const side of [-1, 1]) {
    turret.add(box(0.5, 0.45, 0.35, secondary, 0.1, 0.35, side * 0.85)); // arms
    turret.add(box(1.3, 0.16, 0.16, DARK, 0.85, 0.3, side * 0.85)); // arm cannons
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.0, 1.0, 0.3, METAL, DARK);
    leg.hip.position.set(0, -0.05, side * 0.45);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.2, 0.45), ...mounted('warhound', root, turret) });
});

registerModel('juggernaut', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.9;
  root.add(body);
  body.add(box(1.4, 0.55, 1.7, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.35;
  turret.add(box(2.2, 1.3, 2.0, primary, 0, 0.65, 0));
  turret.add(box(0.35, 0.35, 1.2, GLASS, 1.2, 0.95, 0));
  turret.add(box(1.8, 0.3, 2.1, secondary, -0.2, 1.45, 0));
  for (const side of [-1, 1]) {
    // Shoulder missile racks, bigger than the Titan's, and heavy arms.
    const rack = new THREE.Group();
    rack.position.set(-0.2, 1.75, side * 1.25);
    rack.add(box(1.4, 0.8, 0.8, secondary));
    rack.add(box(0.05, 0.62, 0.62, DARK, 0.72, 0, 0));
    turret.add(rack);
    turret.add(box(0.6, 0.6, 0.5, primary, 0.1, 0.5, side * 1.25));
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.45, 1.45, 0.48, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.7);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.8, 0.3), ...mounted('juggernaut', root, turret) });
});

/** Hovers bob gently on their air cushion; boats rock on the water. */
function bob(part: THREE.Object3D, height: number, roll: number) {
  let phase = Math.random() * 6;
  const y = part.position.y;
  return (s: AnimState) => {
    phase += s.dt * 2.2;
    part.position.y = y + Math.sin(phase) * height;
    part.rotation.x = Math.sin(phase * 0.7) * roll;
  };
}

// Tidewater: the skimmer, missile boat, amphibious transport and Hover Fortress.
registerModel('skimmer', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);
  hull.add(box(2.0, 0.25, 1.3, DARK, 0, 0.2, 0)); // skirt
  hull.add(box(1.8, 0.35, 1.1, primary, 0, 0.45, 0));
  hull.add(box(0.4, 0.2, 1.16, secondary, 0.75, 0.38, 0)); // nose
  for (const side of [-1, 1]) hull.add(box(0.5, 0.12, 0.3, METAL, -0.75, 0.68, side * 0.35)); // lift fans
  const turret = new THREE.Group();
  turret.position.set(0.05, 0.62, 0);
  turret.add(box(0.7, 0.28, 0.6, secondary, 0, 0.14, 0));
  const gun = barrelPivot('skimmer', turret);
  gun.add(box(0.9, 0.1, 0.1, DARK, 0.4, 0, 0));
  hull.add(turret);
  return setRig(root, { turret, ...mounted('skimmer', root, turret, [gun]), animate: bob(hull, 0.04, 0) });
});

registerModel('missileBoat', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);
  hull.add(box(2.4, 0.4, 1.0, primary, 0, 0.1, 0));
  hull.add(box(0.5, 0.3, 0.7, primary, 1.3, 0.05, 0)); // bow
  hull.add(box(0.7, 0.5, 0.7, secondary, -0.5, 0.55, 0)); // wheelhouse
  hull.add(box(0.06, 0.2, 0.5, GLASS, -0.13, 0.65, 0));
  const turret = new THREE.Group();
  turret.position.set(0.55, 0.3, 0);
  turret.add(box(0.6, 0.3, 0.6, secondary, 0, 0.15, 0));
  const rack = barrelPivot('missileBoat', turret);
  rack.add(box(0.7, 0.35, 0.55, METAL));
  rack.add(box(0.05, 0.28, 0.45, DARK, 0.35, 0, 0));
  hull.add(turret);
  return setRig(root, { turret, ...mounted('missileBoat', root, turret, [rack]), animate: bob(hull, 0.05, 0.05) });
});

registerModel('amphib', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.7, 0, 0.7], 0.55, 0.45));
  root.add(box(2.2, 0.7, 1.15, primary, 0, 0.75, 0));
  root.add(box(0.5, 0.4, 1.0, secondary, 1.2, 0.65, 0)); // boat prow
  root.add(box(0.06, 0.5, 0.7, DARK, -1.13, 0.75, 0)); // rear door
  const turret = new THREE.Group();
  turret.position.set(0.2, 1.1, 0);
  turret.add(box(0.4, 0.2, 0.4, secondary, 0, 0.1, 0));
  const gun = barrelPivot('amphib', turret);
  gun.add(box(0.6, 0.07, 0.07, DARK, 0.25, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('amphib', root, turret, [gun]) });
});

registerModel('hoverFortress', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);
  hull.add(box(3.6, 0.4, 2.6, DARK, 0, 0.25, 0)); // skirt
  hull.add(box(3.4, 0.6, 2.4, primary, 0, 0.7, 0)); // deck
  hull.add(box(0.9, 0.9, 1.2, secondary, -0.9, 1.45, 0)); // bridge
  hull.add(box(0.06, 0.25, 0.9, GLASS, -0.42, 1.65, 0));
  for (const side of [-1, 1]) for (const x of [-1.35, 1.35]) hull.add(box(0.6, 0.15, 0.6, METAL, x, 1.05, side * 0.75)); // lift fans
  const turret = new THREE.Group();
  turret.position.set(0.6, 1.0, 0);
  turret.add(box(1.1, 0.4, 1.3, secondary, 0, 0.2, 0));
  const batteries = barrelPivot('hoverFortress', turret);
  for (const side of [-1, 1]) {
    batteries.add(box(0.9, 0.45, 0.45, METAL, 0.15, 0, side * 0.4));
    batteries.add(box(0.05, 0.36, 0.36, DARK, 0.6, 0, side * 0.4));
  }
  hull.add(turret);
  return setRig(root, { turret, ...mounted('hoverFortress', root, turret, [batteries]), animate: bob(hull, 0.05, 0) });
});

/** The Dreadnought: a long grey-hulled battleship in the side's colours, twin-gun turrets fore and aft, and a funnel. */
registerModel('dreadnought', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const hull = new THREE.Group();
  root.add(hull);
  hull.add(box(4.2, 0.55, 1.5, primary, -0.2, 0.15, 0)); // hull
  hull.add(box(0.8, 0.45, 1.0, primary, 2.2, 0.15, 0)); // bow
  hull.add(box(0.45, 0.35, 0.5, primary, 2.75, 0.15, 0)); // stem
  hull.add(box(4.6, 0.06, 1.56, DARK, 0.1, -0.1, 0)); // waterline
  hull.add(box(3.6, 0.05, 1.3, METAL, 0, 0.45, 0)); // deck
  hull.add(box(1.2, 0.6, 0.9, secondary, -0.35, 0.75, 0)); // superstructure
  hull.add(box(0.6, 0.45, 0.65, secondary, -0.15, 1.25, 0)); // bridge
  hull.add(box(0.06, 0.18, 0.55, GLASS, 0.16, 1.3, 0));
  hull.add(box(0.08, 0.9, 0.08, METAL, -0.35, 1.85, 0)); // mast
  hull.add(box(0.06, 0.06, 0.6, METAL, -0.35, 2.05, 0));
  hull.add(cylinder(0.22, 0.26, 0.7, 8, DARK, -0.95, 1.05, 0)); // funnel
  const gun = (x: number) => {
    const t = new THREE.Group();
    t.position.set(x, 0.5, 0);
    t.add(box(0.75, 0.32, 0.7, secondary, 0, 0.16, 0));
    const barrels = barrelPivot('dreadnought', t);
    for (const side of [-1, 1]) barrels.add(box(1.0, 0.09, 0.09, DARK, 0.45, 0, side * 0.16));
    hull.add(t);
    return [t, barrels] as const;
  };
  const [turret, fore] = gun(1.15);
  const [aft, aftBarrels] = gun(-1.75);
  const rock = bob(hull, 0.04, 0.03);
  return setRig(root, {
    turret,
    ...mounted('dreadnought', root, turret, [fore, aftBarrels]),
    animate(s) {
      rock(s);
      aft.rotation.y = turret.rotation.y;
    },
  });
});

// Firestorm: the scorch buggy, Cinder Walker and Inferno Walker, all with fuel tanks to feed the flames.
const FUEL = 0xb0451c;
const FLAME_TIP = 0xff8a2a;

registerModel('scorchBuggy', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.45, 0.45], 0.4, 0.36));
  root.add(box(1.3, 0.24, 0.62, primary, 0, 0.44, 0));
  root.add(cylinder(0.22, 0.22, 0.45, 8, FUEL, -0.4, 0.78, 0));
  const turret = new THREE.Group();
  turret.position.set(0.25, 0.56, 0);
  turret.add(box(0.3, 0.2, 0.3, DARK, 0, 0.1, 0));
  const nozzle = barrelPivot('scorchBuggy', turret);
  nozzle.add(box(0.6, 0.09, 0.09, METAL, 0.25, 0, 0));
  nozzle.add(box(0.1, 0.14, 0.14, FLAME_TIP, 0.58, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('scorchBuggy', root, turret, [nozzle]) });
});

registerModel('cinderWalker', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.5;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.1, 0.6, 1.0, primary, 0, 0.2, 0));
  turret.add(box(0.3, 0.18, 0.6, GLASS, 0.5, 0.35, 0));
  for (const side of [-1, 1]) {
    turret.add(cylinder(0.2, 0.2, 0.7, 8, FUEL, -0.6, 0.35, side * 0.25)); // fuel tanks on its back
    turret.add(box(0.9, 0.14, 0.14, DARK, 0.8, 0.05, side * 0.45)); // flame lances
    turret.add(box(0.12, 0.2, 0.2, FLAME_TIP, 1.25, 0.05, side * 0.45));
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.75, 0.78, 0.22, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.3);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 0.9, 0.45), ...mounted('cinderWalker', root, turret) });
});

registerModel('inferno', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.65;
  root.add(body);
  body.add(box(2.6, 0.7, 1.6, primary, 0, 0, 0));
  body.add(box(2.0, 0.2, 1.66, secondary, -0.2, 0.45, 0));
  for (const side of [-1, 1]) body.add(cylinder(0.3, 0.3, 0.8, 8, FUEL, -0.9, 0.95, side * 0.45));
  const turret = new THREE.Group();
  turret.position.set(0.8, 0.55, 0);
  turret.add(box(0.9, 0.5, 1.0, secondary, 0, 0.25, 0));
  turret.add(box(0.2, 0.2, 0.7, GLASS, 0.5, 0.35, 0));
  for (const side of [-1, 1]) {
    turret.add(box(1.2, 0.2, 0.2, DARK, 0.9, 0.12, side * 0.35)); // projectors
    turret.add(box(0.14, 0.28, 0.28, FLAME_TIP, 1.5, 0.12, side * 0.35));
  }
  body.add(turret);
  // Four legs, stepping in diagonal pairs: front left with back right.
  const legs = [
    [0.9, -0.75],
    [0.9, 0.75],
    [-0.9, 0.75],
    [-0.9, -0.75],
  ].map(([x, z]) => {
    const leg = makeLeg(1.15, 1.2, 0.34, METAL, DARK);
    leg.hip.position.set(x, -0.3, z);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.4, 0.3), ...mounted('inferno', root, turret) });
});

registerModel('trooper', (faction) => infantry(faction, 'rifle'));
registerModel('atTrooper', (faction) => infantry(faction, 'launcher'));
registerModel('mortar', (faction) => infantry(faction, 'mortar'));
registerModel('flameTrooper', (faction) => infantry(faction, 'flamer'));
registerModel('cryoTrooper', (faction) => infantry(faction, 'cryo'));
registerModel('droneOperator', (faction) => infantry(faction, 'operator'));
registerModel('engineer', (faction) => infantry(faction, 'wrench'));
// Townsfolk (see game/towns.ts): three sets of everyday clothes, and the militia.
registerModel('civilian:0', (faction) => infantry(faction, 'civilian0'));
registerModel('civilian:1', (faction) => infantry(faction, 'civilian1'));
registerModel('civilian:2', (faction) => infantry(faction, 'civilian2'));
registerModel('militia', (faction) => infantry(faction, 'militia'));

// Shared dark material for burnt-out hulks.
export const CHARRED = flatMaterial(0x2a2623);

/** Pale glassy blue: Aegis's emitters, Rime's ice. */
const ICE = 0xcfefff;
const EMITTER = 0x9fe3ff;

// Aegis: a truck with a dome emitter on its bed and a pintle gun on the cab.
registerModel('domeTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.6, 0.6], 0.46, 0.44));
  root.add(box(1.9, 0.25, 0.86, METAL, 0, 0.5, 0));
  root.add(box(0.6, 0.55, 0.84, primary, 0.62, 0.88, 0)); // cab
  root.add(box(0.06, 0.25, 0.6, GLASS, 0.93, 0.98, 0));
  root.add(cylinder(0.32, 0.42, 0.3, 8, secondary, -0.4, 0.75, 0)); // emitter base
  root.add(cylinder(0.12, 0.12, 0.4, 6, METAL, -0.4, 1.05, 0));
  const orb = glowBox(0.32, 0.32, 0.32, EMITTER);
  orb.position.set(-0.4, 1.32, 0);
  root.add(orb);
  const turret = new THREE.Group();
  turret.position.set(0.55, 1.15, 0);
  turret.add(cylinder(0.2, 0.24, 0.1, 8, METAL, 0, 0.04, 0)); // ring mount on the cab roof
  turret.add(box(0.1, 0.18, 0.1, DARK, 0, 0.17, 0));
  const gun = barrelPivot('domeTruck', turret);
  gun.add(box(0.3, 0.15, 0.17, DARK, 0.03, 0.01, 0)); // receiver
  gun.add(box(0.04, 0.2, 0.32, secondary, 0.21, 0.06, 0)); // gun shield
  gun.add(box(0.58, 0.07, 0.07, DARK, 0.26, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('domeTruck', root, turret, [gun]) });
});

// Aegis: a two-legged walker with one long lance down its right side.
registerModel('lanceWalker', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.75;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.0, 0.6, 0.8, primary, 0, 0.15, 0));
  turret.add(box(0.3, 0.22, 0.5, GLASS, 0.45, 0.3, 0));
  turret.add(box(0.6, 0.14, 0.86, secondary, -0.1, 0.5, 0));
  turret.add(box(0.3, 0.25, 0.2, METAL, 0, 0.05, -0.45)); // shoulder
  turret.add(box(1.6, 0.14, 0.14, DARK, 0.7, 0, -0.5)); // the lance
  turret.add(box(0.4, 0.24, 0.24, secondary, 0.32, 0, -0.5)); // its coil
  const tip = glowBox(0.12, 0.1, 0.1, EMITTER);
  tip.position.set(1.3, 0, -0.5);
  turret.add(tip);
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.85, 0.9, 0.18, METAL, DARK);
    leg.hip.position.set(-0.05, -0.05, side * 0.3);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 0.95, 0.5), ...mounted('lanceWalker', root, turret) });
});

// Aegis's super unit: a heavy walker with a dome emitter on its back and a lance on each arm.
registerModel('citadel', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.8;
  root.add(body);
  body.add(box(1.3, 0.5, 1.6, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.3;
  turret.add(box(2.0, 1.2, 2.0, primary, 0, 0.6, 0));
  turret.add(box(0.3, 0.3, 1.1, GLASS, 1.05, 0.8, 0));
  turret.add(box(1.6, 0.25, 2.1, secondary, -0.1, 1.3, 0));
  turret.add(cylinder(0.5, 0.7, 0.4, 8, secondary, -0.2, 1.6, 0)); // emitter
  const orb = glowBox(0.45, 0.3, 0.45, EMITTER);
  orb.position.set(-0.2, 1.9, 0);
  turret.add(orb);
  for (const side of [-1, 1]) {
    turret.add(box(0.6, 0.55, 0.45, secondary, 0.2, 0.5, side * 1.2)); // arms
    turret.add(box(1.4, 0.2, 0.2, DARK, 0.9, 0.5, side * 1.2)); // lances
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.4, 1.4, 0.45, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.65);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.3), ...mounted('citadel', root, turret) });
});

// Rime: a tank with ice crystals along its hull.
registerModel('shardTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.2, 0.4, 0.45, 0.58));
  root.add(box(2.0, 0.45, 1.06, primary, 0, 0.6, 0));
  root.add(box(0.45, 0.22, 1.12, secondary, 0.8, 0.48, 0)); // glacis
  for (const z of [-0.35, 0.35]) {
    const shard = box(0.18, 0.35, 0.18, ICE, -0.7, 0.92, z);
    shard.rotation.x = z * 0.9;
    root.add(shard);
  }
  const turret = new THREE.Group();
  turret.position.set(-0.1, 0.83, 0);
  turret.add(box(1.0, 0.4, 0.85, primary, 0, 0.2, 0));
  turret.add(box(0.45, 0.12, 0.6, ICE, -0.2, 0.45, 0));
  const gun = barrelPivot('shardTank', turret);
  gun.add(box(1.3, 0.14, 0.14, DARK, 0.65, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('shardTank', root, turret, [gun]) });
});

// Rime: a truck with a coolant tank and a frost mortar on the back.
registerModel('freezerTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.7, 0, 0.7], 0.44, 0.42));
  root.add(box(2.0, 0.25, 0.85, METAL, 0, 0.5, 0));
  root.add(box(0.6, 0.6, 0.82, primary, 0.68, 0.9, 0)); // cab
  root.add(box(0.06, 0.26, 0.62, GLASS, 1.01, 1.02, 0));
  const tank = cylinder(0.3, 0.3, 0.65, 8, ICE, -0.02, 0.92, 0); // coolant tank, lying along the bed
  tank.rotation.z = Math.PI / 2;
  root.add(tank);
  const turret = new THREE.Group();
  turret.position.set(-0.7, 0.62, 0);
  turret.add(box(0.45, 0.2, 0.45, secondary, 0, 0.1, 0));
  // A cheek either side and a pin through them that the mortar tips on.
  for (const z of [-0.14, 0.14]) turret.add(box(0.2, 0.24, 0.04, METAL, 0.05, 0.3, z));
  const pin = cylinder(0.05, 0.05, 0.34, 6, DARK, 0.05, 0.36, 0);
  pin.rotation.x = Math.PI / 2;
  turret.add(pin);
  const tube = barrelPivot('freezerTruck', turret);
  // Held a little behind its middle, its back end clearing the base when it rests tipped up.
  tube.add(box(0.72, 0.22, 0.22, DARK, 0.3, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('freezerTruck', root, turret, [tube]) });
});

// Rime's super unit: a frosted walker with shard cannons on its shoulders and ice on its back.
registerModel('glacier', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.9;
  root.add(body);
  body.add(box(1.4, 0.55, 1.7, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.35;
  turret.add(box(2.2, 1.3, 2.0, primary, 0, 0.65, 0));
  turret.add(box(0.35, 0.35, 1.2, GLASS, 1.2, 0.95, 0));
  turret.add(box(1.8, 0.3, 2.1, ICE, -0.2, 1.45, 0));
  for (const z of [-0.5, 0.5]) {
    const spike = box(0.3, 0.6, 0.3, ICE, -0.6, 1.8, z);
    spike.rotation.x = z * 0.6;
    turret.add(spike);
  }
  for (const side of [-1, 1]) {
    turret.add(box(0.6, 0.6, 0.5, secondary, 0.1, 0.55, side * 1.22));
    turret.add(box(1.5, 0.22, 0.22, DARK, 0.8, 0.55, side * 1.22));
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.45, 1.45, 0.48, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.7);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.8, 0.3), ...mounted('glacier', root, turret) });
});

const BLADE = 0xc8ccd2;

/** A gun on a mount of its own (see UnitDef.mounts): a turret group at the mount's point, for the rig's `mounts`. */
function ownMount(root: THREE.Object3D, key: string, build: (turret: THREE.Group) => void): { turret: THREE.Group } {
  const mount = mountOf(key);
  if (!mount) throw new Error(`No mount for "${key}"`);
  const turret = new THREE.Group();
  turret.position.set(...mount.turret);
  build(turret);
  for (const [x, y, z] of mount.muzzles) {
    const m = new THREE.Object3D();
    m.name = 'muzzle';
    m.position.set(x, y, z);
    turret.add(m);
  }
  root.add(turret);
  return { turret };
}

// Sabre: a light two-legged mech with a blade down its right arm and a cannon on its left.
registerModel('duelist', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.2;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(0.78, 0.44, 0.6, primary, 0, 0.08, 0));
  turret.add(box(0.24, 0.18, 0.4, GLASS, 0.35, 0.17, 0));
  turret.add(box(0.44, 0.1, 0.66, secondary, -0.13, 0.26, 0));
  const arm = new THREE.Group();
  arm.position.set(0.17, 0, -0.36);
  arm.add(box(0.26, 0.18, 0.18, METAL, 0, 0, 0));
  arm.add(box(0.96, 0.06, 0.14, BLADE, 0.48, 0, 0));
  turret.add(arm);
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.58, 0.62, 0.12, METAL, DARK);
    leg.hip.position.set(-0.05, -0.05, side * 0.22);
    body.add(leg.hip);
    return leg;
  });
  // An arm cannon on its left, opposite the blade: it swings on its own shoulder, and bobs with the body as it walks.
  const gun = ownMount(root, 'duelist#gun', (t) => {
    t.add(box(0.19, 0.17, 0.17, METAL, 0, 0, 0));
    t.add(box(0.31, 0.12, 0.12, secondary, 0.145, -0.01, 0.005));
    t.add(box(0.26, 0.08, 0.08, DARK, 0.38, 0, 0));
  });
  body.add(gun.turret);
  gun.turret.position.y -= body.position.y;
  return setRig(root, {
    turret,
    ...walker(legs, body, 0.75, 0.55),
    ...mounted('duelist', root, turret),
    mounts: [gun],
    // The blade sweeps across in front of it.
    strike(k) {
      arm.rotation.y = Math.sin(Math.PI * k) * 1.3;
    },
  });
});

// Sabre: a heavy tank whose turret carries a great axe arm, and a machine gun in the hull.
registerModel('reaver', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.8, 0.5, 0.55, 0.75));
  root.add(box(2.6, 0.55, 1.4, primary, 0, 0.75, 0));
  root.add(box(0.56, 0.3, 1.46, secondary, 1.1, 0.62, 0)); // ram plate
  const turret = new THREE.Group();
  turret.position.set(-0.15, 1.03, 0);
  turret.add(box(1.2, 0.48, 1.08, primary, 0, 0.24, 0));
  turret.add(box(0.58, 0.14, 0.8, secondary, -0.28, 0.55, 0));
  // The arm swings across in front of the turret as it strikes; at rest it points straight ahead.
  const arm = new THREE.Group();
  arm.position.set(0.4, 0.32, 0);
  arm.add(box(0.42, 0.34, 0.42, METAL, 0, 0, 0)); // shoulder
  arm.add(box(1.6, 0.18, 0.18, METAL, 0.98, 0, 0));
  arm.add(box(0.7, 0.07, 0.46, BLADE, 2.07, 0, 0.15)); // the axe head
  arm.add(box(0.4, 0.06, 0.26, BLADE, 2.18, 0.01, -0.2));
  turret.add(arm);
  root.add(turret);
  const mg = ownMount(root, 'reaver#mg', (t) => {
    t.add(box(0.26, 0.13, 0.2, DARK, 0.08, 0.035, 0));
    t.add(box(0.4, 0.06, 0.06, DARK, 0.3, 0.1, 0));
  });
  return setRig(root, {
    turret,
    ...mounted('reaver', root, turret),
    mounts: [mg],
    // The arm sweeps across from one side to the other.
    strike(k) {
      arm.rotation.y = Math.cos(Math.PI * k) * 1.1 * Math.sin(Math.PI * k) * 2;
    },
  });
});

// Sabre's super unit: a giant with hammer fists and a rocket rack on its back.
registerModel('colossus', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.9;
  root.add(body);
  body.add(box(1.4, 0.55, 1.7, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.35;
  turret.add(box(2.2, 1.3, 2.0, primary, 0, 0.65, 0));
  turret.add(box(0.35, 0.35, 1.2, GLASS, 1.2, 0.95, 0));
  turret.add(box(1.8, 0.3, 2.1, secondary, -0.2, 1.45, 0));
  const fists = new THREE.Group();
  for (const side of [-1, 1]) {
    fists.add(box(0.7, 0.7, 0.6, secondary, 0.3, 0.4, side * 1.25));
    fists.add(box(1.2, 0.5, 0.5, METAL, 1.0, 0.4, side * 1.25));
  }
  turret.add(fists);
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.45, 1.45, 0.5, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.7);
    body.add(leg.hip);
    return leg;
  });
  const rack = ownMount(root, 'colossus#rockets', (t) => {
    t.add(box(0.6, 0.2, 0.6, DARK, 0, 0.08, 0));
    t.add(box(0.9, 0.5, 1.0, secondary, 0.1, 0.45, 0));
    for (const z of [-0.25, 0.25]) t.add(box(0.05, 0.36, 0.36, DARK, 0.585, 0.45, z));
  });
  // On its back: it bobs with the body as it walks, and comes down with it when it falls.
  body.add(rack.turret);
  rack.turret.position.y -= body.position.y;
  return setRig(root, {
    turret,
    ...walker(legs, body, 1.8, 0.3),
    ...mounted('colossus', root, turret),
    mounts: [rack],
    // The fists come up and slam down.
    strike(k) {
      fists.position.y = Math.sin(Math.PI * k) * 0.8;
    },
  });
});

/** Cipher's signal glow. */
const SIGNAL = 0x6ab8aa;

// Cipher: a boxy van with a hacking dish on its roof and a pintle gun up front.
registerModel('hackVan', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.6, 0.6], 0.46, 0.44));
  root.add(box(1.9, 0.2, 0.84, METAL, 0, 0.45, 0)); // chassis
  root.add(box(1.95, 0.72, 0.9, primary, -0.05, 0.86, 0)); // van body
  root.add(box(1.97, 0.1, 0.92, secondary, -0.05, 0.78, 0)); // stripe
  root.add(box(0.06, 0.3, 0.72, GLASS, 0.94, 1.0, 0)); // windscreen
  root.add(box(0.5, 0.06, 0.6, DARK, -0.4, 1.25, 0)); // roof plate
  const turret = new THREE.Group();
  turret.position.set(-0.4, 1.28, 0);
  turret.add(cylinder(0.1, 0.12, 0.26, 6, DARK, 0, 0.13, 0));
  // A yoke on the post, and a pin through it that the dish tips on.
  turret.add(box(0.1, 0.04, 0.3, METAL, 0, 0.27, 0));
  for (const z of [-0.13, 0.13]) turret.add(box(0.12, 0.2, 0.03, METAL, 0, 0.32, z));
  const pin = cylinder(0.045, 0.045, 0.32, 6, DARK, 0, 0.3, 0);
  pin.rotation.x = Math.PI / 2;
  turret.add(pin);
  const dish = barrelPivot('hackVan', turret);
  dish.add(cylinder(0.42, 0.08, 0.16, 10, secondary, 0.12, 0, 0).rotateZ(-Math.PI / 2));
  const core = glowBox(0.12, 0.12, 0.12, SIGNAL);
  core.position.set(0.3, 0, 0);
  dish.add(core);
  root.add(turret);
  // A pintle gun on a ring mount, with a gun shield, like the dome truck's.
  const gun = ownMount(root, 'hackVan#gun', (t) => {
    t.add(cylinder(0.2, 0.24, 0.1, 8, METAL, 0, 0.04, 0)); // ring mount
    t.add(box(0.1, 0.18, 0.1, DARK, 0, 0.17, 0));
    t.add(box(0.3, 0.15, 0.17, DARK, 0.03, 0.27, 0)); // receiver
    t.add(box(0.04, 0.2, 0.32, secondary, 0.21, 0.32, 0)); // gun shield
    t.add(box(0.58, 0.07, 0.07, DARK, 0.26, 0.26, 0));
  });
  return setRig(root, { turret, ...mounted('hackVan', root, turret, [dish]), mounts: [gun] });
});


// Cipher: a walker with twin guns and a jamming mast whose rings pulse.
registerModel('jammer', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.6;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.0, 0.55, 0.8, primary, 0, 0.1, 0));
  turret.add(box(0.3, 0.2, 0.5, GLASS, 0.45, 0.22, 0));
  for (const side of [-1, 1]) turret.add(box(0.8, 0.1, 0.1, DARK, 0.55, -0.05, side * 0.42));
  turret.add(box(0.12, 1.1, 0.12, METAL, -0.3, 0.9, 0)); // the mast
  const rings: THREE.Object3D[] = [];
  for (const y of [0.75, 1.05, 1.35]) {
    const ring = glowBox(0.36, 0.06, 0.36, SIGNAL);
    ring.position.set(-0.3, y, 0);
    turret.add(ring);
    rings.push(ring);
  }
  turret.add(box(0.6, 0.12, 0.86, secondary, -0.05, 0.43, 0));
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.78, 0.82, 0.18, METAL, DARK);
    leg.hip.position.set(-0.05, -0.05, side * 0.3);
    body.add(leg.hip);
    return leg;
  });
  const walk = walker(legs, body, 0.9, 0.5);
  let t = Math.random() * 3;
  return setRig(root, {
    turret,
    ...walk,
    ...mounted('jammer', root, turret),
    animate(state) {
      walk.animate?.(state);
      // The rings pulse in turn, up the mast.
      t += state.dt;
      rings.forEach((r, i) => r.scale.setScalar(1 + 0.25 * Math.max(0, Math.sin(t * 4 - i * 1.2))));
    },
  });
});

// Cipher's super unit: a heavy walker with twin cannons and a hack array on its back.
registerModel('overmind', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.8;
  root.add(body);
  body.add(box(1.3, 0.5, 1.6, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.3;
  turret.add(box(2.0, 1.2, 2.0, primary, 0, 0.6, 0));
  turret.add(box(0.3, 0.3, 1.1, GLASS, 1.05, 0.8, 0));
  turret.add(box(1.6, 0.25, 2.1, secondary, -0.1, 1.3, 0));
  for (const side of [-1, 1]) {
    turret.add(box(0.6, 0.55, 0.45, secondary, 0.2, 0.5, side * 1.2)); // arms
    turret.add(box(1.4, 0.2, 0.2, DARK, 0.9, 0.5, side * 1.2)); // cannons
  }
  for (const z of [-0.6, 0.6]) {
    const node = glowBox(0.2, 0.2, 0.2, SIGNAL);
    node.position.set(-1.05, 0.7, z);
    turret.add(node);
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.4, 1.4, 0.45, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.65);
    body.add(leg.hip);
    return leg;
  });
  const array = ownMount(root, 'overmind#array', (t) => {
    t.add(cylinder(0.18, 0.22, 0.3, 8, METAL, 0, -0.17, 0)); // a mast down into its back
    t.add(cylinder(0.25, 0.3, 0.3, 8, DARK, 0, 0.1, 0));
    t.add(box(0.42, 0.14, 0.12, DARK, 0.2, 0.3, 0)); // a boom out to the dish
    t.add(cylinder(0.7, 0.15, 0.25, 12, secondary, 0.5, 0.35, 0).rotateZ(-Math.PI / 2));
    const core = glowBox(0.18, 0.18, 0.18, SIGNAL);
    core.position.set(0.72, 0.35, 0);
    t.add(core);
  });
  // On its back: it bobs with the body as it walks, and comes down with it when it falls.
  body.add(array.turret);
  array.turret.position.y -= body.position.y;
  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.3), ...mounted('overmind', root, turret), mounts: [array] });
});

/** Veil's soot-dark stacks and vents. */
const SOOT = 0x34303a;

registerModel('shadeTrooper', (faction) => infantry(faction, 'launcher'));

// Veil: a truck with a smoke mortar on its bed and canisters racked behind the cab.
registerModel('smokeTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.7, 0, 0.7], 0.44, 0.42));
  root.add(box(2.0, 0.25, 0.85, METAL, 0, 0.5, 0));
  root.add(box(0.6, 0.6, 0.82, primary, 0.68, 0.9, 0)); // cab
  root.add(box(0.06, 0.26, 0.62, GLASS, 1.01, 1.02, 0));
  for (const z of [-0.24, 0, 0.24]) root.add(cylinder(0.1, 0.1, 0.4, 6, SOOT, 0.1, 0.83, z)); // canisters
  const turret = new THREE.Group();
  turret.position.set(-0.7, 0.62, 0);
  turret.add(box(0.45, 0.2, 0.45, secondary, 0, 0.1, 0));
  // A cheek either side and a pin through them that the mortar tips on.
  for (const z of [-0.155, 0.155]) turret.add(box(0.2, 0.28, 0.04, METAL, 0.05, 0.32, z));
  const pin = cylinder(0.05, 0.05, 0.37, 6, DARK, 0.05, 0.4, 0);
  pin.rotation.x = Math.PI / 2;
  turret.add(pin);
  const tube = barrelPivot('smokeTruck', turret);
  // Held a little behind its middle, its back end clearing the base when it rests tipped up.
  tube.add(box(0.9, 0.24, 0.24, SOOT, 0.28, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('smokeTruck', root, turret, [tube]) });
});

// Veil: a low, angular tank with sloped plates and a long thin gun.
registerModel('ghostTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.2, 0.38, 0.42, 0.58));
  root.add(box(2.0, 0.38, 1.05, primary, 0, 0.56, 0));
  // An angled bumper out ahead of the hull, a little wider than it.
  const glacis = box(0.45, 0.12, 1.15, secondary, 1.2, 0.61, 0);
  glacis.rotation.z = -0.5;
  root.add(glacis);
  const turret = new THREE.Group();
  turret.position.set(-0.1, 0.8, 0);
  turret.add(box(0.95, 0.3, 0.8, primary, 0, 0.15, 0));
  turret.add(box(0.5, 0.1, 0.6, secondary, -0.2, 0.35, 0));
  const gun = barrelPivot('ghostTank', turret);
  gun.add(box(1.3, 0.11, 0.11, DARK, 0.65, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('ghostTank', root, turret, [gun]) });
});

// Veil's super unit: a heavy walker with twin cannons and smoke stacks pouring off its back.
registerModel('eclipse', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.8;
  root.add(body);
  body.add(box(1.3, 0.5, 1.6, METAL, 0, 0, 0));
  const turret = new THREE.Group();
  turret.position.y = 0.3;
  turret.add(box(2.0, 1.2, 2.0, primary, 0, 0.6, 0));
  turret.add(box(0.3, 0.3, 1.1, GLASS, 1.05, 0.8, 0));
  turret.add(box(1.6, 0.25, 2.1, secondary, -0.1, 1.3, 0));
  for (const side of [-1, 1]) {
    turret.add(box(0.6, 0.55, 0.45, secondary, 0.2, 0.5, side * 1.2)); // arms
    turret.add(box(1.4, 0.2, 0.2, DARK, 0.9, 0.5, side * 1.2)); // cannons
  }
  for (const z of [-0.55, 0.55]) turret.add(cylinder(0.22, 0.28, 1.0, 8, SOOT, -0.75, 1.9, z)); // stacks
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.4, 1.4, 0.45, METAL, DARK);
    leg.hip.position.set(0, -0.1, side * 0.65);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.3), ...mounted('eclipse', root, turret) });
});

// Zenith: drops and orbital strikes.
const BEACON = 0xffd27a;

// A fast little tracked scout with a pintle gun on a post up front and a tall beacon mast behind it, its lamp lit.
registerModel('beaconRunner', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(1.4, 0.26, 0.3, 0.36));
  root.add(box(1.25, 0.28, 0.66, primary, 0, 0.42, 0));
  root.add(box(0.36, 0.12, 0.7, secondary, 0.5, 0.36, 0));
  // The beacon mast at the back, with a steady lamp on top.
  root.add(box(0.12, 0.08, 0.12, METAL, -0.35, 0.6, 0.15));
  root.add(box(0.07, 1.5, 0.07, METAL, -0.35, 1.32, 0.15));
  const lamp = glowBox(0.16, 0.16, 0.16, BEACON);
  lamp.position.set(-0.35, 2.12, 0.15);
  root.add(lamp);
  // The pintle gun up front, on a post standing on the hull.
  const turret = new THREE.Group();
  turret.position.set(0.3, 0.56, 0);
  turret.add(box(0.08, 0.18, 0.08, METAL, 0, 0.09, 0));
  turret.add(box(0.22, 0.1, 0.16, METAL, 0.02, 0.22, 0));
  turret.add(box(0.36, 0.05, 0.05, DARK, 0.3, 0.24, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('beaconRunner', root, turret) });
});

// A tracked truck with a tall mast on its bed, and a targeting laser on top that paints where the strike will land.
registerModel('uplinkTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.0, 0.34, 0.36, 0.5));
  root.add(box(0.7, 0.55, 0.95, primary, 0.6, 0.72, 0)); // cab
  root.add(box(0.2, 0.22, 0.9, GLASS, 0.96, 0.82, 0));
  root.add(box(1.2, 0.2, 1.0, METAL, -0.35, 0.5, 0)); // bed
  const turret = new THREE.Group();
  turret.position.set(-0.55, 0.75, 0);
  turret.add(box(0.5, 0.2, 0.5, secondary, 0, 0.1, 0));
  turret.add(box(0.14, 1.6, 0.14, METAL, 0, 0.95, 0)); // mast
  turret.add(box(0.04, 1.3, 0.3, primary, -0.09, 0.9, 0)); // fin down the mast
  const laser = barrelPivot('uplinkTruck', turret);
  laser.add(box(0.55, 0.16, 0.16, DARK, 0.15, 0, 0));
  const lens = glowBox(0.06, 0.1, 0.1, 0xff6a3a);
  lens.position.set(0.44, 0, 0);
  laser.add(lens);
  root.add(turret);
  return setRig(root, { turret, ...mounted('uplinkTruck', root, turret, [laser]) });
});

// Zenith's super unit: a slow four-legged platform with a long lance it points at the sky, and point guns on its back.
registerModel('lancePlatform', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.4;
  root.add(body);
  body.add(box(3.2, 0.9, 2.4, primary, 0, 0, 0));
  body.add(box(2.6, 0.25, 2.0, secondary, -0.2, 0.55, 0));
  for (const side of [-1, 1]) {
    const l = glowBox(0.14, 0.14, 0.14, BEACON);
    l.position.set(1.62, 0.1, side * 0.8);
    body.add(l);
  }
  const turret = new THREE.Group();
  turret.position.set(0, 0.6, 0);
  turret.add(cylinder(0.9, 1.1, 0.7, 8, METAL, 0, 0.35, 0));
  turret.add(box(1.2, 0.6, 1.0, secondary, 0.1, 0.95, 0));
  const lance = barrelPivot('lancePlatform', turret);
  lance.add(box(3.0, 0.26, 0.26, DARK, 1.5, 0, 0));
  for (const x of [0.8, 1.6, 2.4]) lance.add(box(0.12, 0.42, 0.42, METAL, x, 0, 0)); // focusing rings
  const tip = glowBox(0.14, 0.2, 0.2, 0xfff2c8);
  tip.position.set(3.05, 0, 0);
  lance.add(tip);
  body.add(turret);
  const guns = ownMount(root, 'lancePlatform#guns', (t) => {
    t.add(box(0.4, 0.25, 0.6, METAL, 0, 0, 0));
    for (const side of [-1, 1]) t.add(box(0.45, 0.07, 0.07, DARK, 0.3, 0.1, side * 0.3));
  });
  body.add(guns.turret);
  guns.turret.position.y -= body.position.y;
  return setRig(root, { turret, ...spiderLegs(body, 2, 3.0, 1.1, 2.4, 0.32), ...mounted('lancePlatform', root, turret, [lance]), mounts: [guns] });
});

// Hive: bugs and crawlers grown from scrap.
const CHITIN = 0x3b2a1e;
const ACID = 0xbcc232;
/** The Hive Mother's size, as a share of how she was first drawn (see mounts.ts and her UnitDef radius, scaled to match). */
const HIVE_MOTHER_SIZE = 0.72;

// A mite: a knee-high biting bug on six legs. It lunges in head first to bite.
registerModel('mite', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.25;
  root.add(body);
  body.add(box(0.34, 0.16, 0.26, primary, -0.08, 0.02, 0)); // abdomen
  const head = new THREE.Group();
  head.position.set(0.16, 0, 0);
  head.add(box(0.14, 0.12, 0.16, CHITIN, 0.04, 0, 0));
  for (const side of [-1, 1]) head.add(box(0.12, 0.03, 0.03, METAL, 0.16, -0.03, side * 0.05)); // mandibles
  body.add(head);
  return setRig(root, {
    ...spiderLegs(body, 3, 0.36, 0.1, 0.25, 0.035),
    ...mounted('mite', root, null),
    strike(k) {
      head.position.x = 0.16 + Math.sin(Math.PI * k) * 0.12;
    },
  });
});

// A gun mite: a little spider mech with a needle gun on its back.
registerModel('gunMite', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.45;
  root.add(body);
  body.add(box(0.6, 0.22, 0.48, primary, 0, 0, 0));
  body.add(box(0.3, 0.08, 0.36, secondary, -0.12, 0.14, 0));
  const turret = new THREE.Group();
  turret.position.set(0.15, 0.12, 0);
  turret.add(box(0.24, 0.14, 0.24, CHITIN, 0, 0.06, 0));
  const gun = barrelPivot('gunMite', turret);
  gun.add(box(0.36, 0.05, 0.05, DARK, 0.15, 0, 0));
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 3, 0.6, 0.22, 0.45, 0.07), ...mounted('gunMite', root, turret, [gun]) });
});

// A fabricator: a squat tracked crawler with a hopper on its back and a cutting arm, chewing scrap into mites.
registerModel('fabricator', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.2, 0.42, 0.42, 0.62));
  root.add(box(2.0, 0.5, 1.3, primary, 0, 0.62, 0));
  // The hopper the scrap goes into, and the vats that grow the mites.
  root.add(box(0.9, 0.5, 1.0, CHITIN, -0.45, 1.1, 0));
  root.add(box(0.95, 0.06, 1.05, secondary, -0.45, 1.36, 0));
  for (const side of [-1, 1]) {
    const vat = glowBox(0.3, 0.32, 0.22, ACID);
    vat.position.set(-0.45, 0.98, side * 0.62);
    root.add(vat);
  }
  // Grinding mandibles at the front.
  for (const side of [-1, 1]) {
    const jaw = box(0.5, 0.12, 0.14, METAL, 1.15, 0.5, side * 0.32);
    jaw.rotation.y = side * 0.35;
    root.add(jaw);
  }
  const turret = new THREE.Group();
  turret.position.set(0.3, 1.0, 0);
  turret.add(box(0.5, 0.3, 0.5, METAL, 0, 0.1, 0));
  const arm = new THREE.Group();
  arm.position.set(0.2, 0.15, 0);
  arm.add(box(1.1, 0.12, 0.12, METAL, 0.55, 0, 0));
  arm.add(box(0.3, 0.05, 0.36, BLADE, 1.15, 0, 0)); // the cutter
  turret.add(arm);
  root.add(turret);
  return setRig(root, {
    turret,
    ...mounted('fabricator', root, turret),
    strike(k) {
      arm.rotation.z = -Math.sin(Math.PI * k) * 0.6;
    },
  });
});

// An acid spitter: a bloated bug on six legs, its acid sac glowing, spitting from its raised head.
registerModel('acidSpitter', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.8;
  root.add(body);
  body.add(box(0.8, 0.35, 0.7, primary, 0.05, 0, 0));
  const sac = glowBox(0.7, 0.55, 0.62, ACID);
  sac.position.set(-0.5, 0.2, 0);
  body.add(sac);
  body.add(box(0.4, 0.08, 0.74, secondary, 0.05, 0.2, 0));
  const turret = new THREE.Group();
  turret.position.set(0.45, 0.15, 0);
  turret.add(box(0.36, 0.28, 0.36, CHITIN, 0.05, 0.05, 0));
  const spout = barrelPivot('acidSpitter', turret);
  spout.add(box(0.32, 0.12, 0.12, CHITIN, 0.14, 0, 0));
  turret.add(spout);
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 3, 1.0, 0.32, 0.8, 0.09), ...mounted('acidSpitter', root, turret, [spout]) });
});

// A ravager: a great armoured beetle with crushing pincers.
registerModel('ravager', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.9;
  root.add(body);
  body.add(box(1.8, 0.6, 1.5, CHITIN, -0.1, 0, 0));
  body.add(box(1.6, 0.25, 1.6, primary, -0.15, 0.4, 0)); // the carapace
  body.add(box(0.12, 0.27, 1.62, secondary, -0.15, 0.4, 0)); // its seam
  const turret = new THREE.Group();
  turret.position.set(0.9, 0.05, 0);
  turret.add(box(0.5, 0.45, 0.8, primary, 0, 0, 0));
  const pincers = [-1, 1].map((side) => {
    const p = new THREE.Group();
    p.position.set(0.2, -0.05, side * 0.32);
    p.add(box(0.8, 0.14, 0.14, METAL, 0.4, 0, 0));
    p.add(box(0.3, 0.12, 0.12, METAL, 0.8, 0, -side * 0.1));
    turret.add(p);
    return { p, side };
  });
  body.add(turret);
  return setRig(root, {
    turret,
    ...spiderLegs(body, 3, 1.6, 0.6, 0.9, 0.14),
    ...mounted('ravager', root, turret),
    // The pincers open wide and snap shut.
    strike(k) {
      const open = Math.sin(Math.PI * k);
      for (const { p, side } of pincers) p.rotation.y = side * (0.5 * open - 0.1);
    },
  });
});

// Hive's super unit: a towering brood mother on eight legs, her egg-sacs glowing, spraying acid from her head.
registerModel('hiveMother', (faction) => {
  const { primary, secondary } = factionColors(faction);
  // Built at this share of the size she was first drawn at (she towered over everything).
  const k = HIVE_MOTHER_SIZE;
  const b = (w: number, h: number, d: number, c: number, x: number, y: number, z: number) => box(w * k, h * k, d * k, c, x * k, y * k, z * k);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.6 * k;
  root.add(body);
  body.add(b(2.2, 1.0, 2.0, primary, 0.4, 0, 0)); // thorax
  body.add(b(2.6, 1.6, 2.4, CHITIN, -1.6, 0.4, 0)); // abdomen
  body.add(b(2.0, 0.2, 2.5, secondary, -1.6, 1.25, 0));
  for (const [x, z] of [[-1.0, 0.7], [-2.1, -0.6], [-1.5, 0], [-2.3, 0.8], [-0.9, -0.8]]) {
    const egg = glowBox(0.45 * k, 0.4 * k, 0.45 * k, ACID);
    egg.position.set(x * k, 1.45 * k, z * k);
    body.add(egg);
  }
  const turret = new THREE.Group();
  turret.position.set(1.8 * k, 0.3 * k, 0);
  turret.add(b(0.9, 0.8, 1.1, CHITIN, 0.1, 0, 0));
  for (const side of [-1, 1]) turret.add(b(0.8, 0.16, 0.16, METAL, 0.7, -0.35, side * 0.35)); // mandibles
  const spout = barrelPivot('hiveMother', turret);
  spout.add(b(0.5, 0.26, 0.26, CHITIN, 0.25, 0, 0));
  const drip = glowBox(0.08 * k, 0.16 * k, 0.16 * k, ACID);
  drip.position.set(0.52 * k, 0, 0);
  spout.add(drip);
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 4, 4.4 * k, 1.3 * k, 2.6 * k, 0.32 * k), ...mounted('hiveMother', root, turret, [spout]) });
});

// Nomad: a base that walks.
// A crawler: a huge tracked rig with a factory hall on its back, a crane folded along it, and a gun turret on the cab.
registerModel('crawler', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(4.2, 0.8, 0.8, 1.5));
  root.add(box(4.0, 0.6, 2.8, METAL, 0, 1.0, 0)); // chassis
  root.add(box(2.6, 1.3, 2.6, primary, -0.6, 1.95, 0)); // the factory hall
  root.add(box(2.7, 0.14, 2.7, secondary, -0.6, 2.65, 0));
  root.add(box(0.06, 0.9, 1.4, DARK, -1.93, 1.75, 0)); // its doors at the back
  root.add(box(3.4, 0.14, 0.14, METAL, -0.4, 2.85, 0.9)); // the crane, folded along the roof
  root.add(box(0.1, 0.5, 0.1, METAL, 1.2, 2.6, 0.9));
  root.add(box(1.1, 0.8, 2.4, primary, 1.45, 1.7, 0)); // cab
  root.add(box(0.06, 0.3, 1.8, GLASS, 2.01, 1.85, 0));
  const turret = new THREE.Group();
  turret.position.set(1.45, 2.1, 0);
  turret.add(box(0.6, 0.3, 0.6, DARK, 0, 0.15, 0));
  const guns = barrelPivot('crawler', turret);
  for (const side of [-1, 1]) guns.add(box(0.6, 0.07, 0.07, DARK, 0.3, 0, side * 0.12));
  root.add(turret);
  return setRig(root, { turret, ...mounted('crawler', root, turret, [guns]) });
});

// An outrider: a motorbike with a gunner riding pillion behind the driver.
registerModel('outrider', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  for (const x of [-0.42, 0.42]) root.add(box(0.5, 0.5, 0.14, DARK, x, 0.25, 0)); // wheels
  root.add(box(0.95, 0.2, 0.22, primary, 0, 0.5, 0));
  root.add(box(0.28, 0.13, 0.26, secondary, 0.3, 0.665, 0)); // tank
  root.add(box(0.15, 0.4, 0.19, DARK, 0.06, 0.79, 0.01)); // driver
  root.add(box(0.11, 0.11, 0.13, 0xd9b38c, 0.06, 1.045, 0.01));
  const turret = new THREE.Group();
  turret.position.set(-0.25, 0.8, 0);
  turret.add(box(0.17, 0.33, 0.21, DARK, 0, -0.005, 0)); // the gunner
  const gun = barrelPivot('outrider', turret);
  gun.add(box(0.5, 0.06, 0.06, DARK, 0.2, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('outrider', root, turret, [gun]) });
});

// Nomad's super unit: the Ark, a land-ship on six tracks with a bridge tower, a twin cannon turret and deck guns.
registerModel('ark', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  for (const x of [-1.7, 1.7]) {
    const pair = tracks(2.6, 0.9, 0.9, 1.9);
    for (const t of pair) t.position.x += x;
    root.add(...pair);
  }
  root.add(box(6.0, 1.0, 4.0, primary, 0, 1.4, 0)); // the hull
  root.add(box(6.1, 0.16, 4.1, secondary, 0, 1.95, 0));
  root.add(box(1.0, 0.7, 4.2, METAL, 2.7, 1.2, 0)); // the prow
  root.add(box(1.6, 1.8, 2.0, primary, -1.8, 2.9, 0)); // bridge tower
  root.add(box(0.06, 0.3, 1.6, GLASS, -0.99, 3.45, 0));
  root.add(box(0.12, 1.2, 0.12, METAL, -2.2, 4.4, 0)); // mast
  const turret = new THREE.Group();
  turret.position.set(0.9, 2.1, 0);
  turret.add(box(1.6, 0.7, 1.5, primary, 0, 0.35, 0));
  turret.add(box(0.8, 0.12, 1.2, secondary, -0.3, 0.76, 0));
  const barrels = barrelPivot('ark', turret);
  for (const side of [-1, 1]) barrels.add(box(1.8, 0.18, 0.18, DARK, 0.9, 0, side * 0.35));
  root.add(turret);
  const guns = ownMount(root, 'ark#guns', (t) => {
    t.add(box(0.3, 0.2, 0.3, DARK, 0, 0.1, 0));
    for (const side of [-1, 1]) t.add(box(0.45, 0.06, 0.06, DARK, 0.25, 0.14, side * 0.08));
  });
  return setRig(root, { turret, ...mounted('ark', root, turret, [barrels]), mounts: [guns] });
});

// Antiquity: an ancient army against tanks.
const WOOD = 0x8a6440;
const BRONZE = 0xc08a3a;
const SKIN = 0xd9b38c;

/** A little marching soldier: legs, a tunic in the side's colour, a head and helmet. Returns the body to hang kit on. */
function ancientSoldier(root: THREE.Group, tunic: number, helmet: number): { body: THREE.Group; legs: Leg[] } {
  const body = new THREE.Group();
  body.position.y = 0.42;
  root.add(body);
  body.add(box(0.2, 0.3, 0.26, tunic, 0, 0.15, 0));
  body.add(box(0.13, 0.13, 0.13, SKIN, 0, 0.385, 0));
  body.add(box(0.16, 0.07, 0.16, helmet, 0, 0.47, 0));
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.21, 0.21, 0.07, SKIN, WOOD);
    leg.hip.position.set(0, 0, side * 0.07);
    body.add(leg.hip);
    return leg;
  });
  return { body, legs };
}

// A legionary: a tall curved shield in front (red, with the side's trim), a crested helmet and a short sword.
registerModel('legionary', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const { body, legs } = ancientSoldier(root, primary, BRONZE);
  body.add(box(0.03, 0.08, 0.2, 0xb3262e, 0, 0.535, 0)); // crest
  body.add(box(0.05, 0.46, 0.36, 0xb3262e, 0.16, 0.12, 0)); // the scutum
  body.add(box(0.06, 0.08, 0.08, secondary, 0.18, 0.13, 0)); // its boss
  const sword = new THREE.Group();
  sword.position.set(0.05, 0.12, -0.17);
  sword.add(box(0.3, 0.03, 0.04, METAL, 0.15, 0, 0));
  body.add(sword);
  return setRig(root, {
    ...walker(legs, body, 0.3, 0.5),
    ...mounted('legionary', root, null),
    strike(k) {
      sword.position.x = 0.05 + Math.sin(Math.PI * k) * 0.2;
    },
  });
});

// A crossbowman with a repeating crossbow, its magazine on top.
registerModel('crossbowman', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  const { body, legs } = ancientSoldier(root, primary, 0x3a2f2a);
  body.add(box(0.32, 0.05, 0.05, WOOD, 0.18, 0.22, -0.08)); // stock
  body.add(box(0.04, 0.04, 0.3, WOOD, 0.3, 0.22, -0.08)); // bow
  body.add(box(0.12, 0.08, 0.04, WOOD, 0.22, 0.28, -0.08)); // magazine
  return setRig(root, { ...walker(legs, body, 0.3, 0.5), ...mounted('crossbowman', root, null) });
});

/** A plain wooden cart: bed and four wheels. */
function cart(root: THREE.Group, length: number, width: number) {
  for (const x of [-length * 0.32, length * 0.32]) for (const side of [-1, 1]) root.add(box(0.44, 0.44, 0.08, WOOD, x, 0.22, side * (width / 2 + 0.05)));
  root.add(box(length, 0.14, width, WOOD, 0, 0.42, 0));
}

// A ballista on a cart: a great crossbow on a swivel.
registerModel('ballista', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  cart(root, 1.4, 0.8);
  root.add(box(0.5, 0.1, 0.84, primary, -0.45, 0.54, 0));
  const turret = new THREE.Group();
  turret.position.set(0.1, 0.55, 0);
  turret.add(box(0.14, 0.24, 0.14, WOOD, 0, 0.12, 0));
  const bow = barrelPivot('ballista', turret);
  bow.add(box(0.9, 0.08, 0.08, WOOD, 0.2, 0, 0));
  bow.add(box(0.06, 0.06, 0.9, WOOD, 0.5, 0, 0)); // the arms
  root.add(turret);
  return setRig(root, { turret, ...mounted('ballista', root, turret, [bow]) });
});

// A trebuchet: a tall wooden frame on a cart, a long throwing arm and a counterweight.
registerModel('trebuchet', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  cart(root, 2.0, 1.2);
  const turret = new THREE.Group();
  turret.position.set(0, 0.5, 0);
  for (const side of [-1, 1]) turret.add(box(0.12, 2.0, 0.12, WOOD, 0, 1.0, side * 0.45));
  turret.add(box(0.14, 0.14, 1.04, WOOD, 0, 2.0, 0)); // the axle
  const arm = barrelPivot('trebuchet', turret);
  arm.add(box(2.4, 0.1, 0.1, WOOD, 0.5, 0, 0));
  arm.add(box(0.4, 0.5, 0.4, primary, -0.7, -0.25, 0)); // counterweight
  root.add(turret);
  return setRig(root, { turret, ...mounted('trebuchet', root, turret, [arm]) });
});

// A chariot: two horses drawing a little two-wheeled car with an archer in it.
registerModel('chariot', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  for (const side of [-1, 1]) root.add(box(0.5, 0.5, 0.06, WOOD, -0.25, 0.25, side * 0.36)); // wheels
  root.add(box(0.5, 0.36, 0.6, primary, -0.25, 0.56, 0)); // the car
  root.add(box(0.8, 0.05, 0.05, WOOD, 0.4, 0.5, 0)); // pole
  for (const side of [-1, 1]) {
    root.add(box(0.6, 0.3, 0.18, 0x6a4a30, 0.75, 0.75, side * 0.16)); // horse
    root.add(box(0.2, 0.22, 0.12, 0x6a4a30, 1.1, 0.95, side * 0.16));
    for (const x of [0.55, 0.95]) root.add(box(0.06, 0.6, 0.06, 0x4a3420, x, 0.3, side * 0.16));
  }
  const turret = new THREE.Group();
  turret.position.set(-0.3, 0.8, 0);
  turret.add(box(0.16, 0.36, 0.2, SKIN, 0, 0.12, 0)); // archer
  const bow = barrelPivot('chariot', turret);
  bow.add(box(0.05, 0.05, 0.34, WOOD, 0.14, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('chariot', root, turret, [bow]) });
});

// A hwacha: a cart carrying a tilted rack full of fire arrows.
registerModel('hwacha', (faction) => {
  const { primary } = factionColors(faction);
  const root = new THREE.Group();
  for (const side of [-1, 1]) root.add(box(0.5, 0.5, 0.06, WOOD, -0.2, 0.25, side * 0.4)); // wheels
  root.add(box(1.2, 0.1, 0.7, WOOD, 0, 0.5, 0));
  const turret = new THREE.Group();
  turret.position.set(0.1, 0.55, 0);
  turret.add(box(0.2, 0.2, 0.2, WOOD, 0, 0.1, 0));
  const rack = barrelPivot('hwacha', turret);
  rack.add(box(0.5, 0.5, 0.6, primary, 0.1, 0, 0));
  rack.add(box(0.06, 0.4, 0.5, 0x3a2f2a, 0.38, 0, 0)); // the arrow heads
  root.add(turret);
  return setRig(root, { turret, ...mounted('hwacha', root, turret, [rack]) });
});

// A war elephant: grey, tusked, with a howdah of archers on its back.
registerModel('warElephant', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.5;
  root.add(body);
  const GREY = 0x8a8a88;
  body.add(box(1.8, 1.1, 1.1, GREY, 0, 0, 0));
  const head = new THREE.Group();
  head.position.set(1.0, 0.15, 0);
  head.add(box(0.6, 0.7, 0.8, GREY, 0.2, 0, 0));
  head.add(box(0.18, 0.8, 0.18, GREY, 0.55, -0.6, 0)); // trunk
  for (const side of [-1, 1]) {
    head.add(box(0.06, 0.55, 0.5, GREY, 0.05, 0.02, side * 0.6)); // ears
    head.add(box(0.5, 0.07, 0.07, 0xf0e8d8, 0.6, -0.3, side * 0.22)); // tusks
  }
  body.add(head);
  body.add(box(1.0, 0.1, 1.2, primary, -0.1, 0.6, 0)); // the blanket
  body.add(box(0.8, 0.4, 0.8, WOOD, -0.1, 0.85, 0)); // howdah
  body.add(box(0.06, 0.6, 0.06, WOOD, -0.45, 1.35, 0.35));
  body.add(box(0.03, 0.25, 0.35, secondary, -0.45, 1.5, 0.55));
  const legs = [-0.6, 0.6].flatMap((x) => [-1, 1].map((side) => {
    const leg = makeLeg(0.55, 0.55, 0.34, GREY, GREY);
    leg.hip.position.set(x, -0.45, side * 0.36);
    body.add(leg.hip);
    return leg;
  }));
  const bows = ownMount(root, 'warElephant#bows', (t) => {
    t.add(box(0.16, 0.3, 0.2, SKIN, 0, 0.0, 0));
    t.add(box(0.05, 0.05, 0.34, WOOD, 0.14, 0.1, 0));
  });
  body.add(bows.turret);
  bows.turret.position.y -= body.position.y;
  return setRig(root, {
    ...walker(legs, body, 0.6, 0.35),
    ...mounted('warElephant', root, null),
    mounts: [bows],
    // It tosses its head and tusks up.
    strike(k) {
      head.rotation.z = Math.sin(Math.PI * k) * 0.5;
    },
  });
});

// Antiquity's super unit: a giant bronze automaton with a great sword, gears showing at its joints.
registerModel('bronzeColossus', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.6;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(0.9, 1.4, 1.5, BRONZE, 0, 0.6, 0));
  turret.add(box(0.95, 0.3, 1.55, primary, 0, 0.9, 0)); // a sash in the side's colour
  turret.add(box(0.6, 0.6, 0.6, BRONZE, 0, 1.6, 0)); // head
  turret.add(box(0.1, 0.4, 0.7, secondary, 0, 2.05, 0)); // crest
  const eyes = glowBox(0.04, 0.08, 0.36, 0xffc060);
  eyes.position.set(0.31, 1.65, 0);
  turret.add(eyes);
  const arm = new THREE.Group();
  arm.position.set(0, 1.0, 0.95);
  arm.add(box(0.36, 1.0, 0.36, BRONZE, 0, -0.4, 0));
  arm.add(box(2.4, 0.12, 0.3, METAL, 1.2, -0.9, 0)); // the great sword
  turret.add(arm);
  turret.add(box(0.36, 1.0, 0.36, BRONZE, 0, 0.6, -0.95)); // the other arm
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.3, 1.3, 0.42, BRONZE, 0x6a4a20);
    leg.hip.position.set(0, 0, side * 0.45);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, {
    turret,
    ...walker(legs, body, 1.2, 0.45),
    ...mounted('bronzeColossus', root, turret),
    strike(k) {
      arm.rotation.y = Math.sin(Math.PI * k) * 1.4 - 0.2;
    },
  });
});

// A war kite: a red box kite in the side's trim, with an archer hanging in a sling under it.
registerModel('warKite', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(box(0.9, 0.5, 0.06, primary, 0, 0.7, 0.45)); // the box kite's sails
  root.add(box(0.9, 0.5, 0.06, primary, 0, 0.7, -0.45));
  root.add(box(0.06, 0.06, 1.0, WOOD, 0.4, 0.7, 0)); // spars
  root.add(box(0.06, 0.06, 1.0, WOOD, -0.4, 0.7, 0));
  root.add(box(1.2, 0.04, 0.04, secondary, -0.9, 0.7, 0)); // tail
  root.add(box(0.02, 0.5, 0.02, 0x3a2f2a, 0, 0.25, 0)); // the sling line
  const turret = new THREE.Group();
  turret.position.set(0, 0, 0);
  turret.add(box(0.14, 0.24, 0.16, SKIN, 0, -0.05, 0)); // the archer
  const bow = barrelPivot('warKite', turret);
  bow.add(box(0.05, 0.05, 0.3, WOOD, 0.12, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('warKite', root, turret, [bow]) });
});

// Tin Soldiers: clockwork toys, each with a wind-up key in its back that turns as it goes, and whirs round fast while it stands winding up.
const TIN = 0xb8bcc2;
const GOLD = 0xd8b04a;

/** A wind-up key on a toy's back, turning: slowly as it marches, quickly while it stands (mostly winding up). */
function windKey(parent: THREE.Object3D, x: number, y: number, size: number) {
  const key = new THREE.Group();
  key.position.set(x, y, 0);
  const back = Math.sign(x);
  key.add(box(size * 0.62, size * 0.2, size * 0.2, GOLD, size * 0.3 * back, 0, 0));
  key.add(box(size * 0.15, size * 0.9, size * 0.15, GOLD, size * 0.6 * back, 0, 0));
  key.add(box(size * 0.12, size * 0.14, size * 0.9, GOLD, size * 0.6 * back, 0, 0));
  parent.add(key);
  return (s: AnimState) => {
    key.rotation.x += s.dt * (s.speed > 0.05 ? 2 : 9);
  };
}

// A tin soldier: a toy guardsman in the side's colour with a tall shako, a white cross-belt and a rifle.
registerModel('tinSoldier', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.42;
  root.add(body);
  body.add(box(0.2, 0.32, 0.26, primary, 0, 0.16, 0));
  body.add(box(0.21, 0.04, 0.27, 0xf0f0f0, 0, 0.1, 0)); // belt
  body.add(box(0.13, 0.13, 0.13, 0xf0d0b0, 0, 0.385, 0));
  body.add(box(0.15, 0.2, 0.15, 0x1a1a1a, 0, 0.55, 0)); // shako
  body.add(box(0.03, 0.05, 0.08, secondary, 0.075, 0.6, 0)); // its badge
  body.add(box(0.06, 0.4, 0.06, 0x3a2f2a, 0.12, 0.25, -0.16)); // rifle, shouldered
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.21, 0.21, 0.08, 0x1a1a1a, 0x1a1a1a);
    leg.hip.position.set(0, 0, side * 0.07);
    body.add(leg.hip);
    return leg;
  });
  const turn = windKey(body, -0.1, 0.18, 0.18);
  const walk = walker(legs, body, 0.3, 0.5);
  return setRig(root, {
    ...walk,
    animate: (s) => {
      walk.animate(s);
      turn(s);
    },
    ...mounted('tinSoldier', root, null),
  });
});

// A clockwork tank: a tin box on tracks with rivets, a round turret, and a big key in the back.
registerModel('clockworkTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(1.9, 0.36, 0.42, 0.62));
  root.add(box(1.8, 0.45, 1.1, primary, 0, 0.65, 0));
  root.add(box(1.82, 0.08, 1.12, secondary, 0, 0.6, 0)); // tin seam
  const turret = new THREE.Group();
  turret.position.set(0.1, 0.88, 0);
  turret.add(cylinder(0.4, 0.45, 0.35, 10, TIN, 0, 0.17, 0));
  const barrel = barrelPivot('clockworkTank', turret);
  barrel.add(box(0.9, 0.12, 0.12, TIN, 0.45, 0, 0));
  root.add(turret);
  const turn = windKey(root, -0.9, 0.75, 0.4);
  return setRig(root, { turret, ...mounted('clockworkTank', root, turret, [barrel]), animate: turn });
});

// A toy cannon: a fat painted barrel on two spoked wheels.
registerModel('toyCannon', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  for (const side of [-1, 1]) {
    const wheel = cylinder(0.4, 0.4, 0.08, 8, GOLD, 0, 0.4, side * 0.42);
    wheel.rotation.x = Math.PI / 2;
    root.add(wheel);
  }
  root.add(box(1.2, 0.12, 0.3, primary, -0.3, 0.3, 0)); // trail
  const turret = new THREE.Group();
  turret.position.set(0, 0.55, 0);
  turret.add(box(0.3, 0.2, 0.5, secondary, 0, 0, 0));
  const barrel = barrelPivot('toyCannon', turret);
  barrel.add(box(0.8, 0.28, 0.28, 0x2a2a2a, 0.3, 0, 0));
  barrel.add(box(0.12, 0.34, 0.34, GOLD, 0.66, 0, 0));
  root.add(turret);
  const turn = windKey(root, -0.85, 0.4, 0.3);
  return setRig(root, { turret, ...mounted('toyCannon', root, turret, [barrel]), animate: turn });
});

// A tin robot: a box body with dials, a square head with glowing eyes, hammer fists, and a key in its back.
registerModel('tinRobot', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.0;
  root.add(body);
  body.add(box(0.7, 0.8, 0.9, primary, 0, 0.4, 0));
  body.add(box(0.06, 0.2, 0.2, secondary, 0.36, 0.5, 0.2)); // dials
  body.add(box(0.06, 0.2, 0.2, GOLD, 0.36, 0.5, -0.2));
  for (const side of [-1, 1]) body.add(box(0.3, 0.6, 0.22, TIN, 0.1, 0.35, side * 0.56)); // arms
  const turret = new THREE.Group();
  turret.position.set(0, 0.85, 0);
  turret.add(box(0.5, 0.42, 0.5, TIN, 0, 0.21, 0));
  turret.add(box(0.04, 0.3, 0.04, TIN, 0, 0.57, 0)); // antenna
  const eyes = barrelPivot('tinRobot', turret);
  for (const side of [-1, 1]) {
    const eye = glowBox(0.06, 0.1, 0.1, 0xff5a3a);
    eye.position.set(0.03, 0, side * 0.12);
    eyes.add(eye);
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.5, 0.5, 0.22, TIN, 0x2a2a2a);
    leg.hip.position.set(0, 0, side * 0.24);
    body.add(leg.hip);
    return leg;
  });
  const turn = windKey(body, -0.36, 0.45, 0.4);
  const walk = walker(legs, body, 0.5, 0.4);
  return setRig(root, {
    turret,
    ...walk,
    animate: (s) => {
      walk.animate(s);
      turn(s);
    },
    ...mounted('tinRobot', root, turret, [eyes]),
  });
});

// Tin Soldiers' super unit: a towering clockwork giant, a chest cannon in its belly and a huge key turning in its back.
registerModel('clockworkGiant', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.6;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.4, 1.8, 2.0, primary, 0, 0.9, 0));
  turret.add(box(1.42, 0.2, 2.02, GOLD, 0, 0.3, 0));
  turret.add(box(0.9, 0.8, 0.9, TIN, 0, 2.2, 0)); // head
  for (const side of [-1, 1]) {
    const eye = glowBox(0.05, 0.14, 0.18, 0xffc060);
    eye.position.set(0.46, 2.3, side * 0.2);
    turret.add(eye);
    turret.add(box(0.5, 1.4, 0.45, TIN, 0.1, 0.9, side * 1.25)); // arms
  }
  turret.add(box(0.1, 0.3, 0.8, secondary, 0.5, 1.6, 0));
  const barrel = barrelPivot('clockworkGiant', turret);
  barrel.add(box(0.8, 0.4, 0.4, 0x2a2a2a, 0.3, 0, 0));
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.3, 1.3, 0.5, TIN, 0x2a2a2a);
    leg.hip.position.set(0, 0, side * 0.55);
    body.add(leg.hip);
    return leg;
  });
  const turn = windKey(turret, -0.7, 1.1, 1.2);
  const walk = walker(legs, body, 1.2, 0.4);
  return setRig(root, {
    turret,
    ...walk,
    animate: (s) => {
      walk.animate(s);
      turn(s);
    },
    ...mounted('clockworkGiant', root, turret, [barrel]),
  });
});

// Mirage: holograms (drawn see-through; see entityView) and the real things they copy.
const PRISM = 0xbfe8ff;

// A prism tank: a low sleek hull, and a crystal prism on the turret that focuses the beam.
registerModel('prismTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.0, 0.38, 0.4, 0.66));
  root.add(box(1.9, 0.4, 1.2, primary, 0, 0.62, 0));
  root.add(box(0.5, 0.3, 1.24, secondary, 0.75, 0.55, 0)); // the glacis
  const turret = new THREE.Group();
  turret.position.set(-0.1, 0.82, 0);
  turret.add(box(0.8, 0.26, 0.8, primary, 0, 0.13, 0));
  const lens = barrelPivot('prismTank', turret);
  const crystal = glowBox(0.5, 0.36, 0.36, PRISM);
  crystal.rotation.x = Math.PI / 4;
  crystal.position.x = 0.04;
  lens.add(crystal);
  lens.add(box(0.5, 0.1, 0.1, METAL, 0.45, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('prismTank', root, turret, [lens]) });
});

// A projector truck: a truck with a tall mast and a projector dish, and a machine gun on the cab.
registerModel('projectorTruck', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.6, 0.6], 0.46, 0.44));
  root.add(box(2.0, 0.3, 0.95, METAL, 0, 0.55, 0));
  root.add(box(0.65, 0.6, 0.9, primary, 0.65, 0.98, 0)); // cab
  root.add(box(0.06, 0.24, 0.7, GLASS, 0.99, 1.08, 0));
  root.add(box(1.1, 0.3, 0.95, secondary, -0.45, 0.85, 0)); // bed
  root.add(box(0.12, 1.4, 0.12, METAL, -0.5, 1.7, 0)); // mast
  const dish = box(0.08, 0.7, 0.7, PRISM, -0.4, 2.45, 0);
  root.add(dish);
  const emitter = glowBox(0.12, 0.18, 0.18, PRISM);
  emitter.position.set(-0.3, 2.45, 0);
  root.add(emitter);
  const turret = new THREE.Group();
  turret.position.set(0.6, 1.3, 0);
  turret.add(box(0.22, 0.14, 0.22, DARK, 0, 0.05, 0));
  const gun = barrelPivot('projectorTruck', turret);
  gun.add(box(0.5, 0.06, 0.06, DARK, 0.22, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('projectorTruck', root, turret, [gun]) });
});

// Mirage's super unit: a tall walker crowned with a ring of mirrors round a crystal, with a mirror lance.
registerModel('fataMorgana', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.4;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.4, 1.0, 1.6, primary, 0, 0.5, 0));
  turret.add(box(1.0, 0.16, 1.2, secondary, 0, 1.08, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const mirror = box(0.06, 0.8, 0.5, PRISM, Math.cos(a) * 0.75, 1.6, Math.sin(a) * 0.75);
    mirror.rotation.y = -a;
    turret.add(mirror);
  }
  const core = glowBox(0.4, 0.6, 0.4, PRISM);
  core.position.set(0, 1.55, 0);
  turret.add(core);
  const lance = barrelPivot('fataMorgana', turret);
  lance.add(box(1.8, 0.18, 0.18, METAL, 0.9, 0, 0));
  const tip = glowBox(0.2, 0.24, 0.24, PRISM);
  tip.position.set(1.85, 0, 0);
  lance.add(tip);
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.25, 1.25, 0.36, METAL, DARK);
    leg.hip.position.set(0, 0, side * 0.5);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 1.1, 0.4), ...mounted('fataMorgana', root, turret, [lance]) });
});

// Verdant: biotech walkers, grown hulls on machine legs. Hulls in the side's own colours, so two Verdant sides
// tell apart; only the small glowing bio-sacs and vine tips are Verdant's own.
const SAC = 0x5fae86;
const VINE = 0x3e6a2c;

// A strangler: a grown bulb hull on two machine legs, with a coil of vine on top that it lashes out.
registerModel('strangler', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.9;
  root.add(body);
  body.add(box(0.8, 0.6, 0.8, primary, 0, 0.2, 0));
  body.add(box(0.6, 0.12, 0.84, secondary, 0, 0.52, 0));
  for (const side of [-1, 1]) {
    const sac = glowBox(0.16, 0.2, 0.08, SAC);
    sac.position.set(-0.1, 0.18, side * 0.42);
    body.add(sac);
  }
  const turret = new THREE.Group();
  turret.position.set(0, 0.4, 0);
  turret.add(box(0.4, 0.3, 0.4, METAL, 0, 0.15, 0));
  const vine = barrelPivot('strangler', turret);
  vine.add(box(0.7, 0.1, 0.1, VINE, 0.3, 0, 0));
  vine.add(box(0.14, 0.2, 0.2, secondary, 0.7, 0, 0)); // the lash's barbed tip
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.5, 0.5, 0.14, METAL, DARK);
    leg.hip.position.set(0, -0.05, side * 0.22);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 0.6, 0.45), ...mounted('strangler', root, turret, [vine]) });
});

// A seed mortar: a grown seed bulb on a wheeled cart, its mouth tilted up.
registerModel('seedMortar', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...wheels([-0.5, 0.5], 0.45, 0.4));
  root.add(box(1.6, 0.25, 0.9, METAL, 0, 0.5, 0));
  root.add(box(0.5, 0.2, 0.92, secondary, -0.5, 0.7, 0));
  const turret = new THREE.Group();
  turret.position.set(0.15, 0.62, 0);
  turret.add(box(0.7, 0.5, 0.7, primary, 0, 0.25, 0));
  const mouth = barrelPivot('seedMortar', turret);
  mouth.add(box(0.5, 0.36, 0.36, VINE, 0.2, 0, 0));
  const sac = glowBox(0.12, 0.2, 0.2, SAC);
  sac.position.set(0.46, 0, 0);
  mouth.add(sac);
  root.add(turret);
  return setRig(root, { turret, ...mounted('seedMortar', root, turret, [mouth]) });
});

// A graft walker: a heavy biotech walker, a grown armoured torso on machine legs, ribbed down its back, with
// glowing bio-sacs on its flanks, two claw arms, and a spine launcher on its back.
registerModel('graftWalker', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.2;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(0.9, 0.9, 1.0, primary, 0, 0.5, 0)); // torso
  turret.add(box(1.04, 0.18, 1.1, secondary, -0.04, 1.0, 0)); // carapace
  for (const x of [-0.3, 0, 0.3]) turret.add(box(0.12, 0.14, 0.5, DARK, x - 0.05, 1.15, 0)); // ribs down its back
  turret.add(box(0.3, 0.3, 0.6, primary, 0.5, 0.75, 0)); // head
  turret.add(box(0.06, 0.08, 0.4, DARK, 0.66, 0.8, 0)); // visor slit
  for (const side of [-1, 1]) {
    const sac = glowBox(0.3, 0.3, 0.1, SAC);
    sac.position.set(-0.15, 0.45, side * 0.52);
    turret.add(sac);
  }
  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(0.1, 0.85, side * 0.66);
    arm.add(box(0.2, 0.7, 0.2, METAL, 0, -0.3, 0));
    arm.add(box(0.36, 0.3, 0.3, primary, 0.1, -0.75, 0)); // fist
    for (const z of [-0.09, 0.09]) arm.add(box(0.26, 0.06, 0.06, DARK, 0.32, -0.82, z)); // claws
    turret.add(arm);
    return arm;
  });
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.6, 0.6, 0.26, METAL, DARK);
    leg.hip.position.set(0, 0, side * 0.28);
    body.add(leg.hip);
    return leg;
  });
  const spines = ownMount(root, 'graftWalker#spines', (t) => {
    t.add(box(0.26, 0.18, 0.26, DARK, 0, 0, 0));
    t.add(box(0.38, 0.07, 0.07, VINE, 0.18, 0.03, 0));
  });
  body.add(spines.turret);
  spines.turret.position.y -= body.position.y;
  return setRig(root, {
    turret,
    ...walker(legs, body, 0.6, 0.4),
    ...mounted('graftWalker', root, turret),
    mounts: [spines],
    strike(k) {
      for (const arm of arms) arm.rotation.z = -Math.sin(Math.PI * k) * 1.2;
    },
  });
});

// Verdant's super unit: the Worldtree, a towering biotech walker, a grown hull carrying a canopy of
// leaf-panels, vines hanging from it, and seed pods.
registerModel('worldTree', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.6;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.6, 2.6, 1.6, primary, 0, 1.3, 0)); // the trunk-hull
  turret.add(box(1.62, 0.3, 1.62, secondary, 0, 0.6, 0));
  for (const y of [1.4, 2.1]) turret.add(box(1.64, 0.12, 1.64, DARK, 0, y, 0)); // ribs
  // The canopy: tilted leaf-panels round a mast, in the side's colours, not a tree's crown.
  turret.add(box(0.3, 1.2, 0.3, METAL, 0, 3.1, 0));
  for (const [x, z, c] of [[1.0, 0, secondary], [-1.0, 0, secondary], [0, 1.0, primary], [0, -1.0, primary]] as const) {
    const panel = box(1.5, 0.12, 1.1, c, x, 3.4, z);
    panel.rotation.set(z * 0.25, 0, -x * 0.25);
    turret.add(panel);
  }
  for (const [x, z] of [[1.0, 1.0], [-1.1, 0.6], [0.4, -1.2]]) {
    const pod = glowBox(0.3, 0.4, 0.3, SAC);
    pod.position.set(x, 2.3, z);
    turret.add(pod);
  }
  turret.add(box(0.2, 0.3, 0.6, secondary, 0.81, 1.8, 0));
  const vines = barrelPivot('worldTree', turret);
  vines.add(box(1.4, 0.2, 0.2, VINE, 0.6, 0, 0));
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.3, 1.3, 0.55, METAL, DARK);
    leg.hip.position.set(0, 0, side * 0.55);
    body.add(leg.hip);
    return leg;
  });
  const seeds = ownMount(root, 'worldTree#seeds', (t) => {
    t.add(box(0.5, 0.4, 0.5, METAL, 0, 0.0, 0));
    t.add(box(0.4, 0.28, 0.3, SAC, 0.35, 0.04, 0));
  });
  turret.add(seeds.turret);
  seeds.turret.position.y -= body.position.y;
  return setRig(root, { turret, ...walker(legs, body, 1.1, 0.35), ...mounted('worldTree', root, turret, [vines]), mounts: [seeds] });
});

// Lodestar: magnets and scrap.
const MAGNET = 0xb83a32;

// A magnet crane: a tracked crane with a long jib and a big round magnet hanging off it, and a machine gun on the cab.
registerModel('magnetCrane', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.1, 0.4, 0.42, 0.7));
  root.add(box(2.0, 0.45, 1.3, primary, 0, 0.66, 0));
  // The cab sits off to one side, clear of the jib, as on a real crane truck.
  root.add(box(0.6, 0.6, 0.7, secondary, 0.6, 1.18, 0.45)); // cab
  const turret = new THREE.Group();
  turret.position.set(-0.3, 0.9, 0);
  turret.add(box(0.7, 0.3, 0.7, METAL, 0, 0.15, 0));
  const jib = barrelPivot('magnetCrane', turret);
  jib.add(box(2.2, 0.16, 0.16, primary, 1.0, 0, 0));
  jib.add(box(0.06, 0.6, 0.06, DARK, 2.0, -0.3, 0)); // cable
  jib.add(cylinder(0.32, 0.32, 0.16, 10, MAGNET, 2.0, -0.66, 0)); // the magnet
  root.add(turret);
  const mg = ownMount(root, 'magnetCrane#mg', (t) => {
    t.add(box(0.2, 0.12, 0.2, DARK, 0, 0.04, 0));
    t.add(box(0.4, 0.06, 0.06, DARK, 0.22, 0.08, 0));
  });
  return setRig(root, { turret, ...mounted('magnetCrane', root, turret, [jib]), mounts: [mg] });
});

// A coil tank: a slab-sided hull and a long barrel ringed with magnetic coils.
registerModel('coilTank', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  root.add(...tracks(2.1, 0.4, 0.42, 0.7));
  root.add(box(2.0, 0.45, 1.3, primary, 0, 0.66, 0));
  root.add(box(0.5, 0.2, 1.32, secondary, -0.6, 0.8, 0));
  const turret = new THREE.Group();
  turret.position.set(0, 0.88, 0);
  turret.add(box(0.9, 0.36, 0.86, primary, 0, 0.18, 0));
  const barrel = barrelPivot('coilTank', turret);
  barrel.add(box(1.5, 0.12, 0.12, DARK, 0.75, 0, 0));
  for (const x of [0.4, 0.75, 1.1]) barrel.add(box(0.1, 0.24, 0.24, 0xb07a3a, x, 0, 0));
  root.add(turret);
  return setRig(root, { turret, ...mounted('coilTank', root, turret, [barrel]) });
});

// Lodestar's super unit: the Lodestone, a giant walker with a great horseshoe magnet for an arm, and coilguns on its shoulders.
registerModel('lodestone', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.6;
  root.add(body);
  const turret = new THREE.Group();
  turret.add(box(1.5, 1.6, 2.0, primary, 0, 0.8, 0));
  turret.add(box(1.52, 0.2, 2.02, secondary, 0, 1.4, 0));
  turret.add(box(0.7, 0.5, 0.7, METAL, 0.2, 1.85, 0));
  const magnet = barrelPivot('lodestone', turret);
  magnet.add(box(1.2, 0.3, 0.3, METAL, 0.6, 0, 0));
  magnet.add(box(0.3, 0.32, 1.3, MAGNET, 1.35, 0, 0));
  for (const side of [-1, 1]) magnet.add(box(0.7, 0.28, 0.3, MAGNET, 1.85, 0, side * 0.45));
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(1.3, 1.3, 0.5, METAL, DARK);
    leg.hip.position.set(0, 0, side * 0.55);
    body.add(leg.hip);
    return leg;
  });
  const coils = ownMount(root, 'lodestone#coils', (t) => {
    t.add(box(0.4, 0.3, 0.4, DARK, 0, 0, 0));
    for (const side of [-1, 1]) t.add(box(0.9, 0.1, 0.1, 0xb07a3a, 0.5, 0, side * 0.12));
  });
  turret.add(coils.turret);
  coils.turret.position.y -= body.position.y;
  return setRig(root, { turret, ...walker(legs, body, 1.1, 0.4), ...mounted('lodestone', root, turret, [magnet]), mounts: [coils] });
});

// Leviathan: one giant creature and its cult.
const HIDE = 0x2e4a4a;

// The Leviathan: a hulking four-legged sea beast with a ridged back, a long tail, a frilled head and glowing eyes.
registerModel('leviathan', (faction) => {
  const { primary, secondary } = factionColors(faction);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 2.2;
  root.add(body);
  body.add(box(3.6, 1.8, 2.2, HIDE, 0, 0, 0));
  body.add(box(3.0, 0.3, 1.6, primary, -0.2, 0.95, 0)); // markings down its back
  for (const x of [-1.3, -0.5, 0.3, 1.0]) body.add(box(0.4, 0.6, 0.12, secondary, x, 1.35, 0)); // ridge plates
  // The tail: it whips round when it strikes.
  const tail = new THREE.Group();
  tail.position.set(-1.8, 0, 0);
  tail.add(box(2.2, 0.9, 1.0, HIDE, -1.0, -0.2, 0));
  tail.add(box(1.4, 0.5, 0.5, HIDE, -2.6, -0.5, 0));
  body.add(tail);
  // The head turns a little on its neck to breathe fire (its own mount, see mounts.ts).
  const head = ownMount(root, 'leviathan#head', (t) => {
    t.add(box(1.6, 1.1, 1.4, HIDE, 0.6, 0, 0));
    t.add(box(0.1, 1.0, 2.2, primary, 0.0, 0.4, 0)); // frill
    for (const side of [-1, 1]) {
      const eye = glowBox(0.08, 0.16, 0.2, 0xd8f070);
      eye.position.set(1.42, 0.25, side * 0.45);
      t.add(eye);
    }
    const jaw = new THREE.Group();
    jaw.position.set(0.2, -0.55, 0);
    jaw.add(box(1.4, 0.3, 1.2, 0x223838, 0.7, 0, 0));
    t.add(jaw);
  });
  body.add(head.turret);
  head.turret.position.y -= body.position.y;
  const legs = [-1.1, 1.1].flatMap((x) => [-1, 1].map((side) => {
    const leg = makeLeg(0.8, 0.8, 0.5, HIDE, 0x1a2a2a);
    leg.hip.position.set(x, -0.6, side * 0.8);
    body.add(leg.hip);
    return leg;
  }));
  return setRig(root, {
    ...walker(legs, body, 0.9, 0.3),
    ...mounted('leviathan', root, null),
    // The spines and acid pods fire from its back, on no mount of their own.
    mounts: [head, {}, {}],
    // The tail lashes out to one side and back.
    strike(k) {
      tail.rotation.y = Math.sin(Math.PI * k) * 1.1;
    },
  });
});

// Leviathan's cult are sprites, like other infantry: a crowd of them is cheap to draw.
registerModel('cultist', (faction) => infantry(faction, 'cultist'));
registerModel('zealot', (faction) => infantry(faction, 'zealot'));
