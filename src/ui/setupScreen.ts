import { AttackTiming, BaseLayout, BattleMode, SuperGrowth, BattleSettings, cloneSettings, compactTeams, placementsInUse, defaultFaction, defaultSettings, LIMITS, MAP_SIZES, MapSize, MAX_FACTIONS, TOWN_SIZES, TownSize, tunedUnits, UNIT_IDS, UnitTuning } from '../game/settings';
import { BIOME_IDS, BIOMES, BiomeId } from '../world/biomes';
import { OUTPOST_KIND_IDS } from '../world/battlefield';
import { OUTPOST_KINDS } from '../game/outposts';
import { MapPreview } from './mapPreview';
import { RAMP_INTERVAL, RAMP_MAX } from '../game/tide';
import { UNIT_DEFS, UnitDef } from '../game/units';
import { DOCTRINE_IDS, DOCTRINES, isDoctrine } from '../game/doctrines';
import { isStyle, STYLE_IDS, STYLES } from '../game/commander/advice';
import { dropdown, el, hex, segmented } from './dom';
import { Rng } from '../core/rng';
import { MAP_STYLES, rollBattle, VARIETY_AFTER, VARIETY_KEYS, VarietyKey, VarietyTeams } from '../game/variety';

const VARIETY_LABELS: Record<VarietyKey, { label: string; title: string }> = {
  size: { label: 'Map size', title: 'Small, medium or large, sometimes wider or deeper than usual' },
  biome: { label: 'Biome', title: 'Temperate, desert, snow or forest' },
  style: { label: 'Map style', title: 'Water, hills, dense forest and towns together, from one of the map styles' },
  sides: { label: 'Sides', title: 'How many sides, and how they split into teams' },
  doctrines: { label: 'Doctrines', title: 'Which doctrine each side fields, from the ones picked below' },
};

const MODE_HINTS: Record<BattleMode, string> = {
  eternal: 'Ruined buildings are rebuilt and the war goes on forever.',
  conquest: 'No rebuilding. A side loses when its HQ and every production building are destroyed, then a fresh map is generated.',
};

const TIMING_HINTS: Record<AttackTiming, string> = {
  readiness: 'Each side masses at home until its army is strong enough to break the enemy base, attacks, and falls back to regroup once the attack is spent. The longer a side waits, the less sure of winning it needs to be.',
  tide: 'Sides attack on the tide’s clock, taking turns: each attacks while its production surges, whatever shape its army is in.',
};

const GROWTH_HINTS: Record<SuperGrowth, string> = {
  none: 'Super units (Titans) are rare: each side can have this many, and its Mech Bay is slow.',
  tide: 'Super units (Titans) are rare: each side starts with room for this many, and the tide ramp raises it as the battle goes on, up to 3× when the ramp tops out.',
  outposts: 'Super units (Titans) are rare: each side has room for this many, plus one more for every outpost it holds past the first.',
};

const STAT_LABELS: Record<keyof UnitTuning, string> = { hp: 'HP', damage: 'Damage', speed: 'Speed', range: 'Range' };

