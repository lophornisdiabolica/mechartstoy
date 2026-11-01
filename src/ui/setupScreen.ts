import { BattleMode, BattleSettings, cloneSettings, defaultSettings, LIMITS, MAP_SIZES, MapSize, tunedUnits, UNIT_IDS, UnitTuning } from '../game/settings';
import { RAMP_INTERVAL, RAMP_MAX } from '../game/tide';
import { UNIT_DEFS, UnitDef } from '../game/units';
import { el, hex, segmented } from './dom';

const MODE_HINTS: Record<BattleMode, string> = {
  eternal: 'Ruined buildings are rebuilt and the war goes on forever.',
  conquest: 'No rebuilding. A side loses when its HQ and every production building are destroyed, then a fresh map is generated.',
};

const STAT_LABELS: Record<keyof UnitTuning, string> = { hp: 'HP', damage: 'Damage', speed: 'Speed', range: 'Range' };

const RAMP_HINTS: Record<BattleMode, string> = {
  eternal: `Escalation: the tide's swing and damage to buildings grow by this much every ${RAMP_INTERVAL / 60} minutes, levelling off at ${RAMP_MAX + 1}×. Off keeps the war at a steady pace.`,
  conquest: `Escalation: the tide's swing and damage to buildings grow by this much every ${RAMP_INTERVAL / 60} minutes, so long battles build to a finish.`,
};

/** Trim to a readable number of digits: 8.6, 45, 520. */
function short(v: number): string {
  return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
}

/** Damage per second, counting bursts. */
function dps(def: UnitDef): number {
  const w = def.weapon;
  return (w.damage * w.burst) / w.cooldown;
}

/** What a stat works out to after its multiplier, for the stats table. */
const STAT_RESULTS: Record<keyof UnitTuning, (def: UnitDef) => { text: string; title: string }> = {
  hp: (d) => ({ text: short(d.hp), title: `${short(d.hp)} hit points` }),
  damage: (d) => ({
    text: `${short(dps(d))}/s`,
    title: `${short(dps(d))} damage per second: ${short(d.weapon.damage)} per shot${d.weapon.burst > 1 ? ` × ${d.weapon.burst}` : ''}, every ${d.weapon.cooldown}s`,
  }),
  speed: (d) => ({ text: short(d.speed), title: `${short(d.speed)} metres per second` }),
  range: (d) => ({ text: `${short(d.weapon.range)}m`, title: `Range ${short(d.weapon.range)} metres` }),
};

function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface SetupCallbacks {
  /** Start a battle with these settings. */
  start(settings: BattleSettings): void;
  /** Settings changed (used to keep the URL up to date). */
  change(settings: BattleSettings): void;
}

/**
 * The pre-battle screen: an overlay that edits a BattleSettings object. The
 * battle behind it keeps running as a backdrop.
 */
export class SetupScreen {
  private settings: BattleSettings;
  private readonly root = el('div', { id: 'setup', role: 'dialog', 'aria-label': 'Battle setup' });
  private readonly sync: (() => void)[] = [];

