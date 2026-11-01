import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { Entity } from '../core/ecs';
import { Rng } from '../core/rng';
import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { CameraRig } from './cameraRig';
import { disposeTree } from './dispose';
import { Effects } from './effects';
import { EntityView } from './entityView';
import { FightWatch } from './fightWatch';
import { Markers } from './markers';
import { setFactionPalette } from './models';
import './models/buildings';
import './models/projectiles';
import './models/units';
import { buildProps } from './propsMesh';
import { buildTerrain } from './terrainMesh';
import { TiltShift } from './tiltShift';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _up2 = new THREE.Vector3();
const _snap = new THREE.Vector3();

/**
 * Shadow detail. Shadows are drawn only around what the camera can see;
 * `low` uses a coarser shadow map, `off` skips the shadow pass, which
 * otherwise draws every visible unit and building a second time.
 */
export type ShadowQuality = 'high' | 'low' | 'off';

const SHADOW_MAP: Record<Exclude<ShadowQuality, 'off'>, number> = { high: 4096, low: 2048 };

/** Where the sun sits relative to the point it lights. */
const SUN_OFFSET = new THREE.Vector3(-60, 90, 40);
/** Extra shadow coverage past the view's edge, for tall things and long shadows just off screen. */
const SHADOW_MARGIN = 14;

/**
 * Everything visual: renderer, scene, lights, camera and post-processing.
 * Reads game state, never writes it.
 *
 * The renderer, camera and post chain live for the whole session; each
 * battle's terrain, entities and effects are loaded into `battle` and torn
 * down when the next battle loads.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly tiltShift = new TiltShift();
  entities!: EntityView;
  effects!: Effects;
  markers!: Markers;
  /** Finds the fighting for the spectator camera. */
  fights!: FightWatch;
  /** Entity highlighted by the UI. */
  selected: Entity | null = null;
  /** Spectator camera: glide to wherever the fighting is. Panning by hand turns it off. */
  followFights = false;
  /** Called when panning by hand turns `followFights` off. */
  onFollowStopped: (() => void) | null = null;
  private shadowQuality: ShadowQuality = 'high';
  /** Half the size of the whole map, the most shadow coverage ever needed. */
  private mapHalf = 100;
  private readonly raycaster = new THREE.Raycaster();
  private ground!: THREE.Object3D;
  private battle: THREE.Group | null = null;
  private readonly composer: EffectComposer;
  private readonly sun: THREE.DirectionalLight;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fb4c4);

    this.rig = new CameraRig(this.renderer.domElement, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    this.rig.onManualPan = () => {
      if (!this.followFights) return;
      this.followFights = false;
      this.onFollowStopped?.();
    };

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4436, 1.3));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP.high, SHADOW_MAP.high);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    // Multisampled HDR target so edges stay clean through the post chain.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
    for (const pass of this.tiltShift.passes) this.composer.addPass(pass);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** Show a new battle, replacing whatever was loaded before. */
  load(game: Game, factions: readonly FactionDef[]): void {
    if (this.battle) {
      this.scene.remove(this.battle);
      disposeTree(this.battle);
    }
    this.selected = null;
    setFactionPalette(factions);
    const field = game.field;
    const battle = new THREE.Group();
    battle.name = 'battle';

    const visualRng = new Rng(game.seed ^ 0x5eed);
    const terrain = buildTerrain(field, visualRng);
    this.ground = terrain.getObjectByName('ground')!;
    battle.add(terrain, buildProps(game.props, visualRng));
    this.entities = new EntityView(game.world);
    this.effects = new Effects(game.events, field);
    this.markers = new Markers(game, this.entities);
    battle.add(this.entities.root, this.effects.root, this.markers.root);
    this.scene.add(battle);
    this.battle = battle;

    this.fights = new FightWatch(game.events, field.bounds);
    this.mapHalf = Math.max(field.width, field.depth) * 0.6;
    this.rig.setBounds(field.bounds);
  }

  get shadows(): ShadowQuality {
    return this.shadowQuality;
  }

  set shadows(q: ShadowQuality) {
    if (q === this.shadowQuality) return;
    this.shadowQuality = q;
    // Materials pick up the change in light setup by recompiling on the next frame.
    this.sun.castShadow = q !== 'off';
    if (q !== 'off' && this.sun.shadow.mapSize.x !== SHADOW_MAP[q]) {
      this.sun.shadow.mapSize.set(SHADOW_MAP[q], SHADOW_MAP[q]);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /**
   * Fit the sun's shadow to what the camera can see. Only things inside it
   * are drawn into the shadow map, so a zoomed-in view skips the rest of the
   * battle, and the map's detail goes where you're looking. The shadow moves
   * in whole shadow-map texels so its edges don't shimmer as the camera pans.
   */
  private fitShadow(): void {
    if (this.shadowQuality === 'off') return;
    const sc = this.sun.shadow.camera;
    // Coverage in steps of 4 units, so zooming doesn't resize it every frame.
    const half = Math.min(this.mapHalf, Math.ceil((this.rig.viewRadius + SHADOW_MARGIN) / 4) * 4);
    if (sc.right !== half) {
      sc.left = -half;
      sc.right = half;
      sc.top = half;
      sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    const texel = (2 * half) / this.sun.shadow.mapSize.x;
    const dir = _dir.copy(SUN_OFFSET).negate().normalize();
    const right = _right.crossVectors(dir, _up).normalize();
    const up = _up2.crossVectors(right, dir);
    const t = this.rig.target;
    const u = t.dot(right);
    const v = t.dot(up);
    const snapped = _snap.copy(t).addScaledVector(right, Math.round(u / texel) * texel - u).addScaledVector(up, Math.round(v / texel) * texel - v);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).add(SUN_OFFSET);
    this.sun.target.updateMatrixWorld();
  }

  /** `simSeconds` is frame time scaled by sim speed, so animations pause with the game. */
  render(alpha: number, frameSeconds: number, simSeconds: number): void {
    if (!this.battle) return;
    this.fights.update(simSeconds);
    if (this.followFights && this.fights.focus) this.rig.glideTo(this.fights.focus.x, this.fights.focus.z, frameSeconds);
    this.rig.update(frameSeconds);
    this.fitShadow();
    this.entities.sync(alpha, simSeconds);
    this.effects.update(simSeconds);
    this.markers.update(frameSeconds, this.selected);
    this.composer.render(frameSeconds);
  }

  /** Ground point under a screen position, or null if off the map. */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    if (!this.battle) return null;
    this.setRay(clientX, clientY);
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }

  /** Entity (unit or building) under a screen position, if any. */
  pickEntity(clientX: number, clientY: number): Entity | null {
    if (!this.battle) return null;
    this.setRay(clientX, clientY);
    for (const hit of this.raycaster.intersectObject(this.entities.root, true)) {
      const e = this.entities.entityForObject(hit.object);
      if (e !== null) return e;
    }
    return null;
  }

  private setRay(clientX: number, clientY: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.rig.camera);
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.tiltShift.setSize(w * pr, h * pr);
    this.rig.setSize(w, h);
  }
}
