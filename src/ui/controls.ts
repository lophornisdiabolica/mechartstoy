import { Entity } from '../core/ecs';
import { FixedLoop } from '../core/loop';
import { Armed, Building, Construction, Faction, GARRISON, Guard, Health, NEUTRAL, OutpostPart, Producer, Rubble, Unit, Wreck } from '../game/components';
import { Goal, UnitMix } from '../game/commander/commander';
import { STYLES } from '../game/commander/advice';
import { describeBonus } from '../game/outposts';
import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { LIMITS, RampSettings } from '../game/settings';
import { RAMP_INTERVAL } from '../game/tide';
import { Role } from '../game/units';
import { MoveClass } from '../world/moveClasses';
import { factionColors } from '../render/models';
import { ShadowQuality, Stage } from '../render/stage';
import { el, hex, segmented } from './dom';
import { saveViewPrefs } from './viewPrefs';
import { GodPanel } from './godPanel';
import { BattleAudio } from '../audio/battleAudio';
import { CATEGORIES, defaultAudioPrefs, MIX_MAX } from '../audio/prefs';

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
  /** The battle ticker's feed: whether it shows. */
  ticker: boolean;
  /** Hide the interface for pictures (see PhotoMode). */
  photoMode(): void;
  /** Whether the god powers tab is open (remembered between battles). */
  godOpen: boolean;
  /** The battle's sound, which the Sound section tunes. */
  readonly audio: BattleAudio;
}

/**
 * The in-battle control panel and map clicks. Talks to the sim only through
 * Game's command methods, and to the view through Stage. One per battle;
 * dispose() removes it.
 */
const MOVE_LABELS: Record<MoveClass, string> = {
  foot: 'On foot',
  tracked: 'Tracked',
  walker: 'Walker (climbs slopes, wades shallows)',
  hover: 'Hover (crosses water)',
  amphibious: 'Amphibious',
  naval: 'Naval',
  climber: 'Climber (takes any slope)',
  air: 'Aircraft',
};
/** A side's goals in words, e.g. "Massing at its rally point, 40% ready to push Blue". */
function describeGoals(goals: readonly Goal[], name: (side: number) => string, force: (goal: Goal) => string): string {
  if (goals.length === 0) return 'No plan';
  const words = goals.map((g, i) => {
    switch (g.kind) {
      case 'take':
        return `${force(g)} taking an outpost`;
      case 'hold':
        return `${force(g)} holding an outpost`;
      case 'hunt': {
        const n = g.hunt?.squads ?? 0;
        return `${n} ${n === 1 ? 'squad' : 'squads'} hunting a long-range gun${g.hunt?.flankX != null ? ' round its flank' : ''}`;
      }
      case 'defend':
        return 'Defending home';
      case 'mass':
        return 'Massing at its rally point';
      case 'regroup':
        return 'Regrouping at its rally point';
      case 'push': {
        const target = g.target !== null ? name(g.target) : 'the enemy';
        return i === 0 ? `Pushing ${target}` : `${Math.round(g.score * 100)}% ready to push ${target}`;
      }
    }
  });
  return words.join(', ');
}

/** An army's make-up in words: "10 infantry, 14 vehicles, 2 aircraft; of them 3 artillery, 4 that can shoot aircraft". */
function describeMix(mix: UnitMix): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many = one) => n > 0 && parts.push(`${n} ${n === 1 ? one : many}`);
  add(mix.infantry, 'infantry');
  add(mix.vehicle, 'vehicle', 'vehicles');
  add(mix.air, 'aircraft');
  add(mix.super, 'super unit', 'super units');
  if (parts.length === 0) return 'nothing';
  // Roles cut across the kinds above, so they're said separately.
  const roles: string[] = [];
  if (mix.artillery > 0) roles.push(`${mix.artillery} artillery`);
  if (mix.antiAir > 0) roles.push(`${mix.antiAir} that can shoot aircraft`);
  return parts.join(', ') + (roles.length > 0 ? `; of them ${roles.join(', ')}` : '');
}