const RAMP_HINTS: Record<BattleMode, string> = {
  eternal: `Escalation every ${RAMP_INTERVAL / 60} minutes, levelling off at ${RAMP_MAX + 1}×. Tide ramp makes production surges swing harder; siege ramp makes hits on buildings land harder. Off keeps the war at a steady pace.`,
  conquest: `Escalation every ${RAMP_INTERVAL / 60} minutes, levelling off at ${RAMP_MAX + 1}×, so long battles build to a finish. Tide ramp makes production surges swing harder; siege ramp makes hits on buildings land harder. Both off gives the steadier pacing (and longer battles).`,
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
  hp: (d) => ({ text: short(d.hp), title: `${short(d.hp)} hit points${d.armor > 0 ? `, armour ${d.armor} (taken off every hit)` : ''}` }),
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
  /** The per-side rows, rebuilt when sides are added or removed. */
  private sideList!: HTMLElement;
  private sideSync: (() => void)[] = [];

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
    if (this.sideList && this.sideSync.length !== this.settings.factions.length) this.rebuildSides();
    for (const s of this.sync) s();
    for (const s of this.sideSync) s();
  }

  /** One row per side: colour, name, team, remove. */
  private rebuildSides(): void {
    this.sideList.replaceChildren();
    this.sideSync = this.settings.factions.map((_, i) => {
      const row = el('div', { class: 'side' });
      const color = el('input', { type: 'color', 'aria-label': `Side ${i + 1} colour` });
      const name = el('input', { type: 'text', maxlength: '32', 'aria-label': `Side ${i + 1} name` });
      const team = el('select', { 'aria-label': `Side ${i + 1} team` });
      const doctrine = el('select', { 'aria-label': `Side ${i + 1} doctrine` });
      doctrine.append(...DOCTRINE_IDS.map((d) => el('option', { value: d, title: DOCTRINES[d].blurb }, DOCTRINES[d].name)));
      const style = el('select', { 'aria-label': `Side ${i + 1} Commander style`, title: 'How its Commander plays' });
      style.append(...STYLE_IDS.map((k) => el('option', { value: k, title: STYLES[k].blurb }, STYLES[k].name)));
      style.addEventListener('change', () => {
        if (isStyle(style.value)) this.settings.factions[i].style = style.value;
        this.changed();
      });
      const remove = el('button', { type: 'button', class: 'remove', title: 'Remove this side', 'aria-label': `Remove side ${i + 1}` }, '×');
      color.addEventListener('input', () => {
        this.settings.factions[i].color = parseInt(color.value.slice(1), 16);
        this.callbacks.change(cloneSettings(this.settings));
      });
      name.addEventListener('input', () => {
        this.settings.factions[i].name = name.value;
        this.callbacks.change(cloneSettings(this.settings));
      });
      team.addEventListener('change', () => {
        this.settings.factions[i].team = Number(team.value);
        this.changed();
      });
      doctrine.addEventListener('change', () => {
        if (isDoctrine(doctrine.value)) this.settings.factions[i].doctrine = doctrine.value;
        this.changed();
      });
      remove.addEventListener('click', () => {
        if (this.settings.factions.length <= 2) return;
        this.settings.factions.splice(i, 1);
        this.settings.map.placed.bases = null;
        compactTeams(this.settings);
        this.rebuildSides();
        this.changed();
      });
      row.append(color, name, doctrine, style, team, remove);
      this.sideList.append(row);
      return () => {
        const n = this.settings.factions.length;
        const f = this.settings.factions[i];
        color.value = hex(f.color);
        if (document.activeElement !== name) name.value = f.name;
        if (team.options.length !== n) team.replaceChildren(...Array.from({ length: n }, (_, t) => el('option', { value: String(t) }, `Team ${t + 1}`)));
        team.value = String(f.team);
        doctrine.value = f.doctrine;
        doctrine.title = DOCTRINES[f.doctrine].blurb;
        style.value = f.style;
        style.title = `${STYLES[f.style].name}: ${STYLES[f.style].blurb}`;
        remove.disabled = n <= 2;
      };
    });
  }

  private build(): void {
    const card = el('div', { class: 'card' });
    const head = el('header');
    head.append(el('h1', {}, 'Mech Battle Toy'), el('p', {}, 'Set up a battle. Everything here is saved in the page link, so you can share a setup.'));
    const body = el('div', { class: 'body' });
    card.append(head, body);
    this.root.append(card);

    // Each section folds away; which ones are open is remembered on this device.
    const section = (title: string, open: boolean) => {
      const s = el('details', { class: 'section' });
      const key = `mbt.setup.open.${title}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved !== null) open = saved === '1';
      } catch {
        // Storage can be unavailable (private windows, blocked site data); the default is fine.
      }
      s.open = open;
      s.addEventListener('toggle', () => {
        try {
          localStorage.setItem(key, s.open ? '1' : '0');
        } catch {
          // As above.
        }
      });
      const summary = el('summary');
      summary.append(el('h2', {}, title));
      s.append(summary);
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
    const battle = section('Battle', true);
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

    // The seed box, used here and again under the placement map.
    const seedControl = (parent: HTMLElement) => {
      const wrap = el('div', { class: 'inline' });
      const seed = el('input', { type: 'text', placeholder: 'random', maxlength: '40', spellcheck: 'false', 'aria-label': 'Seed' });
      seed.addEventListener('input', () => {
        this.settings.seed = seed.value.trim();
        // Not a full refresh, which would rewrite this box while it's typed in, but the other seed box and the map follow.
        this.refresh();
        this.callbacks.change(cloneSettings(this.settings));
      });
      const reroll = el('button', { type: 'button', title: 'Roll a new seed' }, 'Roll');
      reroll.addEventListener('click', () => {
        this.settings.seed = randomSeed();
        this.changed();
      });
      const clear = el('button', { type: 'button', title: 'A new map every time' }, 'Clear');
      clear.addEventListener('click', () => {
        this.settings.seed = '';
        this.changed();
      });
      wrap.append(seed, reroll, clear);
      row(parent, 'Seed', wrap);
      this.sync.push(() => {
        if (document.activeElement !== seed) seed.value = this.settings.seed;
        clear.disabled = this.settings.seed === '';
      });
    };
    seedControl(battle);
    battle.append(el('p', { class: 'hint' }, 'The same seed and settings always make the same map. Leave it empty for a new map every time.'));

    // Between battles: what to re-roll for every battle after the first.
    const variety = section('Between battles', false);
    // A row of toggle chips; `min` keeps at least that many on.
    const chips = <T extends string>(parent: HTMLElement, label: string, items: { id: T; label: string; title: string }[], get: () => T[], set: (on: T[]) => void, min: number) => {
      const box = el('div', { class: 'inline kinds' });
      const buttons = items.map((item) => {
        const b = el('button', { type: 'button', class: 'chip', title: item.title, 'aria-pressed': 'false' }, item.label);
        b.addEventListener('click', () => {
          const on = get();
          const next = on.includes(item.id) ? on.filter((x) => x !== item.id) : items.map((x) => x.id).filter((x) => x === item.id || on.includes(x));
          if (next.length < min) return;
          set(next);
          this.changed();
        });
        box.append(b);
        return b;
      });
      row(parent, label, box);
      this.sync.push(() =>
        buttons.forEach((b, i) => {
          const on = get().includes(items[i].id);
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        }),
      );
    };
    chips(
      variety,
      'Re-roll',
      VARIETY_KEYS.map((k) => ({ id: k, ...VARIETY_LABELS[k] })),
      () => VARIETY_KEYS.filter((k) => this.settings.variety.roll[k]),
      (on) => VARIETY_KEYS.forEach((k) => (this.settings.variety.roll[k] = on.includes(k))),
      0,
    );
    variety.append(
      el(
        'p',
        { class: 'hint' },
        `The battle you start uses the settings as they are here. Every battle after it re-rolls what’s picked, and keeps the rest. Map styles: ${MAP_STYLES.map((m) => m.label).join(', ')}.`,
      ),
    );
    const sideCounts = Array.from({ length: MAX_FACTIONS - 1 }, (_, i) => ({ label: String(i + 2), value: i + 2 }));
    const fewest = dropdown(sideCounts, (v) => {
      this.settings.variety.sidesMin = v;
      this.settings.variety.sidesMax = Math.max(v, this.settings.variety.sidesMax);
      this.changed();
    }, 'Fewest sides');
    const most = dropdown(sideCounts, (v) => {
      this.settings.variety.sidesMax = v;
      this.settings.variety.sidesMin = Math.min(v, this.settings.variety.sidesMin);
      this.changed();
    }, 'Most sides');
    const range = el('div', { class: 'inline range' });
    range.append(fewest.row, el('span', {}, 'to'), most.row);
    row(variety, 'Sides', range);
    const teams = segmented<VarietyTeams>(
      [
        { label: 'Free-for-all', value: 'ffa', title: 'Every side for itself' },
        { label: 'Two teams', value: 'two', title: 'Sides dealt alternately into two teams' },
        { label: 'Either', value: 'either', title: 'Free-for-all or two teams, at random' },
      ],
      (v) => {
        this.settings.variety.teams = v;
        this.changed();
      },
    );
    row(variety, 'Teams', teams.row);
    this.sync.push(() => {
      const v = this.settings.variety;
      fewest.set(v.sidesMin);
      most.set(v.sidesMax);
      teams.set(v.teams);
      for (const c of [fewest.row, most.row, ...teams.row.querySelectorAll('button')]) (c as HTMLButtonElement | HTMLSelectElement).disabled = !v.roll.sides;
    });
    chips(
      variety,
      'Doctrine pool',
      DOCTRINE_IDS.map((d) => ({ id: d, label: DOCTRINES[d].name, title: DOCTRINES[d].blurb })),
      () => this.settings.variety.doctrines,
      (on) => (this.settings.variety.doctrines = on),
      1,
    );
    variety.append(
      el(
        'p',
        { class: 'hint' },
        'Re-rolled doctrines are drawn from the pool, each once before any comes up twice. A side with a standard name takes the name and colours that go with its new doctrine. New sides past the ones listed under Sides get the standard ones.',
      ),
    );
    const after = dropdown(
      VARIETY_AFTER.map((m) => ({ label: m === 0 ? 'Never (play to the end)' : `After ${m} minutes`, value: m })),
      (v) => {
        this.settings.variety.after = v;
        this.changed();
      },
      'Move on to a new battle',
    );
    row(variety, 'Move on', after.row);
    this.sync.push(() => after.set(this.settings.variety.after));
    const rollNow = el('button', { type: 'button', title: 'Re-roll what’s picked into the settings here now, to see or start one' }, 'Roll now');
    rollNow.addEventListener('click', () => {
      this.settings = rollBattle(this.settings, new Rng(Math.floor(Math.random() * 2 ** 32))).settings;
      this.changed();
    });
    const rollRow = el('div', { class: 'inline' });
    rollRow.append(rollNow);
    variety.append(rollRow, el('p', { class: 'hint' }, 'Move on ends a battle that’s still going after that long (an Eternal war never ends by itself), so the toy can be left running. Roll now re-rolls what’s picked into the settings here, to look at or start.'));
    this.sync.push(() => (rollNow.disabled = !VARIETY_KEYS.some((k) => this.settings.variety.roll[k])));

    // Map
    const map = section('Map', false);
    const size = segmented<MapSize>(
      (Object.keys(MAP_SIZES) as MapSize[]).map((k) => ({ label: MAP_SIZES[k].label, value: k })),
      (v) => {
        this.settings.map.size = v;
        this.changed();
      },
    );
    row(map, 'Size', size.row);
    this.sync.push(() => size.set(this.settings.map.size));
    slider(map, 'Shape', 'shape', 0.05, (s) => s.map.shape, (s, v) => (s.map.shape = v), (v) => (Math.abs(v - 1) < 0.01 ? 'Standard' : v > 1 ? `Wider ${times(v)}` : `Deeper ${times(1 / v)}`));
    const biome = segmented<BiomeId>(
      BIOME_IDS.map((b) => ({ label: BIOMES[b].label, value: b })),
      (v) => {
        this.settings.map.biome = v;
        this.changed();
      },
    );
    row(map, 'Biome', biome.row);
    this.sync.push(() => biome.set(this.settings.map.biome));
    map.append(el('p', { class: 'hint' }, 'The look of the land, its trees and its towns. It doesn’t change how anything moves.'));
    const layout = segmented<BaseLayout>(
      [
        { label: 'Ring', value: 'ring', title: 'Round the edge of the map, allies side by side' },
        { label: 'Allies apart', value: 'apart', title: 'Round the edge of the map, allies spread out between their enemies' },
        { label: 'Lines', value: 'lines', title: 'Teams face each other from opposite ends of the map' },
      ],
      (v) => {
        this.settings.map.layout = v;
        this.settings.map.placed.bases = null;
        this.changed();
      },
    );
    row(map, 'Bases', layout.row);
    this.sync.push(() => layout.set(this.settings.map.layout));
    slider(map, 'Water', 'water', 0.05, (s) => s.map.water, (s, v) => (s.map.water = v), (v) => (v === 0 ? 'None' : percent(v)));
    const ways = el('input', { type: 'checkbox', 'aria-label': 'Waterways' });
    ways.addEventListener('change', () => {
      this.settings.map.waterways = ways.checked;
      this.changed();
    });
    const waysLabel = el('label', { class: 'check' });
    waysLabel.append(ways, document.createTextNode(' Join the bases’ water with channels and bridges'));
    row(map, 'Waterways', waysLabel);
    this.sync.push(() => (ways.checked = this.settings.map.waterways));
    map.append(el('p', { class: 'hint' }, 'Channels link the water near the bases so boats can reach each other, and from 60% water every base gets a harbour. Bridges carry the roads over.'));
    slider(map, 'Dense forest', 'forest', 0.05, (s) => s.map.forest, (s, v) => (s.map.forest = v), (v) => (v === 0 ? 'None' : percent(v)));
    const scrap = el('input', { type: 'checkbox', 'aria-label': 'Scrap' });
    scrap.addEventListener('change', () => {
      this.settings.map.scrap = scrap.checked;
      this.changed();
    });
    const scrapLabel = el('label', { class: 'check' });
    scrapLabel.append(scrap, document.createTextNode(' Wrecks pile up into scrap'));
    row(map, 'Scrap', scrapLabel);
    this.sync.push(() => (scrap.checked = this.settings.map.scrap));
    map.append(
      el(
        'p',
        { class: 'hint' },
        'Dense forest is big trees that stop shots, so infantry find cover in it, and slow vehicles down until they knock the trees flat; fighting clears it. Where enough vehicles are wrecked, the ground turns to scrap, which slows tracks and hovers until it’s cleared away a few minutes later.',
      ),
    );
    slider(map, 'Hills', 'hills', 0.05, (s) => s.map.hills, (s, v) => (s.map.hills = v), (v) => (v === 0 ? 'Flat' : times(v)));
    const towns = segmented<number>(
      Array.from({ length: LIMITS.towns.max + 1 }, (_, i) => ({ label: i === 0 ? 'None' : String(i), value: i })),
      (v) => {
        this.settings.map.towns = v;
        this.settings.map.placed.towns = null;
        this.changed();
      },
    );
    row(map, 'Towns', towns.row);
    this.sync.push(() => towns.set(this.settings.map.towns));
    const townSize = segmented<TownSize>(
      (Object.keys(TOWN_SIZES) as TownSize[]).map((k) => ({ label: TOWN_SIZES[k].label, value: k })),
      (v) => {
        this.settings.map.townSize = v;
        this.changed();
      },
    );
    row(map, 'Town size', townSize.row);
    this.sync.push(() => townSize.set(this.settings.map.townSize));

    // Armies
    const armies = section('Armies', false);
    slider(armies, 'Infantry cap', 'infantryCap', 5, (s) => s.armies.caps.infantry, (s, v) => (s.armies.caps.infantry = v), (v) => `${v} each`);
    slider(armies, 'Vehicle cap', 'vehicleCap', 1, (s) => s.armies.caps.vehicle, (s, v) => (s.armies.caps.vehicle = v), (v) => (v === 0 ? 'None' : `${v} each`));
    slider(armies, 'Aircraft cap', 'airCap', 1, (s) => s.armies.caps.air, (s, v) => (s.armies.caps.air = v), (v) => (v === 0 ? 'None' : `${v} each`));
    slider(armies, 'Super units', 'superCap', 1, (s) => s.armies.caps.super, (s, v) => (s.armies.caps.super = v), (v) => (v === 0 ? 'None' : `${v} each`));
    const growth = segmented<SuperGrowth>(
      [
        { label: 'Fixed', value: 'none' },
        { label: 'Tide ramp', value: 'tide' },
        { label: 'Outposts', value: 'outposts' },
      ],
      (v) => {
        this.settings.armies.superGrowth = v;
        this.changed();
      },
    );
    row(armies, 'Super cap grows', growth.row);
    const growthHint = el('p', { class: 'hint' });
    armies.append(growthHint);
    this.sync.push(() => {
      growth.set(this.settings.armies.superGrowth);
      growthHint.textContent = GROWTH_HINTS[this.settings.armies.superGrowth];
    });
    const gate = el('input', { type: 'checkbox', 'aria-label': 'Super units need an outpost' });
    gate.addEventListener('change', () => {
      this.settings.armies.superGate = gate.checked;
      this.changed();
    });
    const gateLabel = el('label', { class: 'check' });
    gateLabel.append(gate, document.createTextNode(' Only while holding an outpost'));
    row(armies, 'Super units', gateLabel);
    armies.append(el('p', { class: 'hint' }, 'With outposts on the map, a side can only build super units while it holds one. Off by default: the first side to attack tends to take the outposts, and with them every Titan.'));
    this.sync.push(() => (gate.checked = this.settings.armies.superGate));
    slider(armies, 'Production', 'production', 0.05, (s) => s.armies.production, (s, v) => (s.armies.production = v), times);
    slider(armies, 'Starting army', 'startingArmy', 1, (s) => s.armies.startingArmy, (s, v) => (s.armies.startingArmy = v), (v) => (v === 0 ? 'None' : `${v} groups`));
    slider(armies, 'Building HP', 'buildingHp', 0.05, (s) => s.armies.buildingHp, (s, v) => (s.armies.buildingHp = v), times);
    const timing = segmented<AttackTiming>(
      [
        { label: 'When ready', value: 'readiness' },
        { label: 'On the tide', value: 'tide' },
      ],
      (v) => {
        this.settings.armies.attackTiming = v;
        this.changed();
      },
    );
    row(armies, 'Attacks', timing.row);
    const timingHint = el('p', { class: 'hint' });
    armies.append(timingHint);
    this.sync.push(() => {
      timing.set(this.settings.armies.attackTiming);
      timingHint.textContent = TIMING_HINTS[this.settings.armies.attackTiming];
    });
    slider(armies, 'Tide swing', 'tideStrength', 0.05, (s) => s.armies.tideStrength, (s, v) => (s.armies.tideStrength = v), (v) => (v === 0 ? 'Steady' : percent(v)));
    slider(armies, 'Tide length', 'tidePeriod', 10, (s) => s.armies.tidePeriod, (s, v) => (s.armies.tidePeriod = v), (v) => `${v}s`);
    armies.append(el('p', { class: 'hint' }, 'The tide swings each side’s production up and down in turn. Swing is how far; length is one full cycle.'));
    slider(armies, 'Flanking', 'flanking', 0.05, (s) => s.armies.flanking, (s, v) => (s.armies.flanking = v), (v) => (v === 0 ? 'None' : percent(v)));
    armies.append(el('p', { class: 'hint' }, 'Share of squads sent down the other lanes instead of straight down the middle: through outposts and towns, or swinging wide where there are none.'));
    slider(armies, 'Build advice', 'advice', 0.05, (s) => s.armies.advice, (s, v) => (s.armies.advice = v), (v) => (v === 0 ? 'Off' : `±${percent(v)}`));
    armies.append(el('p', { class: 'hint' }, 'How far each side’s Commander leans production toward what the battle needs, within its doctrine: more flak against aircraft (fewer with none about), harder hitters against armour, more that sprays against infantry. Each side’s style (next to its doctrine under Sides) sets how it plays: cautious keeps together and waits for a clear edge, aggressive attacks sooner, a raider sends small forces far afield and builds fast units.'));
    slider(armies, 'Engineers', 'engineers', 1, (s) => s.armies.engineers, (s, v) => (s.armies.engineers = v), (v) => (v === 0 ? 'Off' : `${v} per side`));
    armies.append(el('p', { class: 'hint' }, 'Each side’s HQ trains up to this many engineers, who put up short walls in front of where its army masses, with a field tower behind them (two at most). Walls stop shots like any building; walls crumble after ten minutes and towers after fifteen.'));
    const avoid = el('input', { type: 'checkbox', 'aria-label': 'Units avoid danger' });
    avoid.addEventListener('change', () => {
      this.settings.armies.avoidance = avoid.checked;
      this.changed();
    });
    const avoidLabel = el('label', { class: 'check' });
    avoidLabel.append(avoid, document.createTextNode(' Keep out of where they’re weak'));
    row(armies, 'Squads', avoidLabel);
    armies.append(el('p', { class: 'hint' }, 'Each Commander maps how dangerous the field is to infantry, vehicles and aircraft. Squads take the lane least dangerous to them, and on the march swing round ground they’d be outgunned on: infantry round artillery, aircraft round flak.'));
    this.sync.push(() => (avoid.checked = this.settings.armies.avoidance));
    // Each mode keeps its own ramps: Conquest ramps by default, Eternal doesn't.
    const ramped = (v: number) => (v === 0 ? 'Off' : `+${percent(v)}`);
    slider(armies, 'Tide ramp', 'ramp', 0.05, (s) => s.armies.ramp[s.mode].tide, (s, v) => (s.armies.ramp[s.mode].tide = v), ramped);
    slider(armies, 'Siege ramp', 'ramp', 0.05, (s) => s.armies.ramp[s.mode].siege, (s, v) => (s.armies.ramp[s.mode].siege = v), ramped);
    const rampHint = el('p', { class: 'hint' });
    armies.append(rampHint);
    this.sync.push(() => (rampHint.textContent = RAMP_HINTS[this.settings.mode]));

    // Outposts
    const outposts = section('Outposts', false);
    const counts: { label: string; value: number | 'auto' }[] = [
      { label: 'Auto (one per side)', value: 'auto' },
      { label: 'None', value: 0 },
      ...Array.from({ length: LIMITS.outposts.max }, (_, i) => ({ label: String(i + 1), value: i + 1 })),
    ];
    const count = dropdown(
      counts,
      (v) => {
        this.settings.map.outposts = v;
        this.settings.map.placed.outposts = null;
        this.changed();
      },
      'Number of outposts',
    );
    row(outposts, 'Outposts', count.row);
    this.sync.push(() => count.set(this.settings.map.outposts));
    // Which kinds of outpost the map deals out: a toggle per kind, at least one on.
    const kindBox = el('div', { class: 'inline kinds' });
    const kindButtons = OUTPOST_KIND_IDS.map((k) => {
      const b = el('button', { type: 'button', class: 'chip', title: OUTPOST_KINDS[k].blurb, 'aria-pressed': 'false' }, OUTPOST_KINDS[k].name);
      b.addEventListener('click', () => {
        const on = this.settings.map.outpostKinds.includes(k);
        const next = on ? this.settings.map.outpostKinds.filter((x) => x !== k) : OUTPOST_KIND_IDS.filter((x) => x === k || this.settings.map.outpostKinds.includes(x));
        if (next.length === 0) return;
        this.settings.map.outpostKinds = next;
        this.changed();
      });
      kindBox.append(b);
      return b;
    });
    row(outposts, 'Kinds', kindBox);
    this.sync.push(() =>
      kindButtons.forEach((b, i) => {
        const on = this.settings.map.outpostKinds.includes(OUTPOST_KIND_IDS[i]);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }),
    );
    slider(outposts, 'Bonus', 'outpostBonus', 0.05, (s) => s.armies.outpostBonus, (s, v) => (s.armies.outpostBonus = v), (v) => (v === 0 ? 'None' : times(v)));
    slider(outposts, 'Holding', 'outpostHold', 0.05, (s) => s.armies.outpostHold, (s, v) => (s.armies.outpostHold = v), (v) => (v === 0 ? 'Off' : percent(v)));
    slider(outposts, 'Task forces', 'taskForces', 0.05, (s) => s.armies.taskForces, (s, v) => (s.armies.taskForces = v), (v) => (v === 0 ? 'Off' : `up to ${percent(v)}`));
    outposts.append(
      el(
        'p',
        { class: 'hint' },
        'Small forts in no-man’s land with their own towers and guards, who fight everyone. A side takes one by getting units into it while nobody defends it, and it counts as the holder’s territory, where resting units heal and squads refill. Each kind gives its holder something more: a supply depot and a fuel depot speed up production (+10% at 1×), an airstrip makes room for 2 more aircraft, a comms relay (off by default) makes attacks set out sooner and spots for the guns, a hilltop gun shells the holder’s enemies, and a ruined factory turns out the odd vehicle. The map deals out the kinds that are on, the gun going to the highest outpost. Attacks take the outposts on their way. Holding keeps that share of the squads on an outpost’s lane there between attacks, which leaves bases thinner and battles shorter. Task forces let each side’s Commander send up to that share of its army, between attacks, to take outposts it can beat the defence at, or to save its own outposts from capture.',
      ),
    );

    // Placement: a map to drag the bases, towns and outposts round.
    const placement = section('Placement', false);
    const preview = new MapPreview((kind, spots) => {
      this.settings.map.placed[kind] = spots;
      this.changed();
    });
    const auto = el('button', { type: 'button' }, 'Place everything automatically');
    auto.addEventListener('click', () => {
      this.settings.map.placed = { bases: null, towns: null, outposts: null };
      this.changed();
    });
    const placedNote = el('span', { class: 'value' });
    const autoRow = el('div', { class: 'inline' });
    autoRow.append(auto, placedNote);
    placement.append(preview.root);
    seedControl(placement);
    placement.append(autoRow);
    placement.addEventListener('toggle', () => preview.update(cloneSettings(this.settings)));
    this.sync.push(() => {
      preview.update(cloneSettings(this.settings));
      const p = placementsInUse(this.settings);
      const by = [p.bases && 'bases', p.towns && 'towns', p.outposts && 'outposts'].filter(Boolean);
      placedNote.textContent = by.length ? `Placed by hand: ${by.join(', ')}` : 'All placed automatically';
      auto.disabled = by.length === 0;
    });

    // Factions
    // The start button lives in the footer (built below); it's disabled while nobody has an enemy.
    let start: HTMLButtonElement;
    const factions = section('Sides', true);
    const list = el('div', { class: 'sides' });
    const presets = el('div', { class: 'inline presets' });
    const add = el('button', { type: 'button', title: `Up to ${MAX_FACTIONS} sides` }, '+ Add side');
    add.addEventListener('click', () => {
      const n = this.settings.factions.length;
      if (n >= MAX_FACTIONS) return;
      this.settings.factions.push(defaultFaction(n));
      this.settings.map.placed.bases = null;
      this.rebuildSides();
      this.changed();
    });
    const ffa = el('button', { type: 'button', title: 'Every side for itself' }, 'Free-for-all');
    ffa.addEventListener('click', () => {
      this.settings.factions.forEach((f, i) => (f.team = i));
      this.changed();
    });
    const halves = el('button', { type: 'button', title: 'First half of the list against the second half' }, 'Two teams');
    halves.addEventListener('click', () => {
      const n = this.settings.factions.length;
      this.settings.factions.forEach((f, i) => (f.team = i < Math.ceil(n / 2) ? 0 : 1));
      this.changed();
    });
    presets.append(add, ffa, halves);
    const sidesHint = el('p', { class: 'hint' });
    factions.append(list, presets, sidesHint);
    slider(factions, 'Team boost', 'evenTeams', 0.05, (s) => s.armies.evenTeams, (s, v) => (s.armies.evenTeams = v), (v) =>
      v === 0 ? 'Off' : `1 vs 3: ${Math.round(3 ** v * 10) / 10}×`,
    );
    factions.append(
      el(
        'p',
        { class: 'hint' },
        'Evens out uneven teams: a side on a smaller team gets more production and a bigger unit cap. The value shows how much a side alone against three gets. Uneven battles are never quite fair, so tune this if one side keeps winning.',
      ),
    );
    this.sideList = list;
    this.rebuildSides();
    this.sync.push(() => {
      const n = this.settings.factions.length;
      add.disabled = n >= MAX_FACTIONS;
      const teams = new Set(this.settings.factions.map((f) => f.team)).size;
      sidesHint.classList.toggle('warn', teams < 2);
      sidesHint.textContent =
        teams < 2
          ? 'Everyone is on the same team, so there is nobody to fight. Put at least one side on another team.'
          : 'Sides on the same team are allies and start next to each other. More sides make a bigger map. Each side picks a doctrine, the kind of army it fields (hover over one for what it brings).';
      start.disabled = teams < 2;
    });

    // Unit stats
    const units = section('Unit stats', false);
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
    start = el('button', { type: 'button', class: 'primary' }, 'Start battle');
    start.addEventListener('click', () => this.callbacks.start(cloneSettings(this.settings)));
    foot.append(resetAll, start);
    card.append(foot);
  }
}
