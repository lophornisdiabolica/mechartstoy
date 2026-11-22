import * as THREE from 'three';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Entity, World } from '../core/ecs';
import { EventBus } from '../core/events';
import { Armed, Arsenal, Building, Faction, makeTransform, Renderable, Tilt, Transform, Unit, Veiled, Wreck } from '../game/components';
import type { GameEvents } from '../game/context';
import { BUILDING_DEFS, BuildingDef } from '../game/buildings';
import { DOCTRINE_IDS, DOCTRINES, DoctrineId, doctrineUnits } from '../game/doctrines';
import { FACTIONS } from '../game/factions';
import { UNIT_DEFS, UnitDef, UnitId } from '../game/units';
import { MOVE_RULES, MoveClass } from '../world/moveClasses';
import { CameraRig } from '../render/cameraRig';
import { EntityView } from '../render/entityView';
import { setFactionPalette } from '../render/models';
import '../render/models/buildings';
import '../render/models/projectiles';
import '../render/models/units';
import { el } from './dom';

/**
 * The model viewer (`?models`): every unit of a doctrine (or every
 * building) standing on a slope, drawn by the real entity view, so what it
 * shows is what a battle shows: hulls lie along the slope as the tilt
 * system lays them, turrets and barrels turn to an aim, walkers walk,
 * melee units strike, and wrecks break the way they do in battle.
 *
 * It's for checking a model after changing it, without waiting for one
 * to turn up in a battle: floating parts, a gun that doesn't sit on its
 * turret, a slope tilt the wrong way round. Everything is in the link, so
 * `npm run shot -- --models "doctrine=aegis&slope=20"` takes the same
 * picture again (see scripts/shot.mjs).
 *
 * Link options: `doctrine` (a doctrine id, `all` or `buildings`), `unit`
 * (just that one), `slope` (degrees), `aim` and `elev` (degrees, aim
 * relative to the hull), `spin` (turntable, 0 or 1), `walk`, `wreck`,
 * `ghost` (stealth fade), `pose` (which of the wreck poses), `labels`.
 */

/** What the viewer shows, all of it in the link. */
export interface ViewerOptions {
  doctrine: DoctrineId | 'all' | 'buildings';
  unit: string | null;
  slope: number;
  aim: number;
  elev: number;
  spin: boolean;
  walk: boolean;
  wreck: boolean;
  ghost: boolean;
  pose: number;
  labels: boolean;
}

export function viewerOptions(params: URLSearchParams): ViewerOptions {
  const num = (k: string, d: number) => {
    const v = Number(params.get(k));
    return params.has(k) && Number.isFinite(v) ? v : d;
  };
  const flag = (k: string, d: boolean) => (params.has(k) ? params.get(k) !== '0' : d);
  const d = params.get('doctrine');
  return {
    doctrine: d === 'all' || d === 'buildings' || (d !== null && (DOCTRINE_IDS as string[]).includes(d)) ? (d as ViewerOptions['doctrine']) : 'armour',
    unit: params.get('unit'),
    slope: num('slope', 12),
    aim: num('aim', 0),
    elev: num('elev', 0),
    spin: flag('spin', false),
    walk: flag('walk', false),
    wreck: flag('wreck', false),
    ghost: flag('ghost', false),
    pose: Math.max(0, Math.round(num('pose', 0))),
    labels: flag('labels', true),
  };
}

function viewerParams(o: ViewerOptions): URLSearchParams {
  const p = new URLSearchParams();
  p.set('models', '');
  p.set('doctrine', o.doctrine);
  if (o.unit) p.set('unit', o.unit);
  p.set('slope', String(o.slope));
  if (o.aim) p.set('aim', String(o.aim));
  if (o.elev) p.set('elev', String(o.elev));
  for (const k of ['spin', 'walk', 'wreck', 'ghost'] as const) if (o[k]) p.set(k, '1');
  if (o.pose) p.set('pose', String(o.pose));
  if (!o.labels) p.set('labels', '0');
  return p;
}

