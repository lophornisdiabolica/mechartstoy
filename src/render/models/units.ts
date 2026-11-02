import * as THREE from 'three';
import { AnimState, box, factionColors, flatMaterial, markShared, registerModel, setRig } from '../models';

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

function makeLeg(thigh: number, shin: number, thickness: number, color: number, footColor: number): Leg {
  const hip = new THREE.Group();
  hip.add(box(thickness, thigh, thickness, color, 0, -thigh / 2, 0));
  const knee = new THREE.Group();
  knee.position.y = -thigh;
  knee.add(box(thickness * 0.85, shin, thickness * 0.85, color, 0, -shin / 2, 0));
  knee.add(box(thickness * 2.2, thickness * 0.5, thickness * 1.6, footColor, thickness * 0.3, -shin, 0));
  hip.add(knee);
  return { hip, knee };
}

/** Walk cycle: legs swing in opposite phase; amplitude eases in with speed. */
function walker(legs: Leg[], body: THREE.Object3D, stride: number, swing: number) {
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

  return setRig(root, { turret, animate: walker(legs, body, 0.9, 0.5) });
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

  return setRig(root, { turret, animate: walker(legs, body, 1.6, 0.35) });
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
/** What an infantry sprite carries: a rifle, an AT launcher on the shoulder, or a mortar tube. */
type Kit = 'rifle' | 'launcher' | 'mortar';

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
    px(2, 0, 4, 3, hex(secondary)); // helmet
    px(3, 2, 2, 1, '#e0b48a'); // face
    px(2, 3, 4, 4, hex(primary)); // torso
    if (kit === 'launcher') {
      px(0, 2, 8, 1, '#56603f'); // launcher tube over the shoulder
      px(0, 2, 1, 1, '#222');
    } else if (kit === 'mortar') {
      px(6, 0, 1, 6, '#4a4f3a'); // mortar tube carried upright
      px(5, 6, 3, 1, '#222'); // base plate
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

registerModel('trooper', (faction) => infantry(faction, 'rifle'));
registerModel('atTrooper', (faction) => infantry(faction, 'launcher'));
registerModel('mortar', (faction) => infantry(faction, 'mortar'));

// Shared dark material for burnt-out hulks.
export const CHARRED = flatMaterial(0x2a2623);
