import * as THREE from 'three';
import { Entity, World } from '../core/ecs';
import { Armed, Arsenal, Collider, Construction, Faction, Unit, Renderable, Tilt, Transform, Veiled, Wreck } from '../game/components';
import { hullMatrix, mountOf, turretYaw } from '../game/mounts';
import { Batcher } from './batcher';
import { createModel, getRig } from './models';
import { breakModel, Collapse, Crumble, startCrumble, stepCollapse, stepCrumble } from './wrecks';
import { CRUMBLE_TIME } from '../game/systems/death';
import { SIM_HZ } from '../game/game';
import type { EventBus } from '../core/events';
import type { GameEvents } from '../game/context';
import type { MeleeDef } from '../game/units';

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface ViewEntry {
  obj: THREE.Object3D;
  /** Faction the model was built for; a captured outpost building is rebuilt in its new colours. */
  faction: number;
  lastX: number;
  lastZ: number;
  wrecked: boolean;
  /** The model's meshes and sprites, which the batcher draws. */
  meshes: THREE.Mesh[];
  sprites: THREE.Sprite[];
  /** How far an aircraft is leaning into its turn now (see ModelRig.bank). */
  roll: number;
  /** A wreck still falling into its broken pose. */
  collapse: Collapse | null;
  /** A hulk falling apart into its parts before it goes (see startCrumble). */
  crumble: Crumble | null;
  /** Boats: the model's height above its waterline, and how far it's ducked under a bridge now (see the deck check). */
  top: number;
  duck: number;
  /** Goes on the ground, so is drawn standing on any road there (see the road check). */
  grounded: boolean;
  /** A melee blow under way (see the 'struck' event): seconds into it, how it swings, and how far the body jabs forward. */
  strike: { t: number; style: MeleeDef['style']; jab: number } | null;
  /**
   * How far it has faded out (0 solid, 1 a ghost): stealthed units (see
   * game/smoke.ts) fade out slowly and back in quickly, so one that hides
   * for a moment between shots only dims a little instead of blinking.
   */
  fade: number;
  /** Seconds it has been hidden without a break (see HIDE_HOLD). */
  hiddenFor: number;
}

/**
 * What a stealthed unit is drawn in as it fades out: a few steps of fainter,
 * see-through shimmer of itself, down to a ghost at the last.
 */
const GHOSTS = [0.8, 0.6, 0.45, 0.3].map((opacity) => new THREE.MeshLambertMaterial({ transparent: true, opacity, depthWrite: false }));
/**
 * Seconds a unit has to stay hidden before it starts to fade, so one that
 * hides between shots a moment apart stays solid instead of blinking
 * between solid and the first ghost step (the flicker check caught ghost
 * tanks doing that four times a second).
 */
const HIDE_HOLD = 0.6;
/** Seconds to fade out to a ghost, and back in. */
const FADE_OUT = 0.9;
const FADE_IN = 0.25;

/** Seconds a melee blow takes to draw. */
const STRIKE_TIME = 0.35;

const _ahead = new THREE.Vector3();
/** Where round a boat to look for a deck overhead (scaled by its size), and the gap it keeps under one. */
const DUCK_RING: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
const DUCK_GAP = 0.2;
/** A ground unit up to this far under a drawn road is drawn on top of it (further under, it's in a cutting or tunnel of some kind: leave it be). */
const ROAD_REACH = 1.5;
const _m: number[] = new Array(9);
/** Most an aircraft leans into a turn, radians. */
const MAX_BANK = 0.75;

/** Whether a part and everything between it and its model's root is visible (models blink lights by hiding them). */
function shown(part: THREE.Object3D, top: THREE.Object3D): boolean {
  for (let o: THREE.Object3D | null = part; o; o = o.parent) {
    if (!o.visible) return false;
    if (o === top) return true;
  }
  return true;
}

/**
 * Mirrors ECS entities into the Three.js scene. The simulation never touches
 * Three objects; this view creates, positions, animates and removes them.
 *
 * The models themselves (under `root`) are hidden: they're there to be
 * posed, animated and picked. What's drawn is the batcher's instanced copy
 * of them (`drawn`), a draw call per kind of part instead of per part.
 */
