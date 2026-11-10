import { FixedLoop } from './core/loop';
import { hashSeed, Rng } from './core/rng';
import { Building, Faction, Producer, Unit } from './game/components';
import { BuildingId } from './game/buildings';
import { FactionDef } from './game/factions';
import { Game, SIM_HZ } from './game/game';
import { outpostsHeldBy } from './game/outposts';
import { BattleSettings, factionDefs, teamLabels } from './game/settings';
import { UnitId } from './game/units';
import { rollBattle, varietyOn } from './game/variety';
import { Stage } from './render/stage';
import { loadViewPrefs, saveViewPrefs } from './ui/viewPrefs';
import { Controls, MatchControls } from './ui/controls';
import { el, hex, textHex } from './ui/dom';
import { parseAt, settingsFromParams, settingsToParams } from './ui/settingsUrl';
import { SetupScreen } from './ui/setupScreen';
import { PerfOverlay } from './ui/perfOverlay';
import { Ticker } from './ui/ticker';
import { BattleHistory } from './ui/battleChart';
import { PhotoMode } from './ui/photoMode';
import { DebugPanel } from './ui/debugPanel';
import { RemoteSim } from './sim/remoteSim';
import { BattleAudio, listenerFrom } from './audio/battleAudio';

/** Seconds the victory banner and summary show before the next battle (the clock stops while paused). */
const VICTORY_PAUSE = 15;

/** Battle time as m:ss (or h:mm:ss). */
function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** The HUD's escalation note, e.g. " · tide 1.4× · siege 1.4×", or nothing before it starts. */
function escalation(game: Game): string {
  const { tide, siege } = game.ctx.escalation;
  return (tide > 0.005 ? ` · tide ${(1 + tide).toFixed(1)}×` : '') + (siege > 0.005 ? ` · siege ${(1 + siege).toFixed(1)}×` : '');
}

/** What a side's army is up to, for the HUD: " · attacking Ember", " · massing 70%" and so on. */
function plan(game: Game, faction: number, factions: FactionDef[]): string {
  const { offensive, sides } = game.ctx;
  const time = game.world.time;
  const target = sides.target(faction, offensive.attack(faction, time));
  const name = target !== null ? factions[target]?.name ?? '' : '';
  if (offensive.attacking(faction, time)) return target !== null ? ` · attacking ${name}` : '';
  if (game.settings.armies.attackTiming === 'tide') return ' · building up';
  const p = offensive.plan(faction);
  if (p.state === 'regrouping') return ' · regrouping';
  if (p.state === 'defending') return ' · defending';
  return p.state === 'massing' ? ` · massing ${Math.min(99, Math.round(p.ready * 100))}%` : '';
}

/** A side's blessings and curses (god powers), for the HUD: " · healing 42s". */
function blessed(game: Game, faction: number): string {
  const now = game.world.time;
  const words = { production: 'blessed production', healing: 'blessed healing', curse: 'cursed' };
  return game.ctx.god.blessings
    .filter((b) => b.faction === faction && b.until > now)
    .map((b) => ` · ${words[b.kind]} ${Math.ceil(b.until - now)}s`)
    .join('');
}

