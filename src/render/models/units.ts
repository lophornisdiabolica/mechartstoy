import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { AnimState, box, cylinder, glowBox, factionColors, flatMaterial, markShared, registerModel, setRig } from '../models';

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

  return setRig(root, { turret, ...walker(legs, body, 0.9, 0.5) });
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

  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.35) });
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
  turret.add(box(1.3, 0.14, 0.14, DARK, 1.05, 0.22, 0));
  root.add(turret);

  return setRig(root, { turret });
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
  const barrel = new THREE.Group();
  barrel.position.set(0.45, 0.4, 0);
  barrel.rotation.z = 0.5;
  barrel.add(box(2.0, 0.16, 0.16, DARK, 1.0, 0, 0));
  barrel.add(box(0.3, 0.24, 0.24, METAL, 1.9, 0, 0));
  turret.add(barrel);
  root.add(turret);

  return setRig(root, { turret });
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
  turret.add(box(1.9, 0.18, 0.18, DARK, 1.4, 0.28, 0));
  turret.add(box(0.25, 0.26, 0.26, METAL, 2.35, 0.28, 0)); // muzzle brake
  root.add(turret);
  return setRig(root, { turret });
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
  turret.add(box(0.8, 0.1, 0.1, DARK, 0.35, 0.42, 0));
  turret.add(box(0.08, 0.3, 0.5, primary, 0.12, 0.42, 0)); // gun shield
  root.add(turret);
  return setRig(root, { turret });
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
  turret.add(box(0.6, 0.08, 0.08, DARK, 0.25, 0.08, 0));
  root.add(turret);
  return setRig(root, { turret });
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
  const rack = new THREE.Group();
  rack.position.set(0, 0.45, 0);
  rack.rotation.z = 0.45;
  rack.add(box(1.2, 0.45, 0.8, secondary));
  rack.add(box(0.05, 0.35, 0.65, DARK, 0.6, 0, 0));
  turret.add(rack);
  root.add(turret);
  return setRig(root, { turret });
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
  return setRig(root, { turret });
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
  turret.add(box(1.0, 0.11, 0.11, DARK, 0.85, 0.18, 0));
  root.add(turret);
  return setRig(root, { turret });
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
  turret.add(box(0.7, 0.08, 0.08, DARK, 0.5, 0.15, 0));
  root.add(turret);
  return setRig(root, { turret });
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
  const tubes = new THREE.Group();
  tubes.position.set(0.2, 0.55, 0);
  tubes.rotation.z = 0.8;
  for (const z of [-0.3, 0.3]) tubes.add(box(1.2, 0.3, 0.3, DARK, 0.4, 0, z));
  turret.add(tubes);
  root.add(turret);
  return setRig(root, { turret });
});

// Infantry are camera-facing sprites: cheap to draw in crowds.
const TROOPER_W = 8;
const TROOPER_H = 12;