const ROLE_LABELS: Record<Role, string> = {
  frontline: 'frontline',
  artillery: 'artillery (fires from long range)',
  support: 'support',
};

export class Controls {
  private selected: Entity | null = null;
  private lastSpeed = 1;
  private readonly panel = el('div', { id: 'panel' });
  private readonly toast = el('div', { id: 'toast' });
  private readonly inspect = el('div', { class: 'inspect' });
  private readonly intensity = el('p', { class: 'hint' });
  private readonly plans = el('details', { class: 'plans' });
  private readonly plansBody = el('div');
  /** The Commander picture the plans list shows (its updatedAt). */
  private plansShownAt = NaN;
  private readonly sync: (() => void)[] = [];
  private inspectTimer = 0;
  /** Removes every listener this panel added outside itself. */
  private readonly listeners = new AbortController();
  /** The god powers tab: drops, orders, airstrikes and the rest (see GodPanel). */
  readonly god: GodPanel;

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
    this.god = new GodPanel(game, stage, factions, (t) => this.showToast(t), match.godOpen, (open) => (this.match.godOpen = open), this.listeners.signal);
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
    this.god.dispose();
    this.panel.remove();
    this.toast.remove();
    this.stage.onFollowStopped = null;
    this.stage.renderer.domElement.style.cursor = '';
  }


  /** Called every frame. */
  update(frameSeconds: number): void {
    this.god.update(frameSeconds);
    // Drop the selection when the thing is gone (destroyed, or a wreck sank).
    if (this.selected !== null && !this.game.world.isAlive(this.selected)) this.select(null);
    this.inspectTimer -= frameSeconds;
    if (this.inspectTimer <= 0) {
      this.inspectTimer = 0.2;
      this.renderInspect();
      const { tide, siege } = this.game.ctx.escalation;
      this.intensity.textContent = `Now: tide ${(1 + tide).toFixed(2)}×, siege ${(1 + siege).toFixed(2)}×`;
      if (this.game.ctx.commander.updatedAt !== this.plansShownAt) this.renderPlans();
    }
  }

  /** Each side's goals, army and what it faces, while the list is open. */
  private renderPlans(): void {
    if (!this.plans.open) return;
    const c = this.game.ctx.commander;
    this.plansShownAt = c.updatedAt;
    this.plansBody.replaceChildren(
      ...c.sides.map((side, f) => {
        const row = el('div', { class: 'side' });
        const title = el('div', { class: 'title' });
        const swatch = el('span', { class: 'swatch' });
        swatch.style.background = hex(factionColors(f).primary);
        const style = this.game.settings.factions[f]?.style ?? 'balanced';
        title.append(swatch, document.createTextNode(this.factions[f].name + (style !== 'balanced' ? ` (${STYLES[style].name.toLowerCase()})` : '')));
        row.append(title);
        const line = (text: string) => row.append(el('div', { class: 'line' }, text));
        if (this.game.ctx.sides.eliminated[f]) {
          line('Out of the battle');
          return row;
        }
        line(
          describeGoals(
            side.goals,
            (g) => this.factions[g].name.split(' ')[0],
            (g) => {
              const tf = c.taskForces.forces.find((t) => t.id === g.force);
              const n = tf?.squads.length ?? 0;
              return `a task force of ${n} ${n === 1 ? 'squad' : 'squads'}${tf && tf.launch > 0 ? ` (${Math.round((tf.strength / tf.launch) * 100)}% strength)` : ''}`;
            },
          ),
        );
        const total = side.mix.infantry + side.mix.vehicle + side.mix.air + side.mix.super;
        line(`Army, outpost guards and engineers aside: ${total} (${describeMix(side.mix)}). Strength ${Math.round(side.ground)} on the ground, ${Math.round(side.air)} in the air, ${Math.round(side.antiAir)} able to shoot aircraft`);
        const jobs = [
          side.jobs.cover > 0 ? `${side.jobs.cover} flak covering against aircraft` : '',
          side.jobs.overwatch > 0 ? `${side.jobs.overwatch} artillery on high ground` : '',
          side.jobs.escort > 0 ? `${side.jobs.escort} escorting the super unit` : '',
          side.jobs.build > 0 ? `${side.jobs.build} engineer${side.jobs.build === 1 ? '' : 's'} fortifying` : '',
        ].filter(Boolean);
        if (jobs.length > 0) line(`Jobs: ${jobs.join(', ')}`);
        if (side.detours > 0) line(`Going round danger: ${side.detours} squad${side.detours === 1 ? '' : 's'} swinging wide of what outguns them`);
        const limit = this.game.settings.armies.advice;
        const pct = (v: number) => `${Math.round(Math.abs(v) * limit * 100)}%`;
        const { antiAir, antiArmour } = side.needs;
        const lean = [
          antiAir > 0.1 ? `more anti-air (+${pct(antiAir)})` : antiAir < -0.1 ? `less anti-air (−${pct(antiAir)})` : '',
          antiArmour > 0.1 ? `more hard hitters (+${pct(antiArmour)})` : antiArmour < -0.1 ? `more that sprays infantry (+${pct(antiArmour)})` : '',
        ].filter(Boolean);
        if (limit > 0 && lean.length > 0) line(`Building ${lean.join(', ')}`);
        line(`Faces ${describeMix(side.enemyMix)}`);
        return row;
      }),
    );
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

    // Commanders: each side's picture of the battle and what it means to do (see game/commander).
    const plans = section('Commanders');
    const plansLabel = el('label', { class: 'check', title: "Draw each side's plan: arrows to where it's massing and what it means to push, fainter the less ready it is" });
    const showPlans = el('input', { type: 'checkbox' });
    showPlans.addEventListener('change', () => {
      this.stage.showPlans = showPlans.checked;
      this.saveView();
    });
    plansLabel.append(showPlans, document.createTextNode(' Show plans on the map'));
    this.sync.push(() => (showPlans.checked = this.stage.showPlans));
    this.plans.append(el('summary', {}, 'What each side means to do'));
    this.plans.append(this.plansBody);
    this.plans.addEventListener('toggle', () => this.renderPlans());
    const frontsLabel = el('label', { class: 'check', title: 'Shade the ground in the colour of whoever holds it, from where each side’s strength is: the front is where the colours meet' });
    const showFronts = el('input', { type: 'checkbox' });
    showFronts.addEventListener('change', () => {
      this.stage.showFronts = showFronts.checked;
      this.saveView();
    });
    frontsLabel.append(showFronts, document.createTextNode(' Show front lines'));
    this.sync.push(() => (showFronts.checked = this.stage.showFronts));
    const tickerLabel = el('label', { class: 'check', title: 'A quiet feed of what’s happening: outposts taken, super units lost, bases razed, attacks setting out' });
    const showTicker = el('input', { type: 'checkbox' });
    showTicker.addEventListener('change', () => {
      this.match.ticker = showTicker.checked;
      this.saveView();
    });
    tickerLabel.append(showTicker, document.createTextNode(' Battle ticker'));
    this.sync.push(() => (showTicker.checked = this.match.ticker));
    plans.append(plansLabel, frontsLabel, tickerLabel, this.plans);

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
    const turnLabel = el('label', { class: 'check', title: 'Hold Q / E to turn the camera to any angle, instead of a quarter turn per press' });
    const turn = el('input', { type: 'checkbox' });
    turn.addEventListener('change', () => {
      this.stage.rig.smoothTurn = turn.checked;
      if (!turn.checked) this.stage.rig.snapRotation();
      this.saveView();
    });
    turnLabel.append(turn, document.createTextNode(' Smooth rotation (Q/E)'));
    cam.append(turnLabel);
    this.sync.push(() => (turn.checked = this.stage.rig.smoothTurn));
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
    const photo = el('button', { type: 'button', class: 'wide', title: 'Hide the interface, free the camera and set the time of day, for pictures' }, 'Photo mode (H)');
    photo.addEventListener('click', () => this.match.photoMode());
    cam.append(photo);

    this.buildSound(section('Sound'));

    body.append(this.inspect);
  }

  /**
   * Sound: mute, volume, how closely it follows the camera, and a mix of
   * each kind of sound. Remembered in this browser, like the view settings.
   */
  private buildSound(s: HTMLElement): void {
    const audio = this.match.audio;
    const prefs = audio.prefs;
    const changed = () => {
      audio.changed();
      this.refresh();
    };
    const muteLabel = el('label', { class: 'check', title: 'Turn all sound off (M)' });
    const mute = el('input', { type: 'checkbox' });
    mute.addEventListener('change', () => {
      prefs.muted = mute.checked;
      changed();
    });
    muteLabel.append(mute, document.createTextNode(' Mute (M)'));
    const note = el('p', { class: 'hint' });
    s.append(muteLabel, note);
    this.sync.push(() => {
      mute.checked = prefs.muted;
      note.hidden = prefs.muted || audio.running;
      note.textContent = 'Sound starts once you click or press a key (the browser’s rule).';
    });
    const slider = (parent: HTMLElement, label: string, title: string, max: number, get: () => number, set: (v: number) => void, shown: (v: number) => string) => {
      const wrap = el('label', { class: 'slider valued', title });
      const input = el('input', { type: 'range', min: '0', max: String(max), step: '0.01' });
      const value = el('span', { class: 'value' });
      input.addEventListener('input', () => {
        set(Number(input.value));
        changed();
      });
      wrap.append(el('span', {}, label), input, value);
      parent.append(wrap);
      this.sync.push(() => {
        input.value = String(get());
        value.textContent = shown(get());
      });
      return wrap;
    };
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    slider(s, 'Volume', 'Master volume', 1, () => prefs.volume, (v) => (prefs.volume = v), percent);
    slider(
      s,
      'Focus',
      'How closely the sound follows the camera: low hears the whole battlefield about equally, high hears what’s on screen clearly and the rest as a muffled distance. Zooming in narrows it further.',
      1,
      () => prefs.focus,
      (v) => (prefs.focus = v),
      (v) => (v < 0.15 ? 'Whole map' : v > 0.85 ? 'On screen' : percent(v)),
    );
    const mixer = el('details', { class: 'mix' });
    mixer.append(el('summary', {}, 'Mix'));
    for (const c of CATEGORIES) {
      const row = slider(mixer, c.label, c.title, MIX_MAX, () => prefs.mix[c.id], (v) => (prefs.mix[c.id] = v), (v) => (v === 0 ? 'Off' : percent(v)));
      if (c.id !== 'ambience') {
        // Letting go of the slider plays one of its sounds, to judge the level by.
        row.querySelector('input')!.addEventListener('change', () => audio.preview(c.id));
      }
    }
    const everywhereLabel = el('label', { class: 'check', title: 'Hear alert chimes wherever they happen; off, they follow the focus like everything else' });
    const everywhere = el('input', { type: 'checkbox' });
    everywhere.addEventListener('change', () => {
      prefs.alertsEverywhere = everywhere.checked;
      changed();
    });
    everywhereLabel.append(everywhere, document.createTextNode(' Alerts heard map-wide'));
    this.sync.push(() => (everywhere.checked = prefs.alertsEverywhere));
    const reset = el('button', { type: 'button', class: 'wide', title: 'Put every sound setting back as it was' }, 'Reset sound');
    reset.addEventListener('click', () => {
      const d = defaultAudioPrefs();
      Object.assign(prefs, { ...d, mix: { ...d.mix } });
      changed();
    });
    mixer.append(everywhereLabel, reset);
    s.append(mixer);
  }

  /** Re-sync the sound controls (after M toggles mute). */
  refreshSound(): void {
    this.refresh();
  }

  /** Re-sync every control with current state. */
  private refresh(): void {
    for (const s of this.sync) s();
  }

  private setFollow(on: boolean): void {
    this.stage.followFights = on;
    this.saveView();
    this.refresh();
    if (on && !this.stage.fights.focus) this.showToast('Following: waiting for a fight');
  }

  private saveView(): void {
    saveViewPrefs({ shadows: this.stage.shadows, follow: this.stage.followFights, plans: this.stage.showPlans, fronts: this.stage.showFronts, ticker: this.match.ticker, smoothTurn: this.stage.rig.smoothTurn, god: this.match.godOpen });
  }

  private setSpeed(v: number): void {
    if (v > 0) this.lastSpeed = v;
    this.loop.timeScale = v;
    this.refresh();
  }

  private select(e: Entity | null): void {
    this.selected = e;
    this.stage.selected = e;
    this.renderInspect();
  }

  private click(x: number, y: number): void {
    // A click with a god power picked is the power's.
    if (this.god.busy) return;
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
    const garrison = factionId === GARRISON;
    swatch.style.background = faction ? hex(faction.primary) : garrison ? hex(factionColors(GARRISON).primary) : '#b5654a';
    title.append(swatch, el('strong', {}, name));
    this.inspect.append(title, el('div', { class: 'sub' }, faction ? faction.name : garrison ? 'Garrison (fights everyone)' : 'Civilian'));

    const h = w.get(e, Health);
    if (h) {
      const bar = el('div', { class: 'hp' });
      const fill = el('div');
      const frac = Math.max(0, h.hp / h.max);
      fill.style.width = `${frac * 100}%`;
      fill.style.background = frac > 0.5 ? '#6cc070' : frac > 0.25 ? '#e0b040' : '#e05a40';
      bar.append(fill);
      const armour = h.armor > 0 ? `, armour ${h.armor}` : '';
      this.inspect.append(bar, el('div', { class: 'sub' }, `${Math.ceil(Math.max(0, h.hp))} / ${h.max} HP${armour}`));
    }
    const lines: string[] = [];
    const armed = w.get(e, Armed);
    if (armed) lines.push(`${armed.weapon.name}: ${armed.target !== null ? 'engaging' : 'no target'}`);
    if (unit) {
      lines.push(`${MOVE_LABELS[unit.def.move]}, ${ROLE_LABELS[unit.def.role]}`);
      lines.push(`Speed ${unit.def.speed}, range ${unit.def.weapon.range}`);
    }
    const guard = w.get(e, Guard);
    if (guard) lines.push('Guarding its outpost');
    const part = w.get(e, OutpostPart);
    if (part) {
      const o = this.game.ctx.outposts[part.outpost];
      lines.push(`${o.kind.name}: ${describeBonus(o.kind, this.game.settings.armies.outpostBonus)} for its holder`);
      if (o.claimant >= 0) lines.push(`${this.factions[o.claimant].name} taking it: ${Math.round(o.progress * 100)}%`);
    }
    const construction = w.get(e, Construction);
    if (construction) lines.push(`Under construction: ${Math.round((construction.elapsed / construction.duration) * 100)}%`);
    const producer = w.get(e, Producer);
    if (producer && !construction) {
      const ids = producer.table.map((p) => p.unit);
      if (producer.flagship) ids.push(producer.flagship);
      const names = [...new Set(ids.map((id) => this.game.ctx.units[id].name))].join(', ');
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
        if (this.god.tool) this.god.setTool(null);
        else this.select(null);
      } else if (key === 'g') {
        this.god.setOpen(!this.god.open);
      } else if (['1', '2', '3', '4'].includes(key)) {
        this.setSpeed(SPEEDS[Number(key) - 1]);
      }
    }, { signal: this.listeners.signal });
  }
}