/** What one doctrine's list holds: its units, or the buildings. */
export function viewerList(doctrine: ViewerOptions['doctrine']): ({ kind: 'unit'; def: UnitDef } | { kind: 'building'; def: BuildingDef })[] {
  if (doctrine === 'buildings') return Object.values(BUILDING_DEFS as Record<string, BuildingDef>).map((def) => ({ kind: 'building' as const, def }));
  const ids: UnitId[] = doctrine === 'all' ? (Object.keys(UNIT_DEFS) as UnitId[]) : doctrineUnits(DOCTRINES[doctrine]);
  return ids.map((id) => ({ kind: 'unit' as const, def: UNIT_DEFS[id] as UnitDef }));
}

/** Movement classes whose hulls lie along the ground (as in spawn.ts). */
const TILTS = new Set<MoveClass>(['tracked', 'hover', 'amphibious']);
/** Ground between models, world units, on top of their size. */
const GAP = 3.5;
/** Turntable speed, radians a second. */
const SPIN_SPEED = 0.5;
/** Radius of the circle walkers walk round, world units. */
const WALK_RADIUS = 2.2;
const DEG = Math.PI / 180;

interface Slot {
  entity: Entity;
  kind: 'unit' | 'building';
  def: UnitDef | BuildingDef;
  x: number;
  z: number;
  /** Turntable heading, and how far round its walking circle it is. */
  heading: number;
  walked: number;
  label: CSS2DObject;
}