/** Pixel-art soldier, two walk frames side by side. Coloured per faction. */
/** What an infantry sprite carries: a rifle, an AT launcher on the shoulder, a mortar tube, a flamethrower and its fuel tank, or an engineer's wrench (with a hard hat). */
type Kit = 'rifle' | 'launcher' | 'mortar' | 'flamer' | 'wrench' | 'civilian0' | 'civilian1' | 'civilian2' | 'militia';

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
  for (const side of [-1, 1]) {
    const barrel = new THREE.Group();
    barrel.position.set(0.35, 0.3, side * 0.22);
    barrel.rotation.z = 0.45;
    barrel.add(box(1.1, 0.1, 0.1, DARK, 0.55, 0, 0));
    barrel.add(box(0.2, 0.15, 0.15, METAL, 1.05, 0, 0));
    turret.add(barrel);
  }
  root.add(turret);
  return setRig(root, { turret });
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
  turret.add(box(0.35, 0.08, 0.08, DARK, 0.18, 0, 0));
  root.add(turret);
  return setRig(root, { turret, bank: 0.25, flies: true, animate: rotors([{ group: blades, spin: 30 }]) });
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
  return setRig(root, { turret, bank: 0.25, flies: true, animate: rotors([{ group: blades, spin: 26 }]) });
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
  return setRig(root, { turret, bank: 0.8, flies: true });
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
  return setRig(root, { bank: 0.6, flies: true });
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
  turret.add(box(0.2, 0.05, 0.05, DARK, 0.1, 0, 0));
  root.add(turret);
  return setRig(root, { turret, flies: true, animate: rotors(parts) });
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
  for (const side of [-1, 1]) {
    for (const up of [0, 1]) {
      const barrel = new THREE.Group();
      barrel.position.set(0.4, 0.25 + up * 0.18, side * 0.25);
      barrel.rotation.z = 0.5;
      barrel.add(box(0.9, 0.08, 0.08, DARK, 0.45, 0, 0));
      turret.add(barrel);
    }
  }
  body.add(turret);
  const legs = [-1, 1].map((side) => {
    const leg = makeLeg(0.8, 0.85, 0.18, METAL, DARK);
    leg.hip.position.set(-0.05, -0.1, side * 0.35);
    body.add(leg.hip);
    return leg;
  });
  return setRig(root, { turret, ...walker(legs, body, 0.9, 0.45) });
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
  turret.add(box(0.6, 0.08, 0.08, DARK, 0.4, 0.05, 0.1));
  turret.add(box(0.6, 0.08, 0.08, DARK, 0.4, 0.05, -0.1));
  root.add(turret);
  return setRig(root, {
    turret,
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
  turret.add(box(0.5, 0.18, 0.36, METAL, 0.65, 0.3, 0)); // capacitor housing
  for (const side of [-1, 1]) turret.add(box(2.6, 0.1, 0.08, DARK, 1.6, 0.3, side * 0.12)); // twin rails
  turret.add(box(0.2, 0.08, 0.34, METAL, 2.75, 0.3, 0)); // muzzle brace
  root.add(turret);
  return setRig(root, { turret });
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
  return setRig(root, { turret, ...walker(legs, body, 1.6, 0.3) });
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
  for (const side of [-1, 1]) turret.add(box(0.6, 0.07, 0.07, DARK, 0.45, 0.12, side * 0.1));
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 3, 1.0, 0.35, 0.7, 0.11) });
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
  const barrel = new THREE.Group();
  barrel.position.set(0.6, 0.55, 0);
  barrel.rotation.z = 0.55;
  barrel.add(box(3.4, 0.3, 0.3, DARK, 1.7, 0, 0));
  barrel.add(box(0.5, 0.42, 0.42, METAL, 3.3, 0, 0));
  turret.add(barrel);
  body.add(turret);
  return setRig(root, { turret, ...spiderLegs(body, 4, 3.0, 0.9, 2.3, 0.3) });
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
  return setRig(root, { turret, ...walker(legs, body, 1.2, 0.45) });
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
  return setRig(root, { turret, ...walker(legs, body, 1.8, 0.3) });
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
  turret.add(box(0.9, 0.1, 0.1, DARK, 0.7, 0.15, 0));
  hull.add(turret);
  return setRig(root, { turret, animate: bob(hull, 0.04, 0) });
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
  const rack = new THREE.Group();
  rack.position.set(0, 0.45, 0);
  rack.rotation.z = 0.3;
  rack.add(box(0.7, 0.35, 0.55, METAL));
  rack.add(box(0.05, 0.28, 0.45, DARK, 0.35, 0, 0));
  turret.add(rack);
  hull.add(turret);
  return setRig(root, { turret, animate: bob(hull, 0.05, 0.05) });
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
  turret.add(box(0.6, 0.07, 0.07, DARK, 0.4, 0.12, 0));
  root.add(turret);
  return setRig(root, { turret });
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
  for (const side of [-1, 1]) {
    turret.add(box(0.9, 0.45, 0.45, METAL, 0.15, 0.55, side * 0.4));
    turret.add(box(0.05, 0.36, 0.36, DARK, 0.6, 0.55, side * 0.4));
  }
  hull.add(turret);
  return setRig(root, { turret, animate: bob(hull, 0.05, 0) });
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
    for (const side of [-1, 1]) t.add(box(1.0, 0.09, 0.09, DARK, 0.75, 0.22, side * 0.16));
    hull.add(t);
    return t;
  };
  const turret = gun(1.15);
  const aft = gun(-1.75);
  const rock = bob(hull, 0.04, 0.03);
  return setRig(root, {
    turret,
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
  turret.add(box(0.6, 0.09, 0.09, METAL, 0.35, 0.12, 0));
  turret.add(box(0.1, 0.14, 0.14, FLAME_TIP, 0.68, 0.12, 0));
  root.add(turret);
  return setRig(root, { turret });
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
  return setRig(root, { turret, ...walker(legs, body, 0.9, 0.45) });
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
  return setRig(root, { turret, ...walker(legs, body, 1.4, 0.3) });
});

registerModel('trooper', (faction) => infantry(faction, 'rifle'));
registerModel('atTrooper', (faction) => infantry(faction, 'launcher'));
registerModel('mortar', (faction) => infantry(faction, 'mortar'));
registerModel('flameTrooper', (faction) => infantry(faction, 'flamer'));
registerModel('engineer', (faction) => infantry(faction, 'wrench'));
// Townsfolk (see game/towns.ts): three sets of everyday clothes, and the militia.
registerModel('civilian:0', (faction) => infantry(faction, 'civilian0'));
registerModel('civilian:1', (faction) => infantry(faction, 'civilian1'));
registerModel('civilian:2', (faction) => infantry(faction, 'civilian2'));
registerModel('militia', (faction) => infantry(faction, 'militia'));

// Shared dark material for burnt-out hulks.
export const CHARRED = flatMaterial(0x2a2623);
