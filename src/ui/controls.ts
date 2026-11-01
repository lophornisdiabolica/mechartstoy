import { Entity } from '../core/ecs';
import { FixedLoop } from '../core/loop';
import { Armed, Building, Construction, Faction, Health, NEUTRAL, Producer, Rubble, Unit, Wreck } from '../game/components';
import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { Stance } from '../game/orders';
import { LIMITS, RampSettings, UNIT_IDS } from '../game/settings';
import { RAMP_INTERVAL } from '../game/tide';
import { UnitId } from '../game/units';
import { ShadowQuality, Stage } from '../render/stage';
import { dropdown, el, hex, segmented } from './dom';
import { saveViewPrefs } from './viewPrefs';

type Tool = { kind: 'spawn'; unit: UnitId } | { kind: 'rally' } | null;

const SPEEDS = [0, 1, 2, 4];
/** A press that moves less than this (px) and is shorter than CLICK_MS counts as a click, not a pan. */
const CLICK_SLOP = 6;
const CLICK_MS = 400;

/** What the battle section of the panel asks the app to do. */
export interface MatchControls {
  /** End this battle now and go to the setup screen. */
  endBattle(): void;
  /** Whether to go to setup (instead of straight into a new map) when this battle is won. */
  setupAfterBattle: boolean;
  /** The panel changed a battle setting (so the page link can follow). */
  settingsChanged(): void;
}

/**
 * The in-battle control panel and map clicks. Talks to the sim only through
 * Game's command methods, and to the view through Stage. One per battle;
 * dispose() removes it.
 */
export class Controls {
  private playerFaction: number | null = null;
  private tool: Tool = null;
  private selected: Entity | null = null;
  private lastSpeed = 1;
  private readonly panel = el('div', { id: 'panel' });
  private readonly toast = el('div', { id: 'toast' });
  private readonly inspect = el('div', { class: 'inspect' });
  private readonly intensity = el('p', { class: 'hint' });
  private readonly sync: (() => void)[] = [];
  private inspectTimer = 0;
  /** Removes every listener this panel added outside itself. */
  private readonly listeners = new AbortController();

  constructor(
    private readonly game: Game,
    private readonly stage: Stage,
    private readonly loop: FixedLoop,
    private readonly factions: readonly FactionDef[],
    private readonly match: MatchControls,
    collapsed: boolean,
  ) {
    this.build();
    document.body.append(this.panel, this.toast);
    if (collapsed) this.panel.querySelector<HTMLButtonElement>('.collapse')?.click();
    this.bindCanvas(stage.renderer.domElement);
    this.bindKeys();
    this.refresh();
  }

  get collapsed(): boolean {
    return this.panel.classList.contains('collapsed');
  }

  dispose(): void {
    this.listeners.abort();
    this.panel.remove();
    this.toast.remove();
    this.stage.onFollowStopped = null;
    this.stage.renderer.domElement.style.cursor = '';
  }


  /** Called every frame. */
  update(frameSeconds: number): void {
    // Drop the selection when the thing is gone (destroyed, or a wreck sank).
    if (this.selected !== null && !this.game.world.isAlive(this.selected)) this.select(null);
    this.inspectTimer -= frameSeconds;
    if (this.inspectTimer <= 0) {
      this.inspectTimer = 0.2;
      this.renderInspect();
      const { tide, siege } = this.game.ctx.escalation;
      this.intensity.textContent = `Now: tide ${(1 + tide).toFixed(2)}×, siege ${(1 + siege).toFixed(2)}×`;
    }
  }

