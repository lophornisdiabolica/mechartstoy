import { FixedLoop } from './core/loop';
import { hashSeed } from './core/rng';
import { Building, Faction, Producer, Unit } from './game/components';
import { BuildingId } from './game/buildings';
import { FactionDef } from './game/factions';
import { Game, SIM_HZ } from './game/game';
import { BattleSettings, factionDefs, teamLabels } from './game/settings';
import { UnitId } from './game/units';
import { Stage } from './render/stage';
import { Controls, MatchControls } from './ui/controls';
import { el, hex } from './ui/dom';
import { settingsFromParams, settingsToParams } from './ui/settingsUrl';
import { SetupScreen } from './ui/setupScreen';

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
  private fps = 0;
  private hudTimer = 0;
  private bannerShownFor: Game | null = null;
  /** Unpaused seconds the banner has been up. */
  private bannerTime = 0;
  private panelCollapsed = window.matchMedia('(max-width: 600px)').matches;

  constructor(container: HTMLElement, hud: HTMLElement) {
    this.hud = hud;
    this.settings = settingsFromParams(new URLSearchParams(location.search));
    this.stage = new Stage(container);
    this.loop = new FixedLoop(1 / SIM_HZ, {
      step: (dt) => this.battle.game.step(dt),
      render: (alpha, frameSeconds) => this.frame(alpha, frameSeconds),
    });
    document.body.append(this.banner);
    this.setup = new SetupScreen(this.settings, {
      start: (s) => this.startFromSetup(s),
      change: (s) => {
        this.settings = s;
        this.writeUrl(s);
      },
    });
    // The first battle runs behind the setup screen as a backdrop.
    this.startBattle(this.settings, this.settings.seed || randomSeed());
    this.loop.start();
  }

  get game(): Game {
    return this.battle.game;
  }

  /** End this battle now and open the setup screen. */
  endBattle(): void {
    this.setupAfterBattle = false;
    this.dropControls();
    this.banner.hidden = true;
    this.loop.timeScale = 1;
    this.setup.show(this.settings);
    this.writeUrl(this.settings);
  }

  settingsChanged(): void {
    this.writeUrl({ ...this.settings, seed: this.battle.seed });
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

  private startBattle(settings: BattleSettings, seed: string): void {
    this.dropControls();
    const game = new Game(hashSeed(seed), { settings });
    const factions = factionDefs(settings);
    this.stage.load(game, factions);
    // The panel only belongs to a live battle, not the backdrop behind setup.
    const controls = this.setup.visible ? null : new Controls(game, this.stage, this.loop, factions, this, this.panelCollapsed);
    this.battle = { game, seed, factions, controls };
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
    if (frameSeconds > 0) this.fps += (1 / frameSeconds - this.fps) * 0.05;

    const outcome = game.outcome;
    if (outcome && !this.setup.visible) {
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
      this.hud.textContent = this.hudText();
    }
  }

  private nextBattle(): void {
    if (this.setupAfterBattle) {
      this.endBattle();
      return;
    }
    // Same settings, fresh map.
    this.startBattle(this.settings, randomSeed());
  }

  private showBanner(): void {
    const { game, factions } = this.battle;
    const outcome = game.outcome!;
    const winners = outcome.winners.map((f) => factions[f]);
    this.bannerShownFor = game;
    this.bannerTime = 0;
    this.banner.replaceChildren(
      el('div', { class: 'title' }, winners.length === 0 ? 'Mutual destruction' : `${listNames(winners.map((f) => f.name))} ${winners.length === 1 ? 'wins' : 'win'}`),
      el('div', { class: 'sub' }, `after ${clock(outcome.time)}`),
      this.summary(),
      el('div', { class: 'next' }),
    );
    this.banner.style.setProperty('--accent', winners.length === 0 ? '#e8d27a' : hex(winners[0].primary));
    this.banner.hidden = false;
  }

  /** The end-of-battle numbers, one row per side. */
  private summary(): HTMLElement {
    const { game, factions } = this.battle;
    const { stats, ctx } = game;
    const outcome = game.outcome!;
    const table = el('table', { class: 'summary' });
    const typeName = (id: string) => ctx.units[id as UnitId]?.name ?? ctx.buildings[id as BuildingId]?.name ?? id;
    const columns: [string, string, (f: number) => string][] = [
      ['Fielded', 'Units fielded', (f) => String(stats.sides[f].fielded)],
      ['Lost', 'Units lost', (f) => String(stats.sides[f].lost)],
      ['Kills', 'Enemy units destroyed', (f) => String(stats.sides[f].kills)],
      ['Razed', 'Buildings destroyed', (f) => String(stats.sides[f].razed)],
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
          if (outcome.winners.includes(f)) return out === null ? 'Won' : `Won (out ${clock(out)})`;
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
      name.style.color = hex(f.primary);
      tr.append(name);
      for (const [, , value] of columns) tr.append(el('td', {}, value(f.id)));
      table.append(tr);
    }
    const wrap = el('div', { class: 'stats' });
    wrap.append(table);
    if (stats.townRazed > 0) wrap.append(el('div', { class: 'town' }, `${stats.townRazed} town ${stats.townRazed === 1 ? 'building' : 'buildings'} caught in the crossfire`));
    return wrap;
  }

  private hudText(): string {
    const { game, factions, seed } = this.battle;
    const losses = game.stats.sides.map((s) => s.lost);
    const w = game.world;
    const alive = factions.map(() => 0);
    const buildings = factions.map(() => 0);
    const producers = factions.map(() => 0);
    for (const e of w.query(Unit, Faction)) alive[w.req(e, Faction).id]++;
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
      return `${f.name}${team}: ${alive[f.id]} units, ${conquest ? `${producers[f.id]} production left` : `${buildings[f.id]} buildings`}, ${losses[f.id]} lost${out}`;
    });
    return (
      `${lines.join('\n')}\n` +
      `${conquest ? 'Conquest' : 'Eternal'} · ${clock(w.time)}${escalation(game)} · seed ${seed} · ${Math.round(this.fps)} fps\n` +
      `WASD / right-drag pan · wheel zoom · Q/E rotate · 1-4 speed · space pause`
    );
  }

  private writeUrl(settings: BattleSettings): void {
    const query = settingsToParams(settings).toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }
}
