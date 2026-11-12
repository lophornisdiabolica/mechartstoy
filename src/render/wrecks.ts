import * as THREE from 'three';
import { Rng } from '../core/rng';
import { CHARRED } from './models/units';
import { flatMaterial, getRig } from './models';

/**
 * Wrecks: how a destroyed vehicle's model is knocked out of shape. Nothing
 * here touches the simulation; it only poses the parts of a model that the
 * entity view has stopped animating.
 *
 * Every wreck is broken from its entity id, so the same vehicle always falls
 * the same way, and each kind gets a few different ways to break:
 * - walkers buckle at the knees, keel over on a lost leg, or topple flat
 *   (each model's rig says how, see ModelRig.wreck);
 * - turrets jam with the gun drooping, slew off their ring, or are blown
 *   clean off and land beside the hull;
 * - a few small parts (barrels, pods, wheels, fins) are bent or gone;
 * - the paint is burnt to a few shades of char, a hint of the side's colour
 *   left on some parts, and its lights go out.
 *
 * A fallen walker then tips on over until it rests on the ground rather
 * than balancing on a foot, and every wreck lies along the slope under it.
 *
 * The parts then fall into that pose over a moment rather than snapping, so
 * a walker visibly crumples. Wrecks are drawn by the batcher like anything
 * else, so a broken model costs no more to draw than a whole one: every
 * part is still a box or cylinder, and the char shades are flat materials,
 * which the batcher draws as one with the colour per instance.
 */

/** A part's pose: where it starts falling from and where it comes to rest. */
interface PartMove {
  part: THREE.Object3D;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  q0: THREE.Quaternion;
  q1: THREE.Quaternion;
  /** How high it's thrown on the way (a turret blown off), model units; 0 to just fall. */
  arc: number;
}

/** A wreck falling into its broken pose. */
export interface Collapse {
  moves: PartMove[];
  /** The model's own tilt (the entity view keeps setting its heading, so only x and z are eased). */
  root: { x0: number; z0: number; x1: number; z1: number };
  elapsed: number;
  duration: number;
}

/** How much of a part's colour is burnt away: mostly all of it, sometimes leaving a trace. */
const CHAR_SHADES = [1, 1, 0.92, 0.86];
/** Parts this small next to the model's biggest one may be bent or knocked off. */
const SMALL_PART = 0.07;
/** How far into the ground a fallen wreck settles, model units. */
const SINK = 0.04;

const _box = new THREE.Box3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _char = (CHARRED as THREE.MeshStandardMaterial).color;
const _c = new THREE.Color();

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

/** Bounds of the visible meshes under `part`, in `frame`'s space (both must have up-to-date world matrices). */
function boundsIn(frame: THREE.Object3D, part: THREE.Object3D, out: THREE.Box3): THREE.Box3 {
  out.makeEmpty();
  _inv.copy(frame.matrixWorld).invert();
  part.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.noShadow) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    out.union(_box.copy(mesh.geometry.boundingBox!).applyMatrix4(_m));
  });
  return out;
}

/** Move `part` up or down so the lowest of what it carries rests on the model's ground. */
function ground(root: THREE.Object3D, part: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const b = boundsIn(root, part, new THREE.Box3());
  if (b.isEmpty()) return;
  // In root space; the part's parent is the root or sits square in it (turrets, bodies).
  part.position.y -= b.min.y + SINK;
}

/** The corners of every visible part under `part` in `root`'s space, and roughly where its weight is (bulky parts count most). */
function hull(root: THREE.Object3D, part: THREE.Object3D): { points: THREE.Vector3[]; weight: THREE.Vector3 } {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const points: THREE.Vector3[] = [];
  const weight = new THREE.Vector3();
  let mass = 0;
  part.traverseVisible((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.noShadow) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    _m.multiplyMatrices(_inv, mesh.matrixWorld);
    const b = mesh.geometry.boundingBox!;
    for (let i = 0; i < 8; i++) points.push(new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(_m));
    const size = b.getSize(new THREE.Vector3());
    const m = size.x * size.y * size.z;
    weight.addScaledVector(b.getCenter(new THREE.Vector3()).applyMatrix4(_m), m);
    mass += m;
  });
  if (mass > 0) weight.divideScalar(mass);
  return { points, weight };
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The point of the footprint the contacts make on the ground (their convex
 * hull, seen from above) nearest to `p`, or null if `p` is inside it.
 */
function nearestOnFootprint(contacts: THREE.Vector3[], p: THREE.Vector3): { x: number; z: number } | null {
  const pts = contacts.map((c) => ({ x: c.x, z: c.z })).sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  // Monotone chain, counter-clockwise.
  const lower: { x: number; z: number }[] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-9) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; z: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-9) upper.pop();
    upper.push(q);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length === 0) hull.push(pts[0]);
  if (hull.length >= 3 && hull.every((a, i) => cross(a, hull[(i + 1) % hull.length], p) >= 0)) return null;
  let best = hull[0];
  let bestD = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    const q = { x: a.x + dx * t, z: a.z + dz * t };
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