/** "A", "A and B", "A, B and C". */
function listNames(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

interface Battle {
  game: Game;
  seed: string;
  /** What this battle was started with (a re-roll of the setup's settings, when variety is on). */
  settings: BattleSettings;
  /** What was re-rolled for it, for the HUD; empty if nothing was. */
  label: string;
  factions: FactionDef[];
  /** The control panel; null while the battle is only a backdrop behind the setup screen. */
  controls: Controls | null;
}

/**
 * Runs the session: one long-lived renderer and loop, a battle at a time,
 * and the setup screen between them. In Conquest, a won battle rolls
 * straight into a fresh map unless the player asked to go to setup.
 */
export class App implements MatchControls {
  readonly stage: Stage;
  readonly loop: FixedLoop;
  readonly setup: SetupScreen;
  /** What the setup screen last had; follow-up battles reuse it with a new seed. */
  private settings: BattleSettings;
  private battle!: Battle;
  setupAfterBattle = false;

  private readonly hud: HTMLElement;
  private readonly banner = el('div', { id: 'banner', hidden: '' });
  /** Shown while a battle is fast-forwarding to the `at` URL option. */
  private readonly skipNote = el('div', { id: 'skipping', hidden: '' });
  private fps = 0;
  private hudTimer = 0;
  private bannerShownFor: Game | null = null;
  /** Unpaused seconds the banner has been up. */
  private bannerTime = 0;
  private readonly perf: PerfOverlay;
  private readonly tickerFeed = new Ticker();
  private readonly history = new BattleHistory();
  private readonly photo: PhotoMode;
  private readonly debug: DebugPanel;
  /** The battle's sound (see BattleAudio); lives as long as the page. */
  readonly audio = new BattleAudio();
  /** Plays the battle in a worker thread; null plays it on the page (`?worker=0`, or no worker support). */
  private readonly sim: RemoteSim | null;
  private panelCollapsed = window.matchMedia('(max-width: 600px)').matches;

  constructor(container: HTMLElement, hud: HTMLElement) {
    this.hud = hud;
    this.settings = settingsFromParams(new URLSearchParams(location.search));
    this.stage = new Stage(container);
    // For poking at a running game from the browser console (and screenshot scripts) during development.
    if (import.meta.env.DEV) (window as unknown as { app: App }).app = this;
    const view = loadViewPrefs();
    this.stage.shadows = view.shadows;
    this.stage.followFights = view.follow;
    this.stage.showPlans = view.plans;
    this.stage.showFronts = view.fronts;
    this.stage.rig.smoothTurn = view.smoothTurn;
    this.tickerFeed.on = view.ticker;
    this.sim = new URLSearchParams(location.search).get('worker') !== '0' && typeof Worker !== 'undefined' ? new RemoteSim() : null;
    this.loop = new FixedLoop(1 / SIM_HZ, {
      step: (dt) => (this.sim ? this.sim.step() : this.perf.step(() => this.battle.game.step(dt))),
      render: (alpha, frameSeconds) => this.frame(this.sim ? this.sim.sync(frameSeconds * this.loop.timeScale) : alpha, frameSeconds),
    });
    document.body.append(this.banner, this.skipNote);
    this.photo = new PhotoMode(this.stage, this.loop);
    this.perf = new PerfOverlay(this.stage, this.audio.stats);
    this.debug = new DebugPanel(this.stage);
    if (this.sim) this.sim.onFrame = (f) => this.perf.simFrame(f.ticks, f.simMs, f.worstMs, f.profile);
    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (key === 'escape' && this.photo.active) return this.photo.leave();
      if (key !== 'p' && key !== 'o' && key !== 'h' && key !== 'm') return;
      if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (key === 'p') this.perf.toggle();
      else if (key === 'o') this.debug.toggle();
      else if (key === 'm') {
        this.audio.prefs.muted = !this.audio.prefs.muted;
        this.audio.changed();
        this.battle.controls?.refreshSound();
      }
      else if (!this.setup.visible) this.photo.toggle();
    });
    this.setup = new SetupScreen(this.settings, {
      start: (s) => this.startFromSetup(s),
      change: (s) => {
        this.settings = s;
        this.writeUrl(s);
      },
    });
    // `at` opens the battle straight away, fast-forwarded (e.g. a sims link plus &at=25m).
    const at = parseAt(new URLSearchParams(location.search).get('at'));
    if (at !== null) {
      this.setup.hide();
      this.startBattle(this.settings, this.settings.seed || randomSeed(), '', at);
    } else {
      // The first battle runs behind the setup screen as a backdrop.
      this.startBattle(this.settings, this.settings.seed || randomSeed());
    }
    this.loop.start();
  }

  get game(): Game {
    return this.battle.game;
  }

  /** End this battle now and open the setup screen. */
  endBattle(): void {
    this.setupAfterBattle = false;
    this.photo.leave();
    this.dropControls();
    this.banner.hidden = true;
    this.loop.timeScale = 1;
    this.setup.show(this.settings);
    this.writeUrl(this.settings);
  }

  get ticker(): boolean {
    return this.tickerFeed.on;
  }

  set ticker(on: boolean) {
    this.tickerFeed.on = on;
  }

  photoMode(): void {
    this.photo.enter();
  }

  /** The god powers tab: open or not, remembered in this browser like the view settings. */
  get godOpen(): boolean {
    return this.godShown;
  }

  set godOpen(open: boolean) {
    this.godShown = open;
    saveViewPrefs({ ...loadViewPrefs(), god: open });
  }
  private godShown = loadViewPrefs().god;

  settingsChanged(): void {
    // The panel changes the live battle's settings; keep the setup's in step.
    if (this.battle.settings !== this.settings) this.settings.armies.ramp = structuredClone(this.battle.settings.armies.ramp);
    this.sim?.settings(this.battle.settings);
    this.writeUrl({ ...this.battle.settings, seed: this.battle.seed });
  }

  private startFromSetup(settings: BattleSettings): void {
    this.settings = settings;
    this.setup.hide();
    this.startBattle(settings, settings.seed || randomSeed());
  }

  private dropControls(): void {
    const controls = this.battle?.controls;
    if (!controls) return;
    this.panelCollapsed = controls.collapsed;
    controls.dispose();
    this.battle.controls = null;
  }

  /** Start a battle, fast-forwarded `skip` seconds (the `at` URL option). */
  private startBattle(settings: BattleSettings, seed: string, label = '', skip = 0): void {
    this.dropControls();
    let game: Game;
    if (this.sim) {
      game = this.sim.start(hashSeed(seed), settings, skip);
      this.skipNote.hidden = skip <= 0;
      this.skipNote.textContent = `Fast-forwarding to ${clock(skip)}…`;
      this.sim.onProgress = (time) => {
        this.skipNote.hidden = time === null;
        if (time !== null) this.skipNote.textContent = `Fast-forwarding to ${clock(skip)}… ${clock(time)}`;
      };
    } else {
      game = new Game(hashSeed(seed), { settings });
      // On the page: play it out before anything listens for effects.
      for (let i = Math.round(skip * SIM_HZ); i > 0 && game.outcome === null; i--) game.step(1 / SIM_HZ);
    }
    const factions = factionDefs(settings);
    this.stage.load(game, factions);
    if (this.sim) this.stage.entities.hidden = this.sim.hidden;
    const sim = this.sim;
    this.stage.debugOverlay.routeSource = sim ? (on) => sim.routes(on) : null;
    this.stage.restoreDebug();
    this.debug.refresh();
    this.perf.attach(game);
    this.audio.attach(game);
    this.tickerFeed.attach(game, factions);
    this.history.attach(game);
    // The panel only belongs to a live battle, not the backdrop behind setup.
    const controls = this.setup.visible ? null : new Controls(game, this.stage, this.loop, factions, this, this.panelCollapsed);
    this.battle = { game, seed, settings, label, factions, controls };
    this.banner.hidden = true;
    this.bannerShownFor = null;
    this.hudTimer = 0;
    // Keep the address bar pointing at what's on screen, so a reload or shared link reproduces it.
    if (!this.setup.visible) this.writeUrl({ ...settings, seed });
  }

  private frame(alpha: number, frameSeconds: number): void {
    const { game, controls } = this.battle;
    this.stage.render(alpha, frameSeconds, frameSeconds * this.loop.timeScale);
    controls?.update(frameSeconds);
    this.tickerFeed.update(frameSeconds);
    this.audio.update(frameSeconds, listenerFrom(this.stage.rig), this.setup.visible);
    this.history.update();
    if (frameSeconds > 0) this.fps += (1 / frameSeconds - this.fps) * 0.05;
    this.perf.frame(frameSeconds);

    // A battle that hasn't ended by the variety time limit gives way to the next.
    const after = this.battle.settings.variety.after;
    const ended = game.outcome !== null || (after > 0 && game.world.time >= after * 60);
    if (ended && !this.setup.visible) {
      if (this.bannerShownFor !== game) this.showBanner();
      if (this.loop.timeScale > 0) this.bannerTime += frameSeconds;
      const left = Math.ceil(VICTORY_PAUSE - this.bannerTime);
      this.banner.querySelector('.next')!.textContent = this.setupAfterBattle ? `Setup in ${Math.max(0, left)}s` : `New battle in ${Math.max(0, left)}s`;
      if (left <= 0) this.nextBattle();
    }

    this.hudTimer -= frameSeconds;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.5;
      this.hud.hidden = this.setup.visible;
      this.tickerFeed.root.style.display = this.setup.visible ? 'none' : '';
      this.hud.textContent = this.hudText();
    }
  }

  private nextBattle(): void {
    if (this.setupAfterBattle) {
      this.endBattle();
      return;
    }
    // Same settings, fresh map, and a fresh roll of whatever the setup asked to vary.
    const seed = randomSeed();
    if (!varietyOn(this.settings.variety)) {
      this.startBattle(this.settings, seed);
      return;
    }
    const roll = rollBattle(this.settings, new Rng(hashSeed(`variety:${seed}`)));
    this.startBattle(roll.settings, seed, roll.label);
  }

  private showBanner(): void {
    const { game, factions } = this.battle;
    const outcome = game.outcome;
    const winners = outcome ? outcome.winners.map((f) => factions[f]) : [];
    this.bannerShownFor = game;
    this.bannerTime = 0;
    const chart = this.history.render(factions);
    const title = !outcome ? 'Time’s up' : winners.length === 0 ? 'Mutual destruction' : `${listNames(winners.map((f) => f.name))} ${winners.length === 1 ? 'wins' : 'win'}`;
    this.banner.replaceChildren(
      el('div', { class: 'title' }, title),
      el('div', { class: 'sub' }, outcome ? `after ${clock(outcome.time)}` : `after ${clock(game.world.time)}, still undecided`),
      this.summary(),
      ...(chart ? [chart] : []),
      el('div', { class: 'next' }),
    );
    this.banner.style.setProperty('--accent', winners.length === 0 ? '#e8d27a' : hex(winners[0].primary));
    this.banner.hidden = false;
  }

  /** The end-of-battle numbers, one row per side. */
  private summary(): HTMLElement {
    const { game, factions } = this.battle;
    const { stats, ctx } = game;
    const outcome = game.outcome;
    const table = el('table', { class: 'summary' });
    const typeName = (id: string) => ctx.units[id as UnitId]?.name ?? ctx.buildings[id as BuildingId]?.name ?? id;
    const columns: [string, string, (f: number) => string][] = [
      ['Fielded', 'Units fielded', (f) => String(stats.sides[f].fielded)],
      ['Lost', 'Units lost', (f) => String(stats.sides[f].lost)],
      ['Kills', 'Enemy units destroyed', (f) => String(stats.sides[f].kills)],
      ['Razed', 'Buildings destroyed', (f) => String(stats.sides[f].razed)],
      ...(ctx.outposts.length > 0
        ? ([['Outposts', 'Outposts captured', (f) => String(stats.sides[f].captured)]] as [string, string, (f: number) => string][])
        : []),
      [
        'Top unit',
        'The unit type with the most kills',
        (f) => {
          const best = stats.best(f);
          return best ? `${typeName(best.source)} (${best.kills})` : '—';
        },
      ],
      [
        'Result',
        'Won, or when the side lost its last production building',
        (f) => {
          const out = ctx.sides.eliminatedAt[f];
          if (outcome?.winners.includes(f)) return out === null ? 'Won' : `Won (out ${clock(out)})`;
          return out === null ? '—' : `Out ${clock(out)}`;
        },
      ],
    ];
    const head = el('tr');
    head.append(el('th'));
    for (const [label, title] of columns) head.append(el('th', { title }, label));
    table.append(head);
    // Phones only have room for the first word of each name.
    const narrow = window.matchMedia('(max-width: 600px)').matches;
    for (const f of factions) {
      const tr = el('tr');
      const name = el('th', { title: f.name }, narrow ? f.name.split(' ')[0] : f.name);
      name.style.color = textHex(f.primary);
      tr.append(name);
      for (const [, , value] of columns) tr.append(el('td', {}, value(f.id)));
      table.append(tr);
    }
    const wrap = el('div', { class: 'stats' });
    wrap.append(table);
    // What the town suffered: buildings and people caught in the crossfire, and who the townsfolk took up arms against.
    const hurt: string[] = [];
    if (stats.townRazed > 0) hurt.push(`${stats.townRazed} town ${stats.townRazed === 1 ? 'building' : 'buildings'}`);
    if (stats.townFolkLost > 0) hurt.push(`${stats.townFolkLost} ${stats.townFolkLost === 1 ? 'townsperson' : 'townsfolk'}`);
    if (hurt.length > 0) wrap.append(el('div', { class: 'town' }, `${hurt.join(' and ')} caught in the crossfire`));
    const angered = stats.townAngered.map((id) => factions.find((f) => f.id === id)).filter((f) => f !== undefined);
    if (angered.length > 0) {
      const line = el('div', { class: 'town' }, 'Towns took up arms against ');
      angered.forEach((f, k) => {
        if (k > 0) line.append(k === angered.length - 1 ? ' and ' : ', ');
        const name = el('span', {}, f.name);
        name.style.color = textHex(f.primary);
        line.append(name);
      });
      wrap.append(line);
    }
    return wrap;
  }

  private hudText(): string {
    const { game, factions, seed, label } = this.battle;
    const losses = game.stats.sides.map((s) => s.lost);
    const w = game.world;
    const alive = factions.map(() => 0);
    const buildings = factions.map(() => 0);
    const producers = factions.map(() => 0);
    for (const e of w.query(Unit, Faction)) {
      const f = w.req(e, Faction).id;
      if (f >= 0) alive[f]++;
    }
    for (const e of w.query(Building, Faction)) {
      const f = w.req(e, Faction).id;
      if (f < 0) continue;
      buildings[f]++;
      if (w.has(e, Producer)) producers[f]++;
    }
    const conquest = game.settings.mode === 'conquest';
    const labels = teamLabels(game.settings);
    const lines = factions.map((f) => {
      const strength = game.ctx.sides.strength[f.id];
      const notes = [labels[f.id], strength !== 1 ? `${Math.round(strength * 100) / 100}× army` : ''].filter(Boolean).join(', ');
      const team = notes ? ` (${notes})` : '';
      const out = game.ctx.sides.eliminated[f.id] ? ' · out' : '';
      const held = outpostsHeldBy(game.ctx, f.id);
      const outposts = game.ctx.outposts.length > 0 ? `, ${held} ${held === 1 ? 'outpost' : 'outposts'}` : '';
      const doing = out ? '' : plan(game, f.id, factions) + blessed(game, f.id);
      return `${f.name}${team}: ${alive[f.id]} units, ${conquest ? `${producers[f.id]} production left` : `${buildings[f.id]} buildings`}${outposts}, ${losses[f.id]} lost${out}${doing}`;
    });
    return (
      `${lines.join('\n')}\n` +
      `${conquest ? 'Conquest' : 'Eternal'} · ${clock(w.time)}${escalation(game)}${label ? ` · ${label}` : ''} · seed ${seed} · ${Math.round(this.fps)} fps\n` +
      `WASD / right-drag pan · wheel zoom · Q/E rotate · F follow fights · G god powers · 1-4 speed · space pause · M mute · P stats · O overlays · H photo mode`
    );
  }

  private writeUrl(settings: BattleSettings): void {
    const query = settingsToParams(settings).toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }
}