export class ModelViewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly labels = new CSS2DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private world = new World();
  private readonly events = new EventBus<GameEvents>();
  private view!: EntityView;
  private readonly ground: THREE.Mesh;
  private readonly sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  private slots: Slot[] = [];
  private readonly panel = el('div', { id: 'panel', class: 'viewer' });
  private readonly raycaster = new THREE.Raycaster();
  private last = performance.now();
  /** Ready for a screenshot: the models are built and have fallen into their poses. */
  ready = false;
  private settle = 0;

  constructor(
    private readonly container: HTMLElement,
    private opts: ViewerOptions,
  ) {
    document.title = 'Model viewer · Mech Battle Toy';
    setFactionPalette(FACTIONS);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.append(this.renderer.domElement);
    this.labels.domElement.className = 'viewer-labels';
    container.append(this.labels.domElement);
    this.scene.background = new THREE.Color(0x9fb4c4);
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0x4a4436, 1.3));
    this.sun.position.set(-60, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -90;
    sc.right = sc.top = 90;
    sc.far = 300;
    this.scene.add(this.sun, this.sun.target);

    // A big plane, tipped up toward +x by the slope; a grid on it shows the slope's lie.
    const plane = new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(plane, new THREE.MeshLambertMaterial({ color: 0x7d8a5e }));
    this.ground.receiveShadow = true;
    const grid = new THREE.GridHelper(400, 200, 0x5d6a44, 0x6d7a50);
    (grid.material as THREE.Material).opacity = 0.5;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.01;
    this.ground.add(grid);
    this.scene.add(this.ground);

    this.rig = new CameraRig(this.renderer.domElement, { minX: -150, maxX: 150, minZ: -150, maxZ: 150 });
    this.rig.freeRotation = true;
    this.rig.minZoom = 0.25;
    this.rig.maxZoom = 8;

    document.body.append(this.panel);
    this.buildPanel();
    this.renderer.domElement.addEventListener('click', (e) => this.pick(e));
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.populate();
    requestAnimationFrame(() => this.frame());
  }

  /** Ground height on the slope: it rises toward +x. */
  heightAt(x: number, _z: number): number {
    return x * Math.tan(this.opts.slope * DEG);
  }

  private set(change: Partial<ViewerOptions>, rebuild = false): void {
    // A wreck can't be mended: build them all again.
    if (change.wreck === false && this.opts.wreck) rebuild = true;
    this.opts = { ...this.opts, ...change };
    history.replaceState(null, '', `?${viewerParams(this.opts).toString().replace('models=&', 'models&')}`);
    if (rebuild) this.populate();
    else this.pose();
    this.buildPanel();
  }

  /** Put the models out in rows, in the order of the list (smallest gaps for small ones). */
  private populate(): void {
    for (const s of this.slots) s.label.removeFromParent();
    this.slots = [];
    // A fresh world each time, so entity ids (which pick the wreck poses) start over and a link always shows the same poses.
    if (this.view) {
      this.scene.remove(this.view.root, this.view.drawn);
      this.view.dispose();
    }
    this.world = new World();
    this.view = new EntityView(this.world, (x, z) => this.heightAt(x, z), undefined, undefined, this.events);
    this.scene.add(this.view.root, this.view.drawn);
    this.ground.rotation.z = this.opts.slope * DEG;
    let list = viewerList(this.opts.doctrine);
    if (this.opts.unit) list = list.filter((m) => m.def.id === this.opts.unit);
    // Biggest first, so each row holds models of about one size.
    list = [...list].sort((a, b) => b.def.radius - a.def.radius);
    const faction = this.opts.doctrine === 'all' || this.opts.doctrine === 'buildings' ? 0 : DOCTRINE_IDS.indexOf(this.opts.doctrine);
    const across = Math.max(1, Math.ceil(Math.sqrt(list.length * 1.6)));
    const size = (def: UnitDef | BuildingDef) => def.radius * 2 + GAP;
    // Rows along z, columns up the slope (x), each as wide as its widest model.
    const rows: (typeof list)[] = [];
    list.forEach((m, i) => (rows[Math.floor(i / across)] ??= []).push(m));
    const rowDepth = rows.map((r) => Math.max(...r.map((m) => size(m.def))));
    let z = -rowDepth.reduce((a, b) => a + b, 0) / 2;
    // Burn through entity ids so a pose number gives another set of wreck poses (they're picked from the id).
    if (this.opts.pose > 0) this.world.adopt(this.opts.pose * 997);
    rows.forEach((row, j) => {
      z += rowDepth[j] / 2;
      const width = row.reduce((a, m) => a + size(m.def), 0);
      let x = -width / 2;
      for (const m of row) {
        x += size(m.def) / 2;
        this.slots.push(this.place(m.kind, m.def, faction, x, z));
        x += size(m.def) / 2;
      }
      z += rowDepth[j] / 2;
    });
    if (this.slots.length > 0) {
      const span = Math.max(width(this.slots, 'x'), width(this.slots, 'z'));
      this.rig.jumpTo(0, 0, Math.max(this.rig.minZoom, Math.min(5, 48 / Math.max(6, span))));
    }
    this.ready = false;
    this.settle = 0;
    this.pose();
  }

  private place(kind: 'unit' | 'building', def: UnitDef | BuildingDef, faction: number, x: number, z: number): Slot {
    const w = this.world;
    const e = w.create();
    w.add(e, Transform, makeTransform(x, 0, z, 0));
    w.add(e, Faction, { id: faction });
    w.add(e, Renderable, { model: def.model, scale: 1 });
    const stub = { aim: 0, elev: 0 } as Armed;
    if (kind === 'unit') {
      const u = def as UnitDef;
      w.add(e, Unit, { def: u });
      if (TILTS.has(u.move)) w.add(e, Tilt, { pitch: 0, roll: 0, ppitch: 0, proll: 0, sx: NaN, sz: NaN, sheading: NaN, wantPitch: 0, wantRoll: 0, lift: 0 });
      w.add(e, Armed, stub);
      if (u.mounts?.length) w.add(e, Arsenal, { arms: u.mounts.map(() => ({ aim: 0, elev: 0 }) as Armed) });
      if (u.stealth) w.add(e, Veiled, { hidden: false });
    } else {
      const b = def as BuildingDef;
      w.add(e, Building, { def: b });
      if (b.weapon) w.add(e, Armed, stub);
      if (b.mounts?.length) w.add(e, Arsenal, { arms: b.mounts.map(() => ({ aim: 0, elev: 0 }) as Armed) });
    }
    const tag = el('div', { class: 'viewer-label' }, def.name);
    const label = new CSS2DObject(tag);
    this.scene.add(label);
    return { entity: e, kind, def, x, z, heading: 0, walked: 0, label };
  }

  /** Apply the aim, elevation, slope, wreck and ghost options to every model. */
  private pose(): void {
    const w = this.world;
    for (const s of this.slots) {
      if (this.opts.wreck && !w.has(s.entity, Wreck) && s.kind === 'unit' && (s.def as UnitDef).wreckTime > 0) w.add(s.entity, Wreck, { removeAt: Infinity });
      const v = w.get(s.entity, Veiled);
      if (v) v.hidden = this.opts.ghost;
    }
  }

  /** Move the turntables and walkers, and keep everything on the slope. */
  private step(dt: number): void {
    const w = this.world;
    const tan = Math.tan(this.opts.slope * DEG);
    for (const s of this.slots) {
      const t = w.get(s.entity, Transform);
      if (!t) continue;
      t.px = t.x;
      t.py = t.y;
      t.pz = t.z;
      t.pheading = t.heading;
      const unit = s.kind === 'unit' ? (s.def as UnitDef) : null;
      const wrecked = w.has(s.entity, Wreck);
      if (!wrecked) {
        if (this.opts.walk && unit) {
          // Round a little circle at a gentle walk, facing along it.
          s.walked += (dt * Math.min(unit.speed, 3) * 0.6) / WALK_RADIUS;
          t.x = s.x + Math.cos(s.walked) * WALK_RADIUS;
          t.z = s.z - Math.sin(s.walked) * WALK_RADIUS;
          t.heading = s.walked + Math.PI / 2;
        } else {
          if (this.opts.spin) s.heading += dt * SPIN_SPEED;
          t.x = s.x;
          t.z = s.z;
          t.heading = s.heading;
        }
      }
      // A wrecked aircraft lies where it came down.
      const altitude = unit && !wrecked ? MOVE_RULES[unit.move].altitude : 0;
      t.y = t.x * tan + altitude;
      // As the tilt system lays a hull: the rise along its nose and along its left side.
      const tilt = w.get(s.entity, Tilt);
      if (tilt && !wrecked) {
        tilt.ppitch = tilt.pitch;
        tilt.proll = tilt.roll;
        tilt.pitch = Math.atan(tan * Math.cos(t.heading));
        tilt.roll = -Math.atan(tan * Math.sin(t.heading));
      }
      const aim = t.heading + this.opts.aim * DEG;
      const elev = this.opts.elev * DEG;
      const armed = w.get(s.entity, Armed);
      if (armed) {
        armed.aim = aim;
        armed.elev = elev;
      }
      for (const a of w.get(s.entity, Arsenal)?.arms ?? []) {
        a.aim = aim;
        a.elev = elev;
      }
      s.label.position.set(t.x, t.y + (unit ? Math.max(1.2, s.def.radius * 2.2) : (s.def as BuildingDef).height + 1), t.z);
      s.label.visible = this.opts.labels;
    }
  }

  /** Zoom the view, keeping what it looks at (for screenshots). */
  zoom(z: number): void {
    this.rig.jumpTo(this.rig.target.x, this.rig.target.z, z);
  }

  /** Every melee unit strikes once. */
  strike(): void {
    for (const s of this.slots) {
      if (s.kind !== 'unit' || this.world.has(s.entity, Wreck)) continue;
      const def = s.def as UnitDef;
      const melee = def.weapon.melee ?? def.mounts?.find((m) => m.weapon.melee)?.weapon.melee;
      if (!melee) continue;
      const t = this.world.req(s.entity, Transform);
      this.events.emit('struck', { entity: s.entity, x: t.x, y: t.y, z: t.z, heading: t.heading, style: melee.style, kind: def.weapon.projectile, lunge: 0, hits: 1 });
    }
  }

  private pick(e: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.rig.camera);
    const hit = this.raycaster.intersectObject(this.view.root, true).map((h) => this.view.entityForObject(h.object)).find((x) => x !== null);
    const slot = this.slots.find((s) => s.entity === hit);
    if (slot) this.rig.jumpTo(slot.x, slot.z, Math.min(this.rig.maxZoom, 9 / Math.max(0.6, slot.def.radius)));
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.view.sync(1, dt);
    this.rig.update(dt);
    // Keep the shadow on what's in view.
    this.sun.target.position.copy(this.rig.target);
    this.sun.position.copy(this.rig.target).add(new THREE.Vector3(-60, 90, 40));
    this.renderer.render(this.scene, this.rig.camera);
    this.labels.render(this.scene, this.rig.camera);
    this.settle += dt;
    if (this.settle > 1.5) this.ready = true;
    requestAnimationFrame(() => this.frame());
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.rig.setSize(w, h);
  }

  private buildPanel(): void {
    const o = this.opts;
    const body = el('div', { class: 'body' });
    const row = (label: string, ...nodes: Node[]) => {
      const r = el('label', { class: 'row' });
      r.append(el('span', {}, label), ...nodes);
      body.append(r);
    };
    const select = el('select', { 'aria-label': 'Doctrine' });
    for (const [value, label] of [...DOCTRINE_IDS.map((d) => [d, DOCTRINES[d].name] as const), ['all', 'Every unit'] as const, ['buildings', 'Buildings'] as const]) {
      const opt = el('option', { value }, label);
      if (value === o.doctrine) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => this.set({ doctrine: select.value as ViewerOptions['doctrine'], unit: null }, true));
    row('Show', select);
    const units = el('select', { 'aria-label': 'Unit' });
    units.append(el('option', { value: '' }, 'All of them'));
    for (const m of viewerList(o.doctrine)) {
      const opt = el('option', { value: m.def.id }, m.def.name);
      if (m.def.id === o.unit) opt.selected = true;
      units.append(opt);
    }
    units.addEventListener('change', () => this.set({ unit: units.value || null }, true));
    row('Model', units);
    const slider = (label: string, key: 'slope' | 'aim' | 'elev', min: number, max: number, rebuild: boolean) => {
      const input = el('input', { type: 'range', min: String(min), max: String(max), step: '1', value: String(o[key]) });
      const out = el('span', { class: 'value' }, `${o[key]}°`);
      input.addEventListener('input', () => {
        out.textContent = `${input.value}°`;
        this.opts = { ...this.opts, [key]: Number(input.value) };
        if (key === 'slope') this.ground.rotation.z = this.opts.slope * DEG;
      });
      input.addEventListener('change', () => this.set({ [key]: Number(input.value) }, rebuild));
      row(label, input, out);
    };
    slider('Slope', 'slope', 0, 35, false);
    slider('Aim', 'aim', -180, 180, false);
    slider('Gun elevation', 'elev', -15, 60, false);
    const toggles = el('div', { class: 'seg' });
    const toggle = (label: string, key: 'spin' | 'walk' | 'wreck' | 'ghost' | 'labels', title: string) => {
      const b = el('button', { type: 'button', title }, label);
      b.classList.toggle('on', o[key]);
      b.addEventListener('click', () => this.set({ [key]: !this.opts[key] }));
      toggles.append(b);
    };
    toggle('Turn', 'spin', 'Turn every model slowly round, so the slope is under it from every side');
    toggle('Walk', 'walk', 'Walk every model round a little circle');
    toggle('Wreck', 'wreck', 'Break every model the way it breaks when destroyed in battle');
    toggle('Ghost', 'ghost', 'Fade stealthy units out, as Veil units do when they hide');
    toggle('Labels', 'labels', 'Names over the models');
    body.append(toggles);
    const actions = el('div', { class: 'seg' });
    const strike = el('button', { type: 'button', title: 'Every melee unit strikes once' }, 'Strike');
    strike.addEventListener('click', () => this.strike());
    const pose = el('button', { type: 'button', title: 'Another set of wreck poses' }, `Wreck pose ${o.pose + 1}`);
    pose.addEventListener('click', () => this.set({ pose: this.opts.pose + 1, wreck: true }, true));
    const back = el('a', { href: './', title: 'Back to the battle' }, 'Battle');
    actions.append(strike, pose, back);
    body.append(actions);
    body.append(el('p', { class: 'hint' }, 'Left-drag orbits, right-drag pans, wheel zooms. Click a model to look closer.'));
    const header = el('header', {}, 'Model viewer');
    this.panel.replaceChildren(header, body);
  }
}

function width(slots: Slot[], axis: 'x' | 'z'): number {
  const v = slots.map((s) => s[axis]);
  return Math.max(...v) - Math.min(...v);
}