/**
 * Let a fallen part tip over until it rests on the ground instead of
 * balancing on one foot or one edge. While its weight isn't over what it
 * stands on, it rolls about the nearest point or edge of that toward its
 * weight until another part touches down, like a toppling block.
 */
function settle(root: THREE.Object3D, part: THREE.Object3D): void {
  ground(root, part);
  for (let step = 0; step < 6; step++) {
    const { points, weight } = hull(root, part);
    if (points.length === 0) return;
    const low = Math.min(...points.map((p) => p.y));
    const span = Math.max(...points.map((p) => p.y)) - low;
    const touch = Math.max(0.03, span * 0.02);
    const contacts = points.filter((p) => p.y < low + touch);
    // Where it stands (seen from above), and the nearest point of that to where its weight is.
    const near = nearestOnFootprint(contacts, weight);
    if (!near) return; // its weight is over what it stands on: it's down
    const pivot = new THREE.Vector3(near.x, low, near.z);
    const toward = new THREE.Vector3(weight.x - near.x, 0, weight.z - near.z);
    const lean = toward.length();
    if (lean < touch) return;
    toward.divideScalar(lean);
    // Roll toward the weight until the next part touches down.
    let angle = Math.PI / 2;
    for (const p of points) {
      const across = (p.x - pivot.x) * toward.x + (p.z - pivot.z) * toward.z;
      const up = p.y - pivot.y;
      if (across <= 1e-3 || up < touch) continue;
      angle = Math.min(angle, Math.atan2(up, across));
    }
    if (angle < 0.01) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(UP, toward).normalize(), angle);
    part.position.sub(pivot).applyQuaternion(q).add(pivot);
    part.quaternion.premultiply(q);
    ground(root, part);
  }
}

/** Burn the paint: a shade of char for each part, the same for parts that shared a colour. */
function char(meshes: THREE.Mesh[], rng: Rng): void {
  const shade = new Map<THREE.Material, THREE.Material>();
  for (const mesh of meshes) {
    const mat = mesh.material as THREE.Material;
    // Lights go out (afterburners, eyes); blob shadows stay.
    if (mat.userData.batch === 'glow') mesh.visible = false;
    if (mesh.userData.noShadow) continue;
    let burnt = shade.get(mat);
    if (!burnt) {
      const k = rng.pick(CHAR_SHADES);
      if (k >= 1 || mat.userData.batch !== 'flat') burnt = CHARRED;
      else {
        _c.copy((mat as THREE.MeshStandardMaterial).color).lerp(_char, k);
        burnt = flatMaterial(_c.getHex());
      }
      shade.set(mat, burnt);
    }
    mesh.material = burnt;
  }
}

/**
 * Knock the turret out of true, slewing it up to `swing` radians round. Ground vehicles sometimes lose it outright:
 * it lands upside down or on its side next to the hull.
 */
function breakTurret(root: THREE.Object3D, turret: THREE.Object3D, rng: Rng, canLose: boolean, swing: number): boolean {
  const roll = rng.next();
  turret.rotation.y += rng.range(-swing, swing);
  if (canLose && roll < 0.28) {
    root.updateMatrixWorld(true);
    const hull = boundsIn(root, root, new THREE.Box3());
    const side = rng.chance(0.5) ? 1 : -1;
    const width = Math.max(hull.max.z, -hull.min.z);
    turret.position.x += rng.range(-0.6, 0.3) * (hull.max.x - hull.min.x) * 0.5;
    turret.position.z = side * width * rng.range(1.05, 1.5);
    turret.rotation.x = side * rng.range(1.3, 3.0);
    turret.rotation.y += rng.range(-1, 1);
    ground(root, turret);
    return true;
  }
  if (roll < 0.62) {
    // Slewed off its ring: tipped to one side, the gun pointing at the dirt or the sky.
    turret.rotation.x = rng.range(-0.35, 0.35);
    turret.rotation.z = rng.range(-0.3, 0.2);
    turret.position.y -= rng.range(0, 0.1);
  } else {
    // Jammed where it stopped, the gun drooping.
    turret.rotation.z = -rng.range(0.08, 0.3);
  }
  return false;
}

/** Bend a few small parts askew and knock a couple clean off. */
function breakBits(meshes: THREE.Mesh[], rng: Rng, keep: Set<THREE.Object3D>): void {
  const size = (m: THREE.Mesh) => {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const s = m.geometry.boundingBox!.getSize(new THREE.Vector3());
    return s.x * s.y * s.z;
  };
  const biggest = Math.max(...meshes.map(size));
  const small = meshes.filter((m) => !m.userData.noShadow && !keep.has(m) && size(m) < biggest * SMALL_PART);
  const count = Math.min(small.length, rng.int(1, 3));
  for (let i = 0; i < count; i++) {
    const m = small.splice(rng.int(0, small.length - 1), 1)[0];
    if (rng.chance(0.4)) m.visible = false;
    else {
      m.rotation.x += rng.range(-0.5, 0.5);
      m.rotation.y += rng.range(-0.4, 0.4);
      m.rotation.z += rng.range(-0.6, 0.3);
    }
  }
}