  private build(): void {
    const header = el('header');
    header.append(el('span', {}, 'Battle controls'));
    const collapse = el('button', { type: 'button', class: 'collapse', title: 'Collapse panel', 'aria-label': 'Collapse panel' }, '–');
    collapse.addEventListener('click', () => {
      const collapsed = this.panel.classList.toggle('collapsed');
      collapse.textContent = collapsed ? '+' : '–';
    });
    header.append(collapse);
    const body = el('div', { class: 'body' });
    this.panel.append(header, body);

    const section = (title: string, cls = '') => {
      const s = el('section', cls ? { class: cls } : {});
      s.append(el('h3', {}, title));
      body.append(s);
      return s;
    };

    // Battle
    const conquest = this.game.settings.mode === 'conquest';
    const battle = section('Battle');
    battle.append(
      el(
        'p',
        { class: 'hint' },
        conquest ? 'Conquest: destroy the enemy HQ and every production building to win.' : 'Eternal: ruins are rebuilt and the war never ends.',
      ),
    );
    // Ramps: live, so an Eternal war can be wound up or calmed down while watching.
    const mode = this.game.settings.mode;
    const ramp = this.game.settings.armies.ramp[mode];
    battle.append(el('p', { class: 'hint' }, `Ramp, every ${RAMP_INTERVAL / 60} minutes:`));
    const rampSlider = (label: string, key: keyof RampSettings, title: string) => {
      const wrap = el('label', { class: 'slider valued', title });
      const input = el('input', { type: 'range', min: String(LIMITS.ramp.min), max: String(LIMITS.ramp.max), step: '0.05' });
      const value = el('span', { class: 'value' });
      input.addEventListener('input', () => {
        ramp[key] = Number(input.value);
        this.match.settingsChanged();
        this.refresh();
      });
      wrap.append(el('span', {}, label), input, value);
      battle.append(wrap);
      this.sync.push(() => {
        input.value = String(ramp[key]);
        value.textContent = ramp[key] === 0 ? 'Off' : `+${Math.round(ramp[key] * 100)}%`;
      });
    };
    rampSlider('Tide', 'tide', `How much harder production surges swing every ${RAMP_INTERVAL / 60} minutes`);
    rampSlider('Siege', 'siege', `How much harder hits on buildings land every ${RAMP_INTERVAL / 60} minutes`);
    battle.append(this.intensity);

    const endRow = el('div', { class: 'row' });
    const end = el('button', { type: 'button', title: 'End this battle now and change the settings' }, 'End battle and set up');
    end.addEventListener('click', () => this.match.endBattle());
    endRow.append(end);
    battle.append(endRow);
    if (conquest) {
      const queueLabel = el('label', { class: 'check' });
      const queue = el('input', { type: 'checkbox' });
      queue.addEventListener('change', () => {
        this.match.setupAfterBattle = queue.checked;
        this.refresh();
      });
      queueLabel.append(queue, document.createTextNode(' Set up after this battle'));
      queueLabel.title = 'When this battle is won, go to the setup screen instead of straight into a new map';
      battle.append(queueLabel);
      this.sync.push(() => (queue.checked = this.match.setupAfterBattle));
    }

    // Speed
    const speed = segmented(
      SPEEDS.map((v) => ({ label: v === 0 ? '❚❚' : `${v}×`, value: v, title: v === 0 ? 'Pause (space)' : `${v}× speed` })),
      (v) => this.setSpeed(v),
    );
    section('Speed').append(speed.row);
    this.sync.push(() => speed.set(this.loop.timeScale));

    // Side
    // Buttons for a few sides (short names fit; the full name is in the tooltip), a list for more.
    const side =
      this.factions.length <= 3
        ? segmented<number | null>(
            [
              { label: 'Watch', value: null, title: 'Just watch' },
              ...this.factions.map((f) => ({ label: f.name.split(' ')[0], value: f.id as number | null, title: `Play as ${f.name}` })),
            ],
            (v) => this.setSide(v),
          )
        : dropdown<number | null>(
            [{ label: 'Just watch', value: null }, ...this.factions.map((f) => ({ label: f.name, value: f.id as number | null }))],
            (v) => this.setSide(v),
            'Your side',
          );
    section('Your side').append(side.row);
    this.sync.push(() => side.set(this.playerFaction));

    // Spawn palette
    const spawn = section('Drop units', 'needs-side');
    const grid = el('div', { class: 'grid' });
    const units = this.game.ctx.units;
    const spawnButtons = UNIT_IDS.map((id) => {
      const b = el('button', { type: 'button', title: `Drop a ${units[id].name}` }, units[id].name);
      b.addEventListener('click', () => this.setTool(this.tool?.kind === 'spawn' && this.tool.unit === id ? null : { kind: 'spawn', unit: id }));
      grid.append(b);
      return { b, id };
    });
    spawn.append(grid, el('p', { class: 'hint' }, 'Pick a unit, then click the map. Esc to stop.'));
    this.sync.push(() => {
      for (const { b, id } of spawnButtons) b.classList.toggle('on', this.tool?.kind === 'spawn' && this.tool.unit === id);
    });

    // Orders
    const orders = section('Orders', 'needs-side');
    const stance = segmented<Stance>(
      [
        { label: 'Auto', value: 'auto', title: 'Attack and regroup with the ebb and flow of battle' },
        { label: 'Attack', value: 'attack', title: 'Everyone push into the enemy base' },
        { label: 'Hold', value: 'hold', title: 'Everyone gather at the rally point' },
      ],
      (v) => {
        if (this.playerFaction !== null) this.game.setStance(this.playerFaction, v);
        this.refresh();
      },
    );
    const rallyRow = el('div', { class: 'row' });
    const setRally = el('button', { type: 'button', title: 'Click the map to place the rally flag' }, 'Set rally point');
    setRally.addEventListener('click', () => this.setTool(this.tool?.kind === 'rally' ? null : { kind: 'rally' }));
    const clearRally = el('button', { type: 'button' }, 'Clear');
    clearRally.addEventListener('click', () => {
      if (this.playerFaction !== null) this.game.setRally(this.playerFaction, null);
      this.refresh();
    });
    rallyRow.append(setRally, clearRally);
    orders.append(stance.row, rallyRow);
    this.sync.push(() => {
      const o = this.playerFaction !== null ? this.game.ctx.orders[this.playerFaction] : null;
      stance.set(o?.stance ?? 'auto');
      setRally.classList.toggle('on', this.tool?.kind === 'rally');
      clearRally.disabled = !o?.rally;
    });

    // Camera
    const cam = section('Camera');
    const followLabel = el('label', { class: 'check', title: 'Glide to wherever the fighting is. Panning the camera yourself turns this off.' });
    const follow = el('input', { type: 'checkbox' });
    follow.addEventListener('change', () => this.setFollow(follow.checked));
    followLabel.append(follow, document.createTextNode(' Follow the fighting (F)'));
    cam.append(followLabel);
    this.sync.push(() => (follow.checked = this.stage.followFights));
    this.stage.onFollowStopped = () => {
      this.refresh();
      this.showToast('Stopped following. F to follow again');
    };
    const shadows = segmented<ShadowQuality>(
      [
        { label: 'High', value: 'high', title: 'Sharp shadows' },
        { label: 'Low', value: 'low', title: 'Softer, cheaper shadows' },
        { label: 'Off', value: 'off', title: 'No shadows: fastest with big armies' },
      ],
      (q) => {
        this.stage.shadows = q;
        this.saveView();
        this.refresh();
      },
    );
    const shadowRow = el('div', { class: 'labelled' });
    shadowRow.append(el('span', {}, 'Shadows'), shadows.row);
    cam.append(shadowRow);
    this.sync.push(() => shadows.set(this.stage.shadows));
    const ts = this.stage.tiltShift;
    const toggleLabel = el('label', { class: 'check' });
    const toggle = el('input', { type: 'checkbox' });
    toggle.addEventListener('change', () => {
      ts.settings.enabled = toggle.checked;
      ts.apply();
    });
    toggleLabel.append(toggle, document.createTextNode(' Tilt-shift (T)'));
    cam.append(toggleLabel);
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) => {
      const wrap = el('label', { class: 'slider' });
      const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
      input.addEventListener('input', () => {
        set(Number(input.value));
        ts.apply();
      });
      wrap.append(el('span', {}, label), input);
      cam.append(wrap);
      this.sync.push(() => (input.value = String(get())));
    };
    slider('Blur', 0, 14, 0.5, () => ts.settings.maxBlur, (v) => (ts.settings.maxBlur = v));
    slider('Focus', 0.2, 0.8, 0.01, () => ts.settings.focus, (v) => (ts.settings.focus = v));
    slider('Colour', 0.6, 1.8, 0.05, () => ts.settings.saturation, (v) => (ts.settings.saturation = v));
    this.sync.push(() => (toggle.checked = ts.settings.enabled));

