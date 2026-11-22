import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
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
import { Director, UnitCam } from './director';
import { OutpostRings } from './outpostRings';
import { Markers } from './markers';
import { CommanderOverlay } from './commanderOverlay';
import { FrontLines } from './frontLines';
import { FireGround } from './fireGround';
import { FrostGround } from './frostGround';
import { WreckageGround } from './wreckageGround';
import { SmokeClouds } from './smokeClouds';
import { Domes } from './domes';
import { JamMarks } from './jamMarks';
import { DEBUG_LAYERS, DebugLayer, DebugOverlay } from './debugOverlay';
import { setFactionPalette } from './models';
import './models/buildings';
import './models/projectiles';
import './models/units';
import { buildProps } from './propsMesh';
import { RoadTops } from './roadTops';
import { buildTerrain } from './terrainMesh';
import { buildWoods } from './woodsMesh';
import { GodCursor } from './godCursor';
import { GodEffects } from './godEffects';
import './models/god';
import { BIOMES } from '../world/biomes';
import { setTownStyle } from './models/buildings';
import { TiltShift } from './tiltShift';
import { RenderProfile } from './renderProfile';


const DEBUG_IDS = DEBUG_LAYERS.map((l) => l.id);

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _up2 = new THREE.Vector3();
const _snap = new THREE.Vector3();
const _vp = new THREE.Matrix4();

/**
 * Shadow detail. Shadows are drawn only around what the camera can see;
 * `low` uses a coarser shadow map, `off` skips the shadow pass, which
 * otherwise draws every visible unit and building a second time.
 */