  constructor(
    initial: BattleSettings,
    private readonly callbacks: SetupCallbacks,
  ) {
    this.settings = cloneSettings(initial);
    this.build();
    document.body.append(this.root);
    this.refresh();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  show(settings?: BattleSettings): void {
    if (settings) this.settings = cloneSettings(settings);
    this.root.hidden = false;
    this.refresh();
  }

  hide(): void {
    this.root.hidden = true;
  }

  private changed(): void {
    this.refresh();
    this.callbacks.change(cloneSettings(this.settings));
  }

  private refresh(): void {
    for (const s of this.sync) s();
  }

  private build(): void {
    const card = el('div', { class: 'card' });
    const head = el('header');
    head.append(el('h1', {}, 'Mech Battle Toy'), el('p', {}, 'Set up a battle. Everything here is saved in the page link, so you can share a setup.'));
    const body = el('div', { class: 'body' });
    card.append(head, body);
    this.root.append(card);

    const section = (title: string) => {
      const s = el('section');
      s.append(el('h2', {}, title));
      body.append(s);
      return s;
    };
    const row = (parent: HTMLElement, label: string, control: HTMLElement, value?: HTMLElement) => {
      const r = el('div', { class: 'field' });
      r.append(el('span', { class: 'label' }, label), control);
      if (value) r.append(value);
      parent.append(r);
    };
    const slider = (
      parent: HTMLElement,
      label: string,
      limit: keyof typeof LIMITS,
      step: number,
      get: (s: BattleSettings) => number,
      set: (s: BattleSettings, v: number) => void,
      format: (v: number) => string,
    ) => {
      const { min, max } = LIMITS[limit];
      const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), 'aria-label': label });
      const value = el('span', { class: 'value' });
      input.addEventListener('input', () => {
        set(this.settings, Number(input.value));
        this.changed();
      });
      row(parent, label, input, value);
      this.sync.push(() => {
        input.value = String(get(this.settings));
        value.textContent = format(get(this.settings));
      });
    };
    const times = (v: number) => `${Math.round(v * 100) / 100}×`;
    const percent = (v: number) => `${Math.round(v * 100)}%`;

    // Battle
    const battle = section('Battle');
    const mode = segmented<BattleMode>(
      [
        { label: 'Eternal', value: 'eternal' },
        { label: 'Conquest', value: 'conquest' },
      ],
      (v) => {
        this.settings.mode = v;
        this.changed();
      },
    );
    row(battle, 'Mode', mode.row);
    const modeHint = el('p', { class: 'hint' });
    battle.append(modeHint);
    this.sync.push(() => {
      mode.set(this.settings.mode);
      modeHint.textContent = MODE_HINTS[this.settings.mode];
    });

    const seedWrap = el('div', { class: 'inline' });
    const seed = el('input', { type: 'text', placeholder: 'random', maxlength: '40', spellcheck: 'false', 'aria-label': 'Seed' });
    seed.addEventListener('input', () => {
      this.settings.seed = seed.value.trim();
      this.callbacks.change(cloneSettings(this.settings));
    });
    const reroll = el('button', { type: 'button', title: 'Roll a new seed' }, 'Roll');
    reroll.addEventListener('click', () => {
      this.settings.seed = randomSeed();
      this.changed();
    });
    seedWrap.append(seed, reroll);
    row(battle, 'Seed', seedWrap);
    battle.append(el('p', { class: 'hint' }, 'The same seed and settings always make the same map. Leave it empty for a new map every time.'));
    this.sync.push(() => {
      if (document.activeElement !== seed) seed.value = this.settings.seed;
    });

    // Map
    const map = section('Map');
    const size = segmented<MapSize>(
      (Object.keys(MAP_SIZES) as MapSize[]).map((k) => ({ label: MAP_SIZES[k].label, value: k })),
      (v) => {
        this.settings.map.size = v;
        this.changed();
      },
    );
    row(map, 'Size', size.row);
    this.sync.push(() => size.set(this.settings.map.size));
    slider(map, 'Water', 'water', 0.05, (s) => s.map.water, (s, v) => (s.map.water = v), (v) => (v === 0 ? 'None' : percent(v)));
    slider(map, 'Hills', 'hills', 0.05, (s) => s.map.hills, (s, v) => (s.map.hills = v), (v) => (v === 0 ? 'Flat' : times(v)));
    const town = el('input', { type: 'checkbox', 'aria-label': 'Civilian town' });
    town.addEventListener('change', () => {
      this.settings.map.town = town.checked;
      this.changed();
    });
    const townLabel = el('label', { class: 'check' });
    townLabel.append(town, document.createTextNode(' Civilian town in the middle'));
    row(map, 'Town', townLabel);
    this.sync.push(() => (town.checked = this.settings.map.town));

    // Armies
    const armies = section('Armies');
    slider(armies, 'Unit cap', 'unitCap', 5, (s) => s.armies.unitCap, (s, v) => (s.armies.unitCap = v), (v) => `${v} each`);
    slider(armies, 'Production', 'production', 0.05, (s) => s.armies.production, (s, v) => (s.armies.production = v), times);
    slider(armies, 'Starting army', 'startingArmy', 1, (s) => s.armies.startingArmy, (s, v) => (s.armies.startingArmy = v), (v) => (v === 0 ? 'None' : `${v} groups`));
    slider(armies, 'Building HP', 'buildingHp', 0.05, (s) => s.armies.buildingHp, (s, v) => (s.armies.buildingHp = v), times);
    slider(armies, 'Tide swing', 'tideStrength', 0.05, (s) => s.armies.tideStrength, (s, v) => (s.armies.tideStrength = v), (v) => (v === 0 ? 'Steady' : percent(v)));
    slider(armies, 'Tide length', 'tidePeriod', 10, (s) => s.armies.tidePeriod, (s, v) => (s.armies.tidePeriod = v), (v) => `${v}s`);
    armies.append(el('p', { class: 'hint' }, 'The tide makes the sides take turns attacking. Swing is how strongly production surges; length is one full cycle.'));
    slider(armies, 'Flanking', 'flanking', 0.05, (s) => s.armies.flanking, (s, v) => (s.armies.flanking = v), (v) => (v === 0 ? 'None' : percent(v)));
    armies.append(el('p', { class: 'hint' }, 'Share of squads that swing wide down the sides of the map instead of attacking straight down the middle.'));
    // One slider, but each mode keeps its own value: Conquest ramps by default, Eternal doesn't.
    slider(armies, 'Ramp', 'ramp', 0.05, (s) => s.armies.ramp[s.mode], (s, v) => (s.armies.ramp[s.mode] = v), (v) => (v === 0 ? 'Off' : `+${percent(v)}`));
    const rampHint = el('p', { class: 'hint' });
    armies.append(rampHint);
    this.sync.push(() => (rampHint.textContent = RAMP_HINTS[this.settings.mode]));

    // Factions
    const factions = section('Factions');
    this.settings.factions.forEach((_, i) => {
      const wrap = el('div', { class: 'inline' });
      const color = el('input', { type: 'color', 'aria-label': `Side ${i + 1} colour` });
      const name = el('input', { type: 'text', maxlength: '32', 'aria-label': `Side ${i + 1} name` });
      color.addEventListener('input', () => {
        this.settings.factions[i].color = parseInt(color.value.slice(1), 16);
        this.callbacks.change(cloneSettings(this.settings));
      });
      name.addEventListener('input', () => {
        this.settings.factions[i].name = name.value;
        this.callbacks.change(cloneSettings(this.settings));
      });
      wrap.append(color, name);
      row(factions, i === 0 ? 'West' : 'East', wrap);
      this.sync.push(() => {
        color.value = hex(this.settings.factions[i].color);
        if (document.activeElement !== name) name.value = this.settings.factions[i].name;
      });
    });

    // Unit stats
    const units = section('Unit stats');
    const table = el('table', { class: 'stats' });
    const headRow = el('tr');
    headRow.append(el('th'));
    for (const k of Object.keys(STAT_LABELS) as (keyof UnitTuning)[]) headRow.append(el('th', {}, STAT_LABELS[k]));
    table.append(headRow);
    const { min, max } = LIMITS.unitStat;
    let tuned = tunedUnits(this.settings);
    this.sync.push(() => (tuned = tunedUnits(this.settings)));
    for (const id of UNIT_IDS) {
      const tr = el('tr');
      tr.append(el('th', {}, UNIT_DEFS[id].name));
      for (const k of Object.keys(STAT_LABELS) as (keyof UnitTuning)[]) {
        const td = el('td');
        const input = el('input', { type: 'number', min: String(min), max: String(max), step: '0.05', 'aria-label': `${UNIT_DEFS[id].name} ${STAT_LABELS[k]} multiplier` });
        input.addEventListener('change', () => {
          const v = Math.round(Number(input.value) * 100) / 100;
          this.settings.units[id][k] = Number.isFinite(v) && v > 0 ? Math.max(min, Math.min(max, v)) : 1;
          this.changed();
        });
        const result = el('span', { class: 'result' });
        td.append(input, result);
        tr.append(td);
        this.sync.push(() => {
          input.value = String(this.settings.units[id][k]);
          input.classList.toggle('changed', this.settings.units[id][k] !== 1);
          const r = STAT_RESULTS[k](tuned[id]);
          result.textContent = r.text;
          result.title = r.title;
          result.classList.toggle('changed', this.settings.units[id][k] !== 1);
        });
      }
      table.append(tr);
    }
    const resetUnits = el('button', { type: 'button' }, 'Reset unit stats');
    resetUnits.addEventListener('click', () => {
      this.settings.units = defaultSettings().units;
      this.changed();
    });
    units.append(el('p', { class: 'hint' }, 'Multipliers on each unit’s normal stats, in steps of 0.05. 1 is as designed. The number under each box is what the stat works out to (damage is per second).'), table, resetUnits);

    // Footer
    const foot = el('footer');
    const resetAll = el('button', { type: 'button' }, 'Reset all');
    resetAll.addEventListener('click', () => {
      this.settings = defaultSettings();
      this.changed();
    });
    const start = el('button', { type: 'button', class: 'primary' }, 'Start battle');
    start.addEventListener('click', () => this.callbacks.start(cloneSettings(this.settings)));
    foot.append(resetAll, start);
    card.append(foot);
  }
}