/**
 * Break a model into a wreck: burn it, pose it broken, and return the fall
 * into that pose for the entity view to play (see stepCollapse). `seed` picks
 * how (the entity id, so it's the same every time). `surface` is the ground
 * height at a world point, for lying along a slope; the model must already
 * stand where it died.
 */
export function breakModel(obj: THREE.Object3D, seed: number, surface?: (x: number, z: number) => number): Collapse {
  const rng = new Rng(Math.imul(seed + 1, 0x9e3779b1));
  const rig = getRig(obj);
  const meshes = meshesOf(obj);
  obj.updateMatrixWorld(true);
  const extent = boundsIn(obj, obj, new THREE.Box3()).getSize(new THREE.Vector3());
  const size = Math.max(extent.x, extent.y, extent.z) * obj.scale.x;
  const parts: THREE.Object3D[] = [];
  obj.traverse((o) => o !== obj && parts.push(o));
  const start = parts.map((p) => ({ p: p.position.clone(), q: p.quaternion.clone() }));
  const root = { x0: obj.rotation.x, z0: obj.rotation.z, x1: 0, z1: 0 };

  char(meshes, rng);
  // Hips, knees and the like are posed by the model's own rig; the rest here.
  const keep = new Set<THREE.Object3D>();
  // Legs aren't small parts to bend or knock off: the rig chose what they lose.
  obj.traverse((o) => o.name === 'leg' && o.traverse((c) => keep.add(c)));
  const fallen = rig?.wreck?.(rng);
  let thrown: THREE.Object3D | null = null;
  if (rig?.flies && !fallen) {
    // Shot down: nose first, rolled over.
    root.z1 = -rng.range(0.15, 0.5);
    root.x1 = rng.range(-0.7, 0.7);
  } else if (!fallen) {
    root.x1 = rng.range(-0.2, 0.2);
    root.z1 = rng.range(-0.16, 0.16);
  }
  if (rig?.turret) {
    // Only a turret on the hull itself can come off (not one on a walker's body or a boat's rocking deck).
    // A walker's body may end up on its side, where a slewed torso would aim its guns into the ground and prop it up.
    if (breakTurret(obj, rig.turret, rng, !fallen && !rig.flies && rig.turret.parent === obj, fallen ? 0.3 : 0.9)) thrown = rig.turret;
    rig.turret.traverse((o) => keep.add(o));
  }
  breakBits(meshes, rng, keep);
  if (fallen) settle(obj, fallen);
  // Lie along the slope it fell on (a plane through the ground round it), not level with the world.
  if (surface && !rig?.flies) {
    const r = Math.max(1, Math.max(extent.x, extent.z) * obj.scale.x * 0.5);
    const { x, z } = obj.position;
    const gx = (surface(x + r, z) - surface(x - r, z)) / (2 * r);
    const gz = (surface(x, z + r) - surface(x, z - r)) / (2 * r);
    // The rise along the model's nose (+x) and its left side (+z), after its heading.
    const h = obj.rotation.y;
    const ahead = gx * Math.cos(h) - gz * Math.sin(h);
    const aside = gx * Math.sin(h) + gz * Math.cos(h);
    root.z1 += Math.atan(ahead);
    root.x1 -= Math.atan(aside);
  }

  const moves: PartMove[] = [];
  parts.forEach((part, i) => {
    const { p, q } = start[i];
    if (part.position.equals(p) && part.quaternion.equals(q)) return;
    moves.push({ part, p0: p, p1: part.position.clone(), q0: q, q1: part.quaternion.clone(), arc: part === thrown ? rng.range(0.6, 1.4) * Math.max(1, extent.y) : 0 });
    part.position.copy(p);
    part.quaternion.copy(q);
  });
  // Big things take longer to come down.
  return { moves, root, elapsed: 0, duration: 0.35 + 0.3 * Math.sqrt(size) };
}

/** Advance a wreck's fall by `dt` seconds; false once it has come to rest. */
export function stepCollapse(obj: THREE.Object3D, c: Collapse, dt: number): boolean {
  c.elapsed = Math.min(c.duration, c.elapsed + dt);
  const t = c.elapsed / c.duration;
  // Falling: slow to start, fast at the end, like something toppling under gravity.
  const k = t * t;
  for (const m of c.moves) {
    if (m.arc > 0) {
      // Thrown: flies out and up, tumbling, and comes down beside the hull.
      m.part.position.lerpVectors(m.p0, m.p1, t);
      m.part.position.y += 4 * m.arc * t * (1 - t);
      m.part.quaternion.slerpQuaternions(m.q0, m.q1, t);
    } else {
      m.part.position.lerpVectors(m.p0, m.p1, k);
      m.part.quaternion.slerpQuaternions(m.q0, m.q1, k);
    }
  }
  obj.rotation.x = c.root.x0 + (c.root.x1 - c.root.x0) * k;
  obj.rotation.z = c.root.z0 + (c.root.z1 - c.root.z0) * k;
  return c.elapsed < c.duration;
}