    body.append(this.inspect);
  }

  /** Re-sync every control with current state. */
  private refresh(): void {
    this.panel.classList.toggle('has-side', this.playerFaction !== null);
    for (const s of this.sync) s();
    this.stage.renderer.domElement.style.cursor = this.tool ? 'crosshair' : '';
  }

  private setFollow(on: boolean): void {
    this.stage.followFights = on;
    this.saveView();
    this.refresh();
    if (on && !this.stage.fights.focus) this.showToast('Following: waiting for a fight');
  }

  private saveView(): void {
    saveViewPrefs({ shadows: this.stage.shadows, follow: this.stage.followFights });
  }

  private setSpeed(v: number): void {
    if (v > 0) this.lastSpeed = v;
    this.loop.timeScale = v;
    this.refresh();
  }

  private setSide(f: number | null): void {
    // Hand the old side back to the AI.
    if (this.playerFaction !== null && this.playerFaction !== f) {
      this.game.setStance(this.playerFaction, 'auto');
      this.game.setRally(this.playerFaction, null);
    }
    this.playerFaction = f;
    if (f === null) this.tool = null;
    this.refresh();
  }

  private setTool(tool: Tool): void {
    this.tool = this.playerFaction === null ? null : tool;
    this.refresh();
  }

  private select(e: Entity | null): void {
    this.selected = e;
    this.stage.selected = e;
    this.renderInspect();
  }

  private click(x: number, y: number): void {
    const tool = this.tool;
    if (tool && this.playerFaction !== null) {
      const p = this.stage.pickGround(x, y);
      if (!p) return;
      if (tool.kind === 'spawn') {
        if (!this.game.spawnUnitAt(tool.unit, this.playerFaction, p.x, p.z)) this.showToast("Can't drop a unit there");
      } else {
        this.game.setRally(this.playerFaction, p);
        this.setTool(null);
      }
      return;
    }
    const e = this.stage.pickEntity(x, y);
    const w = this.game.world;
    const inspectable = e !== null && (w.has(e, Unit) || w.has(e, Building) || w.has(e, Wreck) || w.has(e, Rubble));
    this.select(inspectable ? e : null);
  }

  private renderInspect(): void {
    const w = this.game.world;
    const e = this.selected;
    this.inspect.replaceChildren();
    this.inspect.classList.toggle('empty', e === null);
    if (e === null) {
      this.inspect.append(el('p', { class: 'hint' }, 'Click a unit or building to inspect it.'));
      return;
    }
    const unit = w.get(e, Unit);
    const building = w.get(e, Building);
    const rubble = w.get(e, Rubble);
    const factionId = w.get(e, Faction)?.id ?? rubble?.faction ?? NEUTRAL;
    const faction = this.factions[factionId];
    const name = unit?.def.name ?? building?.def.name ?? (rubble ? `${rubble.def.name} (ruins)` : 'Wreck');

    const title = el('div', { class: 'title' });
    const swatch = el('span', { class: 'swatch' });
    swatch.style.background = faction ? hex(faction.primary) : '#b5654a';
    title.append(swatch, el('strong', {}, name));
    this.inspect.append(title, el('div', { class: 'sub' }, faction ? faction.name : 'Civilian'));

    const h = w.get(e, Health);
    if (h) {
      const bar = el('div', { class: 'hp' });
      const fill = el('div');
      const frac = Math.max(0, h.hp / h.max);
      fill.style.width = `${frac * 100}%`;
      fill.style.background = frac > 0.5 ? '#6cc070' : frac > 0.25 ? '#e0b040' : '#e05a40';
      bar.append(fill);
      this.inspect.append(bar, el('div', { class: 'sub' }, `${Math.ceil(Math.max(0, h.hp))} / ${h.max} HP`));
    }
    const lines: string[] = [];
    const armed = w.get(e, Armed);
    if (armed) lines.push(`${armed.weapon.name}: ${armed.target !== null ? 'engaging' : 'no target'}`);
    if (unit) lines.push(`Speed ${unit.def.speed}, range ${unit.def.weapon.range}`);
    const construction = w.get(e, Construction);
    if (construction) lines.push(`Under construction: ${Math.round((construction.elapsed / construction.duration) * 100)}%`);
    const producer = w.get(e, Producer);
    if (producer && !construction) {
      const names = [...new Set(producer.table.map((p) => this.game.ctx.units[p.unit].name))].join(', ');
      lines.push(`Builds ${names}`);
    }
    if (rubble) {
      lines.push(this.game.settings.mode === 'eternal' ? `Rebuilding in ${Math.max(0, Math.ceil(rubble.rebuildAt - w.time))}s` : 'Ruins');
    }
    if (w.has(e, Wreck)) lines.push('Destroyed');
    for (const line of lines) this.inspect.append(el('div', { class: 'line' }, line));
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout((this.toast as unknown as { timer?: number }).timer);
    (this.toast as unknown as { timer?: number }).timer = window.setTimeout(() => this.toast.classList.remove('show'), 1400);
  }

  private bindCanvas(canvas: HTMLCanvasElement): void {
    const { signal } = this.listeners;
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button === 0) down = { x: e.clientX, y: e.clientY, t: performance.now() };
      },
      { signal },
    );
    canvas.addEventListener('pointerup', (e) => {
      if (!down || e.button !== 0) return;
      const isClick = Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_SLOP && performance.now() - down.t < CLICK_MS;
      down = null;
      if (isClick) this.click(e.clientX, e.clientY);
    }, { signal });
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        this.setSpeed(this.loop.timeScale === 0 ? this.lastSpeed : 0);
      } else if (key === 't') {
        this.stage.tiltShift.settings.enabled = !this.stage.tiltShift.settings.enabled;
        this.stage.tiltShift.apply();
        this.refresh();
      } else if (key === 'f') {
        this.setFollow(!this.stage.followFights);
      } else if (key === 'escape') {
        if (this.tool) this.setTool(null);
        else this.select(null);
      } else if (['1', '2', '3', '4'].includes(key)) {
        this.setSpeed(SPEEDS[Number(key) - 1]);
      }
    }, { signal: this.listeners.signal });
  }
}