export class EntityView {
  /** The models, posed but not drawn; raycast against these to pick entities. */
  readonly root = new THREE.Group();
  /** What's drawn: add to the scene alongside root. */
  readonly drawn: THREE.Object3D;
  private readonly batcher = new Batcher();
  private readonly entries = new Map<Entity, ViewEntry>();
  private readonly owners = new WeakMap<THREE.Object3D, Entity>();
  /** Entities not to draw (yet): with the sim in its worker, ones born after the moment being drawn (see SimView.unborn). */
  hidden: ReadonlySet<Entity> | null = null;

  /** `surface` is the ground height at a world point, which wrecks lie along. */
  /** `deck` is the height of a bridge deck over a world point, or null: tall boats duck under them. */
  /** `road` is the height a road is drawn at over a world point (-Infinity off roads; see RoadTops): units stand on them. */
  constructor(
    private readonly world: World,
    private readonly surface?: (x: number, z: number) => number,
    private readonly deck?: (x: number, z: number) => number | null,
    private readonly road?: (x: number, z: number) => number,
    events?: EventBus<GameEvents>,
  ) {
    this.root.name = 'entities';
    this.root.visible = false;
    // Its matrices are brought up to date in sync, just before batching; the renderer needn't do it again.
    this.root.matrixWorldAutoUpdate = false;
    this.drawn = this.batcher.root;
    world.onDestroy((e) => this.remove(e));
    // A melee blow: the striker's body jabs at its target as the model swings (see ModelRig.strike).
    this.stopStruck = events?.on('struck', (s) => {
      const entry = this.entries.get(s.entity);
      if (!entry) return;
      const radius = world.get(s.entity, Collider)?.radius ?? 0.5;
      entry.strike = { t: 0, style: s.style, jab: s.style === 'stomp' ? 0 : radius * (s.style === 'thrust' ? 0.45 : 0.25) };
    });
  }

  private readonly stopStruck?: () => void;

  /** Free the batches' GPU buffers (when the battle is unloaded). */
  dispose(): void {
    this.stopStruck?.();
    this.batcher.dispose();
  }

  /** Draw calls the entities take (before shadows), for the stats readout. */
  get batches(): number {
    return this.batcher.batches;
  }

