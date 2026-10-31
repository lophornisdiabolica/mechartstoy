import { FixedLoop } from './core/loop';
import { hashSeed } from './core/rng';
import { Building, Faction, Producer, Unit } from './game/components';
import { FactionDef } from './game/factions';
import { Game, SIM_HZ } from './game/game';
import { BattleSettings, factionDefs } from './game/settings';
import { Stage } from './render/stage';
import { Controls, MatchControls } from './ui/controls';
import { el } from './ui/dom';
import { settingsFromParams, settingsToParams } from './ui/settingsUrl';
import { SetupScreen } from './ui/setupScreen';

/** Seconds of battle (sim time) the victory banner shows before the next battle. */
const VICTORY_PAUSE = 12;

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

interface Battle {
  game: Game;
  seed: string;
  factions: FactionDef[];
  /** The control panel; null while the battle is only a backdrop behind the setup screen. */
  controls: Controls | null;
  losses: number[];
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
    const losses = factions.map(() => 0);
    game.events.on('unitDestroyed', (e) => losses[e.faction]++);
    this.battle = { game, seed, factions, controls, losses };
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
      const left = Math.ceil(VICTORY_PAUSE - (game.world.time - outcome.time));
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
    const winner = game.outcome?.winner;
    this.bannerShownFor = game;
    this.banner.replaceChildren(
      el('div', { class: 'title' }, winner === null || winner === undefined ? 'Mutual destruction' : `${factions[winner].name} wins`),
      el('div', { class: 'next' }),
    );
    if (winner !== null && winner !== undefined) {
      this.banner.style.setProperty('--accent', `#${factions[winner].primary.toString(16).padStart(6, '0')}`);
    }
    this.banner.hidden = false;
  }

  private hudText(): string {
    const { game, factions, losses, seed } = this.battle;
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
    const lines = factions.map(
      (f) =>
        `${f.name}: ${alive[f.id]} units, ${conquest ? `${producers[f.id]} production left` : `${buildings[f.id]} buildings`}, ${losses[f.id]} lost`,
    );
    return (
      `${lines.join('\n')}\n` +
      `${conquest ? 'Conquest' : 'Eternal'} · seed ${seed} · ${Math.round(this.fps)} fps\n` +
      `WASD / right-drag pan · wheel zoom · Q/E rotate · 1-4 speed · space pause`
    );
  }

  private writeUrl(settings: BattleSettings): void {
    const query = settingsToParams(settings).toString();
    history.replaceState(null, '', query ? `?${query}` : location.pathname);
  }
}
