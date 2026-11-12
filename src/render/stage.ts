import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { Entity } from '../core/ecs';
import { Rng } from '../core/rng';
import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { SPRITE_GAIN } from './batcher';
import { CameraRig } from './cameraRig';
import { disposeTree } from './dispose';
import { Effects } from './effects';
import { EntityView } from './entityView';
import { FightWatch } from './fightWatch';
import { OutpostRings } from './outpostRings';
import { Markers } from './markers';
import { CommanderOverlay } from './commanderOverlay';
import { FrontLines } from './frontLines';
import { FireGround } from './fireGround';
import { DEBUG_LAYERS, DebugLayer, DebugOverlay } from './debugOverlay';
import { setFactionPalette } from './models';
import './models/buildings';
import './models/projectiles';
import './models/units';
import { buildProps } from './propsMesh';
import { buildTerrain } from './terrainMesh';
import { buildWoods } from './woodsMesh';
import { GodCursor } from './godCursor';
import { GodEffects } from './godEffects';
import './models/god';
import { BIOMES } from '../world/biomes';
import { setTownStyle } from './models/buildings';
import { TiltShift } from './tiltShift';

const DEBUG_IDS = DEBUG_LAYERS.map((l) => l.id);

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
  outpostRings!: OutpostRings;
  commanderOverlay!: CommanderOverlay;
  frontLines!: FrontLines;
  private fireGround!: FireGround;
  /** Where a god power will land (see GodPanel). */
  readonly godCursor = new GodCursor();
  private godEffects!: GodEffects;
  private frontsShown = false;
  private ringsShown = true;
  /** Where the sun sits relative to what it lights (see daylight). */
  private readonly sunOffset = SUN_OFFSET.clone();
  private readonly sky: THREE.HemisphereLight;
  private hour: number | null = null;
  /** The debug overlays (see DebugOverlay), replaced with each battle; the layers shown carry over. */
  debugOverlay!: DebugOverlay;
  /** Draw each side's plan on the map (see CommanderOverlay). */
  private plansShown = false;
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
  /** Stops the terrain redrawing for the battle being replaced (see buildTerrain). */
  private stopTerrain: (() => void) | undefined;
  /** Stops the dense forest's trees following the battle being replaced (see buildWoods). */
  private stopWoods: (() => void) | undefined;
  private stopProps: (() => void) | undefined;
  private readonly composer: EffectComposer;
  private readonly sun: THREE.DirectionalLight;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    // Counted over the whole frame (shadow and post passes too) and reset in render, for the stats readout.
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fb4c4);

    this.rig = new CameraRig(this.renderer.domElement, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    this.rig.onManualPan = () => {
      if (!this.followFights) return;
      this.followFights = false;
      this.onFollowStopped?.();
    };

    this.sky = new THREE.HemisphereLight(0xdfeeff, 0x4a4436, 1.3);
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.copy(SUN_OFFSET);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SHADOW_MAP.high, SHADOW_MAP.high);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    // No bias at all. The depth bias is a fraction of the shadow camera's depth (300 units),
    // so the old -0.0005 slid every shadow 0.15 units off its caster and left a sunlit sliver
    // under each object, as if it floated; any normal bias still leaves a hairline. Shadows
    // are drawn from back faces (three's default), so lit faces don't shadow themselves.
    this.sun.shadow.bias = 0;
    this.sun.shadow.normalBias = 0;
    this.scene.add(this.sun, this.sun.target, this.godCursor.root);
    // Infantry sprites are lit like flat ground (see batcher.ts): scaled so this usual light shows them as painted.
    const lit = this.sky.color.clone().multiplyScalar(this.sky.intensity).add(this.sun.color.clone().multiplyScalar(this.sun.intensity * SUN_OFFSET.clone().normalize().y));
    SPRITE_GAIN.value.set(Math.PI / lit.r, Math.PI / lit.g, Math.PI / lit.b);

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
      this.stopTerrain?.();
      this.stopWoods?.();
      this.stopProps?.();
      this.entities.dispose();
      this.commanderOverlay.dispose();
      this.frontLines.dispose();
      this.fireGround.dispose();
      this.debugOverlay.dispose();
      disposeTree(this.battle);
    }
    this.selected = null;
    setFactionPalette(factions);
    const field = game.field;
    const battle = new THREE.Group();
    battle.name = 'battle';

    const visualRng = new Rng(game.seed ^ 0x5eed);
    const terrain = buildTerrain(field, visualRng);
    this.stopTerrain = terrain.userData.dispose;
    this.ground = terrain.getObjectByName('ground')!;
    const biome = BIOMES[field.config.biome];
    (this.scene.background as THREE.Color).set(biome.sky);
    setTownStyle(biome.town);
    const woods = buildWoods(field, visualRng.fork(0x77));
    this.stopWoods = woods.userData.dispose;
    const props = buildProps(field, game.props, visualRng);
    this.stopProps = props.userData.dispose;
    battle.add(terrain, props, woods);
    this.entities = new EntityView(game.world);
    this.effects = new Effects(game.events, field);
    this.godEffects = new GodEffects(game, this.effects);
    this.godCursor.attach(field);
    this.markers = new Markers(game, this.entities);
    this.outpostRings = new OutpostRings(game);
    this.outpostRings.root.visible = this.ringsShown;
    this.commanderOverlay = new CommanderOverlay(game);
    this.commanderOverlay.visible = this.plansShown;
    this.frontLines = new FrontLines(game);
    this.frontLines.visible = this.frontsShown;
    battle.add(this.frontLines.root);
    this.fireGround = new FireGround(game, this.ground as THREE.Mesh);
    battle.add(this.fireGround.root);
    const debugShown = this.debugOverlay ? DEBUG_IDS.filter((l) => this.debugOverlay.isShown(l)) : [];
    const costClass = this.debugOverlay?.costClass;
    this.debugOverlay = new DebugOverlay(game);
    if (costClass) this.debugOverlay.costClass = costClass;
    battle.add(this.debugOverlay.root);
    // Shown once the caller has set where routes come from (see App.startBattle).
    this.debugCarry = debugShown;
    battle.add(this.entities.root, this.entities.drawn, this.effects.root, this.markers.root, this.outpostRings.root, this.commanderOverlay.root);
    this.scene.add(battle);
    this.battle = battle;

    this.fights = new FightWatch(game.events, field.bounds);
    this.mapHalf = Math.max(field.width, field.depth) * 0.6;
    this.rig.setBounds(field.bounds);
  }

  /** Front lines: a soft shading of who holds which ground (see FrontLines). */
  get showFronts(): boolean {
    return this.frontsShown;
  }

  set showFronts(on: boolean) {
    this.frontsShown = on;
    if (this.frontLines) this.frontLines.visible = on;
  }

  /** The capture rings round outposts (photo mode hides them). */
  get showOutpostRings(): boolean {
    return this.ringsShown;
  }

  set showOutpostRings(on: boolean) {
    this.ringsShown = on;
    if (this.outpostRings) this.outpostRings.root.visible = on;
  }

  /** The time of day the light is set for (photo mode), or null for the usual light. */
  get daylight(): number | null {
    return this.hour;
  }

  /**
   * Light the scene for an hour of the day, 5 (dawn) to 19 (dusk): the sun
   * rises in the east, swings round the south and sets in the west, low
   * sun warmer and dimmer. Null puts back the usual light. Looks only.
   */
  set daylight(hour: number | null) {
    this.hour = hour;
    if (hour === null) {
      this.sunOffset.copy(SUN_OFFSET);
      this.sun.color.set(0xfff1dc);
      this.sun.intensity = 2.6;
      this.sky.intensity = 1.3;
      return;
    }
    const day = Math.max(0, Math.min(1, (hour - 5) / 14));
    // Height of the sun: 0 at dawn and dusk, highest at noon.
    const up = Math.sin(day * Math.PI);
    const elevation = Math.max(0.06, up * 1.05);
    // From the east (+x) through the south (+z) to the west.
    const azimuth = day * Math.PI;
    const d = 110;
    this.sunOffset.set(Math.cos(azimuth) * Math.cos(elevation) * d, Math.sin(elevation) * d, Math.sin(azimuth) * Math.cos(elevation) * d);
    this.sun.color.set(0xffa25c).lerp(new THREE.Color(0xfff1dc), Math.min(1, up * 1.6));
    this.sun.intensity = 0.9 + 1.7 * up;
    this.sky.intensity = 0.55 + 0.75 * up;
  }

  /** The picture on screen now, as a PNG data URL (drawn again first, so the canvas still holds it). */
  capture(): string {
    this.composer.render(0);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** Debug layers that were showing before this battle loaded, to show again (see restoreDebug). */
  private debugCarry: DebugLayer[] = [];

  /** Show again the debug layers the last battle had on (after the overlay's routeSource is set). */
  restoreDebug(): void {
    for (const l of this.debugCarry) this.debugOverlay.show(l, true);
    this.debugCarry = [];
  }

  get showPlans(): boolean {
    return this.plansShown;
  }

  set showPlans(on: boolean) {
    this.plansShown = on;
    if (this.commanderOverlay) this.commanderOverlay.visible = on;
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
    const dir = _dir.copy(this.sunOffset).negate().normalize();
    const right = _right.crossVectors(dir, _up).normalize();
    const up = _up2.crossVectors(right, dir);
    const t = this.rig.target;
    const u = t.dot(right);
    const v = t.dot(up);
    const snapped = _snap.copy(t).addScaledVector(right, Math.round(u / texel) * texel - u).addScaledVector(up, Math.round(v / texel) * texel - v);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).add(this.sunOffset);
    this.sun.target.updateMatrixWorld();
  }

  /** `simSeconds` is frame time scaled by sim speed, so animations pause with the game. */
  render(alpha: number, frameSeconds: number, simSeconds: number): void {
    if (!this.battle) return;
    this.fights.update(simSeconds);
    if (this.followFights && this.fights.focus) this.rig.glideTo(this.fights.focus.x, this.fights.focus.z, frameSeconds);
    this.rig.update(frameSeconds);
    this.shakeCamera();
    this.fitShadow();
    this.entities.sync(alpha, simSeconds);
    this.effects.update(simSeconds);
    this.godEffects.update(simSeconds);
    this.markers.update(frameSeconds, this.selected);
    this.outpostRings.update();
    this.commanderOverlay.update();
    this.frontLines.update(frameSeconds);
    this.fireGround.update(simSeconds);
    this.debugOverlay.update(frameSeconds);
    this.renderer.info.reset();
    this.composer.render(frameSeconds);
  }

  /** Quakes and the big bomb judder the camera (see Effects.shake); the rig puts it back each frame. */
  private shakeCamera(): void {
    const s = this.effects.shake;
    if (s <= 0) return;
    const k = s * s * 0.35;
    this.rig.camera.position.x += (Math.random() - 0.5) * k;
    this.rig.camera.position.y += (Math.random() - 0.5) * k;
    this.rig.camera.position.z += (Math.random() - 0.5) * k;
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
