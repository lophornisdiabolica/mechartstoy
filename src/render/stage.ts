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
import { Markers } from './markers';
import { setFactionPalette } from './models';
import './models/buildings';
import './models/projectiles';
import './models/units';
import { buildProps } from './propsMesh';
import { buildTerrain } from './terrainMesh';
import { TiltShift } from './tiltShift';

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
  /** Entity highlighted by the UI. */
  selected: Entity | null = null;
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

    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4436, 1.3));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.set(-60, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
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

    // Fit the sun's shadow camera to the map.
    const half = Math.max(field.width, field.depth) * 0.6;
    const sc = this.sun.shadow.camera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.updateProjectionMatrix();
    this.rig.setBounds(field.bounds);
  }

  /** `simSeconds` is frame time scaled by sim speed, so animations pause with the game. */
  render(alpha: number, frameSeconds: number, simSeconds: number): void {
    if (!this.battle) return;
    this.rig.update(frameSeconds);
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