  /**
   * `alpha` is how far between the previous and current sim tick we are.
   * `dt` is frame time scaled by sim speed, used for animation.
   */
  sync(alpha: number, dt: number): void {
    const w = this.world;
    for (const e of w.query(Transform, Renderable)) {
      let entry = this.entries.get(e);
      if (this.hidden?.has(e)) {
        if (entry) entry.obj.visible = false;
        continue;
      }
      if (entry) entry.obj.visible = true;
      const t = w.req(e, Transform);
      const faction = w.get(e, Faction)?.id ?? 0;
      if (entry && entry.faction !== faction) {
        this.remove(e);
        entry = undefined;
      }
      if (!entry) {
        const r = w.req(e, Renderable);
        const obj = createModel(r.model, faction);
        obj.scale.setScalar(r.scale);
        const meshes: THREE.Mesh[] = [];
        const sprites: THREE.Sprite[] = [];
        obj.traverse((o) => {
          if ((o as THREE.Sprite).isSprite) sprites.push(o as THREE.Sprite);
          else if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
        });
        const move = w.get(e, Unit)?.def.move;
        const naval = move === 'naval';
        const grounded = move !== undefined && move !== 'naval' && move !== 'air';
        const top = naval ? new THREE.Box3().setFromObject(obj).max.y : 0;
        entry = { obj, faction, lastX: t.px, lastZ: t.pz, wrecked: false, meshes, sprites, roll: 0, collapse: null, crumble: null, top, duck: 0, grounded, strike: null, fade: 0, hiddenFor: 0 };
        // Turn, then pitch the nose, then roll along the model's own length (banking, or lying along a slope), as the sim's mounts do (see game/mounts.ts).
        obj.rotation.order = 'YZX';
        this.entries.set(e, entry);
        this.owners.set(obj, e);
        this.root.add(obj);
      }
      const { obj } = entry;
      const rig = getRig(obj);

      const x = t.px + (t.x - t.px) * alpha;
      const z = t.pz + (t.z - t.pz) * alpha;
      let y = t.py + (t.y - t.py) * alpha;
      // The sim's ground runs under the drawn roads, which are lifted over bumps and banked on
      // slopes: stand on the road instead of sinking into it (looks only).
      if (entry.grounded && this.road) {
        const top = this.road(x, z);
        if (top > y && top - y < ROAD_REACH) y = top;
      }
      if (rig?.faceVelocity) {
        // Point along the path from the previous to current sim position.
        _ahead.set(t.x - t.px, t.y - t.py, t.z - t.pz);
        if (_ahead.lengthSq() > 1e-8) obj.lookAt(_ahead.add(obj.position.set(x, y, z)));
        else obj.position.set(x, y, z);
      } else {
        obj.position.set(x, y, z);
        obj.rotation.y = lerpAngle(t.pheading, t.heading, alpha);
      }
      // A boat taller than the room under a bridge settles lower in the water while it passes
      // under (looks only), so its top doesn't show through the deck.
      if (entry.top > 0 && this.deck) {
        let want = 0;
        const reach = entry.top * 0.8;
        for (const [ox, oz] of DUCK_RING) {
          const d = this.deck(x + ox * reach, z + oz * reach);
          if (d !== null) want = Math.max(want, y + entry.top + DUCK_GAP - d);
        }
        entry.duck += (want - entry.duck) * (want > entry.duck ? 0.5 : 0.1);
        if (entry.duck > 0.001) obj.position.y -= entry.duck;
      }

      // Construction sites rise out of the ground.
      const construction = w.get(e, Construction);
      const scale = w.req(e, Renderable).scale;
      obj.scale.y = construction ? scale * Math.max(0.04, construction.elapsed / construction.duration) : scale;

      if (!entry.wrecked && w.has(e, Wreck)) {
        entry.wrecked = true;
        entry.collapse = breakModel(obj, e, this.surface);
      }
      if (entry.wrecked) {
        if (entry.collapse && !stepCollapse(obj, entry.collapse, dt)) entry.collapse = null;
        // Near the end the hulk falls apart, its parts dropping off and going one by one.
        const wreck = w.get(e, Wreck);
        if (!entry.crumble && !entry.collapse && wreck && w.time >= wreck.removeAt - CRUMBLE_TIME) {
          entry.crumble = startCrumble(obj, e, Math.max(0.5, wreck.removeAt - w.time));
        }
        if (entry.crumble) stepCrumble(entry.crumble, dt);
        continue;
      }

      // Tanks and trucks lie along the ground under them.
      const tilt = w.get(e, Tilt);
      if (tilt) {
        obj.rotation.z = tilt.ppitch + (tilt.pitch - tilt.ppitch) * alpha;
        obj.rotation.x = tilt.proll + (tilt.roll - tilt.proll) * alpha;
      }

      if (rig?.bank) {
        // Lean into the turn: the turn rate over the last tick, eased so it doesn't twitch.
        const turn = lerpAngle(0, t.heading - t.pheading, 1) * SIM_HZ;
        const want = Math.max(-MAX_BANK, Math.min(MAX_BANK, -turn * rig.bank));
        entry.roll += (want - entry.roll) * Math.min(1, dt * 4);
        obj.rotation.x = entry.roll;
      }

      const armed = w.get(e, Armed);
      if (rig?.turret && armed) {
        // The turret turns on the hull's deck, tilted or not, and the barrels pitch on the turret.
        const tilted = obj.rotation.x !== 0 || obj.rotation.z !== 0;
        rig.turret.rotation.y = tilted && mountOf(w.req(e, Renderable).model) ? turretYaw(hullMatrix(obj.rotation.y, obj.rotation.z, obj.rotation.x, _m), armed.aim) : armed.aim - obj.rotation.y;
        if (rig.barrels) for (const b of rig.barrels) b.rotation.z = armed.elev;
      }
      // Weapons on mounts of their own turn and pitch to their own aim.
      const arsenal = rig?.mounts ? w.get(e, Arsenal) : undefined;
      if (rig?.mounts && arsenal) {
        const tilted = obj.rotation.x !== 0 || obj.rotation.z !== 0;
        const m = tilted ? hullMatrix(obj.rotation.y, obj.rotation.z, obj.rotation.x, _m) : null;
        rig.mounts.forEach((mount, k) => {
          const a = arsenal.arms[k];
          if (!a) return;
          if (mount.turret) mount.turret.rotation.y = m ? turretYaw(m, a.aim) : a.aim - obj.rotation.y;
          if (mount.barrels) for (const b of mount.barrels) b.rotation.z = a.elev;
        });
      }
      // A melee blow: jab forward and back along the way it faces, while the model swings.
      if (entry.strike) {
        const s = entry.strike;
        s.t += dt;
        const k = Math.min(1, s.t / STRIKE_TIME);
        const jab = Math.sin(Math.PI * k) * s.jab;
        obj.position.x += Math.cos(obj.rotation.y) * jab;
        obj.position.z -= Math.sin(obj.rotation.y) * jab;
        rig?.strike?.(k, s.style);
        if (k >= 1) entry.strike = null;
      }
      if (rig?.animate) {
        const moved = Math.hypot(x - entry.lastX, z - entry.lastZ);
        rig.animate({ dt, speed: dt > 0 ? moved / dt : 0 });
      }
      entry.lastX = x;
      entry.lastZ = z;
      const veiled = w.get(e, Veiled)?.hidden === true;
      entry.hiddenFor = veiled ? entry.hiddenFor + dt : 0;
      entry.fade = veiled ? (entry.hiddenFor >= HIDE_HOLD ? Math.min(1, entry.fade + dt / FADE_OUT) : entry.fade) : Math.max(0, entry.fade - dt / FADE_IN);
    }
    this.batch();
  }