/** Who moves the camera (see Stage.cameraMode). */
export type CameraMode = 'free' | 'follow' | 'director' | 'unit';

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
  private frostGround!: FrostGround;
  /** Heaps of junk where wrecks fell apart (see WreckageGround). */
  wreckage!: WreckageGround;
  private smokeClouds!: SmokeClouds;
  private domes!: Domes;
  private jamMarks!: JamMarks;
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
  /** Picks and frames the fight most worth watching (see Director). */
  director!: Director;
  /** Rides behind one unit (see UnitCam). */
  unitCam!: UnitCam;
  /**
   * Who moves the camera: the player (free), the spectator camera that
   * glides to wherever the fighting is (follow), the director that picks
   * and frames fights like a broadcast (director), or the unit camera
   * riding behind one unit (unit). Panning by hand goes back to free.
   */
  private mode: CameraMode = 'free';
  /** Called when panning by hand stops the camera following anything. */
  onFollowStopped: (() => void) | null = null;
  private shadowQuality: ShadowQuality = 'high';
  /** Half the size of the whole map, the most shadow coverage ever needed. */
  private mapHalf = 100;
  private readonly raycaster = new THREE.Raycaster();
  private readonly frustum = new THREE.Frustum();
  /** Leave out models off screen (see EntityView.cull); off draws every model every frame, as before. */
  cullModels = true;
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.scale);
    this.renderer.shadowMap.enabled = true;
    // Counted over the whole frame (shadow and post passes too) and reset in render, for the stats readout.
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x9fb4c4);

    this.rig = new CameraRig(this.renderer.domElement, { minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
    this.rig.onManualPan = () => {
      if (this.mode === 'free') return;
      this.cameraMode = 'free';
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
    // The tilt-shift's last pass also does the output conversion OutputPass would (see TiltShift).
    for (const pass of this.tiltShift.passes) this.composer.addPass(pass);
    this.hookProfile();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /**
   * Where each frame's time goes (see RenderProfile), while the stats
   * readout or `npm run fps` is watching; null the rest of the time.
   */
  profile: RenderProfile | null = null;

  /** A profile for this renderer (with GPU timers when the browser has them). */
  newProfile(): RenderProfile {
    return new RenderProfile(this.renderer.getContext() as WebGL2RenderingContext);
  }

  /**
   * Time the shadow pass and the scene and post passes apart: wrap the
   * shadow map's render and each post pass so they lap the profile (and
   * switch the GPU timer) as they finish. Costs nothing with no profile.
   */
  private hookProfile(): void {
    const shadows = this.renderer.shadowMap;
    const drawShadows = shadows.render.bind(shadows);
    shadows.render = (...args: Parameters<typeof drawShadows>) => {
      const p = this.profile;
      if (!p) return drawShadows(...args);
      // The scene pass has worked out what to draw by now; the shadow map comes first.
      p.lap('draw: scene');
      p.gpu?.begin('shadows');
      const calls = this.renderer.info.render.calls;
      drawShadows(...args);
      p.shadowCalls += this.renderer.info.render.calls - calls;
      p.lap('draw: shadows');
      p.gpu?.begin('scene');
    };
    for (const pass of this.composer.passes) {
      const draw = pass.render.bind(pass);
      const scene = pass instanceof RenderPass;
      pass.render = (...args: Parameters<typeof draw>) => {
        const p = this.profile;
        if (p && !scene) p.gpu?.begin('post');
        draw(...args);
        if (p && scene) p.lap('draw: scene');
      };
    }
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
      this.outpostRings.dispose();
      this.frontLines.dispose();
      this.fireGround.dispose();
      this.frostGround.dispose();
      this.wreckage.dispose();
      this.smokeClouds.dispose();
      this.domes.dispose();
      this.jamMarks.dispose();
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
    const roadTops = terrain.userData.roadTops as RoadTops;
    this.entities = new EntityView(game.world, (x, z) => field.surfaceAt(x, z), (x, z) => field.deckAt(x, z), (x, z) => roadTops.at(x, z), game.events);
    this.effects = new Effects(game.events, field);
    this.godEffects = new GodEffects(game, this.effects);
    this.godCursor.attach(field);
    this.markers = new Markers(game, this.entities);
    this.outpostRings = new OutpostRings(game, terrain);
    this.outpostRings.root.visible = this.ringsShown;
    this.commanderOverlay = new CommanderOverlay(game);
    this.commanderOverlay.visible = this.plansShown;
    this.frontLines = new FrontLines(game);
    this.frontLines.visible = this.frontsShown;
    battle.add(this.frontLines.root);
    this.fireGround = new FireGround(game, this.ground as THREE.Mesh);
    battle.add(this.fireGround.root);
    this.frostGround = new FrostGround(game);
    battle.add(this.frostGround.root);
    this.wreckage = new WreckageGround(game);
    battle.add(this.wreckage.root);
    this.smokeClouds = new SmokeClouds(game);
    battle.add(this.smokeClouds.root);
    this.domes = new Domes(game);
    battle.add(this.domes.root);
    this.jamMarks = new JamMarks(game);
    battle.add(this.jamMarks.root);
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
    this.director = new Director(game);
    this.unitCam = new UnitCam(game);
    this.mapHalf = Math.max(field.width, field.depth) * 0.6;
    this.rig.setBounds(field.bounds);
  }

  get cameraMode(): CameraMode {
    return this.mode;
  }

  set cameraMode(mode: CameraMode) {
    if (mode === this.mode) return;
    const moving = mode === 'director' || mode === 'unit';
    if (!moving && (this.mode === 'director' || this.mode === 'unit')) this.rig.release();
    if (this.mode === 'unit' && this.unitCam) this.unitCam.stop();
    this.mode = mode;
    if (mode === 'unit' && this.unitCam) this.unitCam.follow(this.selected);
  }

  /** The spectator camera that glides to wherever the fighting is (the follow camera mode). */
  get followFights(): boolean {
    return this.mode === 'follow';
  }

  set followFights(on: boolean) {
    this.cameraMode = on ? 'follow' : 'free';
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
    const p = this.profile;
    this.fights.update(simSeconds);
    this.director.update(simSeconds);
    if (this.mode === 'follow' && this.fights.focus) this.rig.glideTo(this.fights.focus.x, this.fights.focus.z, frameSeconds);
    else if (this.mode === 'director') this.director.drive(this.rig, frameSeconds);
    else if (this.mode === 'unit' && !this.unitCam.drive(this.rig, frameSeconds, simSeconds, alpha, this.director)) this.director.drive(this.rig, frameSeconds);
    this.rig.update(frameSeconds);
    this.shakeCamera();
    this.fitShadow();
    p?.lap('cameras');
    this.entities.cull = this.cullView();
    this.entities.sync(alpha, simSeconds);
    p?.lap('units');
    this.effects.update(simSeconds);
    this.godEffects.update(simSeconds);
    p?.lap('effects');
    this.markers.update(frameSeconds, this.selected);
    this.outpostRings.update();
    this.commanderOverlay.update();
    this.frontLines.update(frameSeconds);
    this.debugOverlay.update(frameSeconds);
    p?.lap('overlays');
    this.fireGround.update(simSeconds);
    this.frostGround.update(simSeconds);
    this.smokeClouds.update(simSeconds);
    this.domes.update(simSeconds);
    this.jamMarks.update(simSeconds);
    p?.lap('fire, frost, smoke, domes');
    this.wreckage.update(simSeconds);
    p?.lap('wreckage');
    this.renderer.info.reset();
    p?.gpu?.begin('scene');
    this.composer.render(frameSeconds);
    if (p) {
      p.lap('draw: post');
      p.gpu?.endFrame();
      p.calls += this.renderer.info.render.calls;
      p.triangles += this.renderer.info.render.triangles;
      p.modelsDrawn += this.entities.drawnCount;
      p.models += this.entities.count;
    }
  }

  /** What the camera sees now, for EntityView to leave out models off screen (see EntityView.cull). */
  private cullView(): EntityView['cull'] {
    if (!this.cullModels) return null;
    const cam = this.rig.camera;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(_vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    // A low sun (photo mode's dawn and dusk) throws long shadows: the reach grows to match.
    const o = this.sunOffset;
    const shadow = this.shadowQuality === 'off' ? 0 : Math.min(25, Math.hypot(o.x, o.z) / Math.max(0.01, o.y));
    return { frustum: this.frustum, shadow };
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

  /**
   * How many pixels the battle is drawn with, as a share of the screen's own
   * (up to 2 per CSS pixel on high-DPI screens): 1 is full sharpness, 0.5
   * draws a quarter of the pixels, then scales up. The GPU's work in the
   * shadowless parts of the frame (the ground, the post chain, multisampling)
   * goes with the number of pixels.
   */
  get renderScale(): number {
    return this.scale;
  }

  set renderScale(scale: number) {
    if (scale === this.scale) return;
    this.scale = scale;
    this.resize();
  }

  private scale = 1;

  /** Draw with 4x multisampling (smooth edges); off for the cost check. */
  get multisample(): boolean {
    return this.composer.renderTarget1.samples > 0;
  }

  set multisample(on: boolean) {
    const samples = on ? 4 : 0;
    for (const target of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (target.samples === samples) continue;
      target.samples = samples;
      // Made again at the new sample count when next drawn to.
      target.dispose();
    }
  }

  /** One of the battle's layers by name (terrain, woods, props, wreckage, batches, effects...), for the cost check. */
  layer(name: string): THREE.Object3D | undefined {
    return this.battle?.getObjectByName(name);
  }

  /** The size the battle is drawn at, in pixels, as WIDTHxHEIGHT. */
  pixels(): string {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return `${size.x}x${size.y}`;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.scale);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.tiltShift.setSize(w * pr, h * pr);
    this.rig.setSize(w, h);
  }
}