  /** Copy every visible part into the batches. */
  private batch(): void {
    this.root.updateMatrixWorld();
    const b = this.batcher;
    b.begin();
    for (const entry of this.entries.values()) {
      // Solid for the first fifth of the fade, then a step fainter each fifth after.
      const step = Math.floor(entry.fade * 5) - 1;
      const ghost = step < 0 ? undefined : GHOSTS[Math.min(step, GHOSTS.length - 1)];
      for (const m of entry.meshes) if (shown(m, entry.obj)) b.addMesh(m, ghost);
      // A stealthed trooper is drawn faint and see-through, once it's halfway faded.
      for (const s of entry.sprites) if (shown(s, entry.obj)) b.addSprite(s, entry.fade >= 0.5);
    }
    b.end();
  }

  get count(): number {
    return this.entries.size;
  }

  /**
   * How each entity looks right now, as a number that changes whenever its
   * look does: parts shown (lights blinking, parts hidden), how far it has
   * faded out, and whether its sprites are drawn faint. For the flicker
   * check (scripts/flicker.mjs), which watches these for anything changing
   * back and forth faster than the eye is comfortable with.
   */
  *looks(): IterableIterator<[Entity, number]> {
    for (const [e, entry] of this.entries) {
      if (!entry.obj.visible) continue;
      let parts = 0;
      for (const m of entry.meshes) if (shown(m, entry.obj)) parts++;
      for (const s of entry.sprites) if (shown(s, entry.obj)) parts++;
      const ghost = Math.max(0, Math.floor(entry.fade * 5));
      yield [e, parts + ghost * 1000];
    }
  }

  /** The scene object drawing an entity, if any. */
  objectFor(e: Entity): THREE.Object3D | undefined {
    return this.entries.get(e)?.obj;
  }

  /** Which entity a raycast hit belongs to (walks up to the model's root). */
  entityForObject(hit: THREE.Object3D): Entity | null {
    for (let o: THREE.Object3D | null = hit; o; o = o.parent) {
      const e = this.owners.get(o);
      if (e !== undefined) return e;
    }
    return null;
  }

  private remove(e: Entity): void {
    const entry = this.entries.get(e);
    if (!entry) return;
    this.root.remove(entry.obj);
    this.entries.delete(e);
    // Sprites own a per-instance material and texture view; everything else is shared.
    entry.obj.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) {
        const m = (o as THREE.Sprite).material;
        m.map?.dispose();
        m.dispose();
      }
    });
  }
}
