import { isBoat } from '../game/caps';
import { FactionDef } from '../game/factions';
import { Game, MAX_DROP } from '../game/game';
import {
  BLESSING_AMOUNT,
  BLESSING_SECONDS,
  BlessingKind,
  BlessingStrength,
  BRUSH_RADIUS,
  BrushSize,
  ForestBrush,
  Power,
  QUAKES,
  QuakeId,
  STRIKES,
  StrikeId,
  TerrainBrush,
} from '../game/god';
import { Stance } from '../game/orders';
import { UNIT_IDS } from '../game/settings';
import { UnitCategory, UnitId } from '../game/units';
import { factionColors } from '../render/models';
import { Stage } from '../render/stage';
import { el, hex, segmented } from './dom';

/** What a press on the map does while the god powers tab has a tool picked. */
export type GodTool =
  | { kind: 'spawn'; unit: UnitId }
  | { kind: 'rally' }
  | { kind: 'airstrike'; strike: StrikeId }
  | { kind: 'quake'; quake: QuakeId }
  | { kind: 'terrain'; brush: TerrainBrush }
  | { kind: 'forest'; brush: ForestBrush }
  | { kind: 'bridge' }
  | { kind: 'wall' };

const COUNTS = [1, 3, 6, 12, 25];
/** Seconds between dabs while a brush is held down. */
const DAB_EVERY = 0.12;
/** A press that moves less than this (px) is a click, not a drag. */
const CLICK_SLOP = 6;

const CATEGORY_LABELS: Record<UnitCategory | 'boat', string> = { infantry: 'Infantry', vehicle: 'Vehicles', boat: 'Boats', air: 'Aircraft', super: 'Super units' };
const BLESSINGS: { value: BlessingKind; label: string; title: string }[] = [
  { value: 'production', label: 'Production', title: 'Its factories turn out units faster' },
  { value: 'healing', label: 'Healing', title: 'Its units mend wherever they are, even mid-fight' },
  { value: 'curse', label: 'Curse', title: 'Its units wither away, slowly or fast' },
];
const STRENGTHS: { value: BlessingStrength; label: string }[] = [
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'divine', label: 'Divine' },
];

function blessingTitle(kind: BlessingKind, strength: BlessingStrength): string {
  const a = BLESSING_AMOUNT[kind][strength];
  const s = BLESSING_SECONDS[strength];
  if (kind === 'production') return `+${Math.round(a * 100)}% production for ${s}s`;
  if (kind === 'healing') return `${Math.round(a * 1000) / 10}% of health back a second for ${s}s`;
  return `${Math.round(a * 1000) / 10}% of health lost a second for ${s}s`;
}

/**
 * The god powers tab: a panel of its own beside the battle controls,
 * hidden or shown with its button (or G). Picks a side to act for (drops,
 * orders, blessings) and a tool for the map: drop units (no caps), set a
 * rally point, call an airstrike, start a quake, raise or lower land, plant
 * or clear forest, put down a bridge or a wall. There are no cooldowns.
 * Everything goes through Game's commands, so it works the same with the
 * sim in its worker.
 */
export class GodPanel {
  readonly root = el('div', { id: 'god' });
  readonly toggle = el('button', { type: 'button', id: 'god-toggle', title: 'Show the god powers (G)' }, '✦ God powers');
  private side = 0;
  private count = 1;
  private size: BrushSize = 'medium';
  private blessing: BlessingKind = 'healing';
  private strength: BlessingStrength = 'major';
  tool: GodTool | null = null;
  private readonly sync: (() => void)[] = [];
  private readonly blessList = el('div', { class: 'blessings' });
  private blessTimer = 0;
  /** A press on the map in progress with a tool. */
  private press: { x: number; y: number; start: { x: number; z: number }; last: { x: number; z: number }; level: number; dabAt: number; dragged: boolean } | null = null;
  private hover: { x: number; z: number } | null = null;

  constructor(
    private readonly game: Game,
    private readonly stage: Stage,
    private readonly factions: readonly FactionDef[],
    private readonly toast: (text: string) => void,
    open: boolean,
    private readonly onOpen: (open: boolean) => void,
    signal: AbortSignal,
  ) {
    this.build();
    this.toggle.addEventListener('click', () => this.setOpen(true));
    document.body.append(this.root, this.toggle);
    this.setOpen(open, false);
    this.bindCanvas(stage.renderer.domElement, signal);
    this.refresh();
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean, tell = true): void {
    this.root.hidden = !open;
    this.toggle.hidden = open;
    if (!open) this.setTool(null);
    if (tell) this.onOpen(open);
  }

  dispose(): void {
    this.root.remove();
    this.toggle.remove();
    this.stage.godCursor.hide();
  }

  /** Called every frame: brush strokes held down keep painting, and the blessings list counts down. */
  update(frameSeconds: number): void {
    const p = this.press;
    const t = this.tool;
    if (p && t && (t.kind === 'terrain' || t.kind === 'forest')) {
      p.dabAt -= frameSeconds;
      if (p.dabAt <= 0) {
        p.dabAt = DAB_EVERY;
        this.dab(p.last, p.level);
      }
    }
    this.blessTimer -= frameSeconds;
    if (this.blessTimer <= 0) {
      this.blessTimer = 0.5;
      this.renderBlessings();
    }
    this.drawCursor();
  }

  private sideName(f: number): string {
    return this.factions[f]?.name ?? '';
  }

  private build(): void {
    const header = el('header');
    header.append(el('span', {}, 'God powers'));
    const hide = el('button', { type: 'button', class: 'collapse', title: 'Hide the god powers (G)', 'aria-label': 'Hide the god powers' }, '×');
    hide.addEventListener('click', () => this.setOpen(false));
    header.append(hide);
    const body = el('div', { class: 'body' });
    this.root.append(header, body);
    const section = (title: string, open = true) => {
      const d = el('details', open ? { open: '' } : {});
      d.append(el('summary', {}, title));
      body.append(d);
      return d;
    };
    const toolButton = (label: string, title: string, tool: GodTool, same: (t: GodTool) => boolean) => {
      const b = el('button', { type: 'button', title }, label);
      b.addEventListener('click', () => this.setTool(this.tool && same(this.tool) ? null : tool));
      this.sync.push(() => b.classList.toggle('on', this.tool !== null && same(this.tool)));
      return b;
    };

    // The side drops, orders and blessings are for.
    const sides = el('div', { class: 'sides' });
    this.factions.forEach((f) => {
      const b = el('button', { type: 'button', title: f.name });
      const swatch = el('span', { class: 'swatch' });
      swatch.style.background = hex(factionColors(f.id).primary);
      b.append(swatch, document.createTextNode(f.name.split(' ')[0]));
      b.addEventListener('click', () => {
        this.side = f.id;
        this.refresh();
      });
      sides.append(b);
      this.sync.push(() => b.classList.toggle('on', this.side === f.id));
    });
    const sideBox = el('div', { class: 'side-pick' });
    sideBox.append(el('h3', {}, 'Acting for'), sides);
    body.append(sideBox);

    // Orders
    const orders = section('Orders');
    const stance = segmented<Stance>(
      [
        { label: 'Auto', value: 'auto', title: 'Attack and regroup with the ebb and flow of battle' },
        { label: 'Attack', value: 'attack', title: 'Everyone push into the enemy base' },
        { label: 'Hold', value: 'hold', title: 'Everyone gather at the rally point' },
      ],
      (v) => {
        this.game.setStance(this.side, v);
        this.refresh();
      },
    );
    const rallyRow = el('div', { class: 'row' });
    const setRally = toolButton('Set rally point', 'Click the map to place the rally flag', { kind: 'rally' }, (t) => t.kind === 'rally');
    const clearRally = el('button', { type: 'button', title: 'Back to the usual gathering spot' }, 'Clear');
    clearRally.addEventListener('click', () => {
      this.game.setRally(this.side, null);
      this.refresh();
    });
    rallyRow.append(setRally, clearRally);
    const everyone = el('div', { class: 'row all' });
    for (const [label, s, title] of [
      ['Attack', 'attack', 'Every side pushes at once'],
      ['Hold', 'hold', 'Every side gathers at its rally point'],
      ['Auto', 'auto', 'Hand every side back to its Commander, rally points and all'],
    ] as [string, Stance, string][]) {
      const b = el('button', { type: 'button', title }, label);
      b.addEventListener('click', () => {
        for (const f of this.factions) {
          this.game.setStance(f.id, s);
          if (s === 'auto') this.game.setRally(f.id, null);
        }
        this.refresh();
      });
      everyone.append(b);
    }
    orders.append(stance.row, rallyRow, el('div', { class: 'group' }, 'Every side at once'), everyone);
    this.sync.push(() => {
      const o = this.game.ctx.orders[this.side];
      stance.set(o?.stance ?? 'auto');
      clearRally.disabled = !o?.rally;
    });

    // Bless or curse
    const bless = section('Bless or curse');
    const kinds = segmented(BLESSINGS, (v) => {
      this.blessing = v;
      this.refresh();
    });
    const strengths = segmented(STRENGTHS, (v) => {
      this.strength = v;
      this.refresh();
    });
    const go = el('button', { type: 'button', class: 'wide' });
    go.addEventListener('click', () => {
      if (!this.game.usePower({ kind: 'bless', faction: this.side, blessing: this.blessing, strength: this.strength })) return;
      this.toast(`${this.blessing === 'curse' ? 'Cursed' : 'Blessed'} ${this.sideName(this.side)}`);
      this.blessTimer = 0;
    });
    bless.append(kinds.row, strengths.row, go, this.blessList);
    this.sync.push(() => {
      kinds.set(this.blessing);
      strengths.set(this.strength);
      go.textContent = `${this.blessing === 'curse' ? 'Curse' : 'Bless'} ${this.sideName(this.side).split(' ')[0]}`;
      go.title = blessingTitle(this.blessing, this.strength);
    });

    // Airstrikes
    const strike = section('Airstrike');
    const strikes = el('div', { class: 'grid' });
    for (const id of Object.keys(STRIKES) as StrikeId[]) {
      const def = STRIKES[id];
      strikes.append(toolButton(def.name, `${def.blurb}. ${def.point ? 'Click a spot' : 'Drag a line (or click)'}`, { kind: 'airstrike', strike: id }, (t) => t.kind === 'airstrike' && t.strike === id));
    }
    strike.append(strikes, el('p', { class: 'hint' }, 'Drag along the ground for the bombers to fly. Bombs hit every side.'));

    // Earthquake
    const quake = section('Earthquake');
    const quakes = el('div', { class: 'seg' });
    for (const id of Object.keys(QUAKES) as QuakeId[]) {
      quakes.append(toolButton(QUAKES[id].name, `${QUAKES[id].blurb}. Click the epicentre`, { kind: 'quake', quake: id }, (t) => t.kind === 'quake' && t.quake === id));
    }
    quake.append(quakes);

    // Shape the land
    const land = section('Shape the land');
    const terrain = el('div', { class: 'seg' });
    terrain.append(
      toolButton('Raise', 'Paint a hill or a ridge: hold to keep raising', { kind: 'terrain', brush: 'raise' }, (t) => t.kind === 'terrain' && t.brush === 'raise'),
      toolButton('Lower', 'Dig a valley, or down into a lake', { kind: 'terrain', brush: 'lower' }, (t) => t.kind === 'terrain' && t.brush === 'lower'),
      toolButton('Flatten', 'Level the ground to the height where the stroke started', { kind: 'terrain', brush: 'flatten' }, (t) => t.kind === 'terrain' && t.brush === 'flatten'),
    );
    const forest = el('div', { class: 'seg' });
    forest.append(
      toolButton('Plant forest', 'Grow dense forest: it blocks shots and slows vehicles', { kind: 'forest', brush: 'plant' }, (t) => t.kind === 'forest' && t.brush === 'plant'),
      toolButton('Fell trees', 'Knock the trees down', { kind: 'forest', brush: 'clear' }, (t) => t.kind === 'forest' && t.brush === 'clear'),
    );
    const sizes = segmented<BrushSize>(
      [
        { label: 'Small', value: 'small' },
        { label: 'Medium', value: 'medium' },
        { label: 'Large', value: 'large' },
      ],
      (v) => {
        this.size = v;
        this.refresh();
      },
    );
    const sizeRow = el('div', { class: 'labelled' });
    sizeRow.append(el('span', {}, 'Brush'), sizes.row);
    this.sync.push(() => sizes.set(this.size));
    const build = el('div', { class: 'seg' });
    build.append(
      toolButton('Bridge', 'Drag from shore to shore', { kind: 'bridge' }, (t) => t.kind === 'bridge'),
      toolButton('Wall', 'Drag a line: a wall nobody owns, that blocks a pass until it’s shot down', { kind: 'wall' }, (t) => t.kind === 'wall'),
    );
    land.append(terrain, forest, sizeRow, build, el('p', { class: 'hint' }, 'Hold and drag to paint. Esc puts the tool down.'));

    // Drop units
    const drop = section('Drop units');
    const counts = segmented(
      COUNTS.map((n) => ({ label: `${n}`, value: n, title: n === 1 ? 'One at a time' : `${n} at once, in a ring` })),
      (n) => {
        this.count = n;
        this.refresh();
      },
    );
    const countRow = el('div', { class: 'labelled' });
    countRow.append(el('span', {}, 'How many'), counts.row);
    drop.append(countRow);
    this.sync.push(() => counts.set(this.count));
    const units = this.game.ctx.units;
    const groups = new Map<UnitCategory | 'boat', UnitId[]>();
    for (const id of UNIT_IDS) {
      const def = units[id];
      const key = isBoat(def) ? 'boat' : def.category;
      groups.set(key, [...(groups.get(key) ?? []), id]);
    }
    for (const key of ['infantry', 'vehicle', 'boat', 'air', 'super'] as const) {
      const ids = groups.get(key);
      if (!ids) continue;
      drop.append(el('div', { class: 'group' }, CATEGORY_LABELS[key]));
      const grid = el('div', { class: 'grid' });
      for (const id of ids) grid.append(toolButton(units[id].name, `Drop ${units[id].name}s where you click`, { kind: 'spawn', unit: id }, (t) => t.kind === 'spawn' && t.unit === id));
      drop.append(grid);
    }
    drop.append(el('p', { class: 'hint' }, `Pick a unit, then click the map. Caps don't apply: drop as many as you like (up to ${MAX_DROP} a click).`));
  }

  /** Who's blessed or cursed, and for how much longer. */
  private renderBlessings(): void {
    const now = this.game.world.time;
    const list = this.game.ctx.god.blessings.filter((b) => b.until > now);
    this.blessList.replaceChildren(
      ...list.map((b) => {
        const row = el('div', { class: 'blessing' });
        const swatch = el('span', { class: 'swatch' });
        swatch.style.background = hex(factionColors(b.faction).primary);
        const name = BLESSINGS.find((k) => k.value === b.kind)!.label.toLowerCase();
        row.append(swatch, el('span', { class: 'what' }, `${this.sideName(b.faction).split(' ')[0]}: ${name}, ${Math.ceil(b.until - now)}s`));
        const bar = el('div', { class: 'left' });
        bar.style.width = `${Math.max(0, Math.min(1, (b.until - now) / b.seconds)) * 100}%`;
        bar.classList.toggle('curse', b.kind === 'curse');
        const lift = el('button', { type: 'button', title: 'Lift every blessing and curse on this side' }, 'Lift');
        lift.addEventListener('click', () => {
          this.game.usePower({ kind: 'unbless', faction: b.faction });
          this.blessTimer = 0;
        });
        row.append(lift, bar);
        return row;
      }),
    );
  }

  refresh(): void {
    for (const s of this.sync) s();
    this.stage.renderer.domElement.style.cursor = this.tool ? 'crosshair' : '';
  }

  setTool(tool: GodTool | null): void {
    this.tool = tool;
    this.press = null;
    this.refresh();
  }

  /** The brush or line to draw under the pointer. */
  private drawCursor(): void {
    const t = this.tool;
    const at = this.press?.last ?? this.hover;
    if (!t || !at) {
      this.stage.godCursor.hide();
      return;
    }
    const p = this.press;
    const line = (width: number, color: number) => {
      if (p && p.dragged) this.stage.godCursor.line(p.start.x, p.start.z, p.last.x, p.last.z, width, color);
      else this.stage.godCursor.circle(at.x, at.z, Math.max(1, width / 2), color);
    };
    switch (t.kind) {
      case 'terrain':
        this.stage.godCursor.circle(at.x, at.z, BRUSH_RADIUS[this.size], t.brush === 'raise' ? 0xe8d27a : t.brush === 'lower' ? 0x7ab8e8 : 0xd0d0d0);
        break;
      case 'forest':
        this.stage.godCursor.circle(at.x, at.z, BRUSH_RADIUS[this.size], t.brush === 'plant' ? 0x6cc070 : 0xc08a50);
        break;
      case 'quake':
        this.stage.godCursor.circle(at.x, at.z, QUAKES[t.quake].radius, 0xe07040);
        break;
      case 'airstrike': {
        const def = STRIKES[t.strike];
        if (def.point) this.stage.godCursor.circle(at.x, at.z, def.splash, 0xff5030);
        else line(def.splash * 2 + (def.planes - 1) * 4.5, 0xff5030);
        break;
      }
      case 'bridge':
        line(3, 0xd8d0c0);
        break;
      case 'wall':
        line(1.2, 0xd8d0c0);
        break;
      default:
        this.stage.godCursor.circle(at.x, at.z, 0.8, 0xe8d27a);
    }
  }

  /** Whether the god tab wants this click (so the battle panel doesn't inspect what's under it). */
  get busy(): boolean {
    return this.tool !== null;
  }

  private bindCanvas(canvas: HTMLCanvasElement, signal: AbortSignal): void {
    const ground = (e: PointerEvent) => this.stage.pickGround(e.clientX, e.clientY);
    canvas.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || !this.tool || document.body.classList.contains('photo')) return;
        const p = ground(e);
        if (!p) return;
        this.press = { x: e.clientX, y: e.clientY, start: p, last: p, level: this.game.field.heightAt(p.x, p.z), dabAt: DAB_EVERY, dragged: false };
        const t = this.tool;
        if (t.kind === 'terrain' || t.kind === 'forest') this.dab(p, this.press.level);
      },
      { signal },
    );
    canvas.addEventListener(
      'pointermove',
      (e) => {
        if (!this.tool) return;
        const p = ground(e);
        if (p) this.hover = p;
        const press = this.press;
        if (!press || !p) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= CLICK_SLOP) press.dragged = true;
        const t = this.tool;
        // Brushes paint along the drag, a dab every so often along the way.
        if ((t.kind === 'terrain' || t.kind === 'forest') && Math.hypot(p.x - press.last.x, p.z - press.last.z) > BRUSH_RADIUS[this.size] * 0.4) {
          press.last = p;
          press.dabAt = DAB_EVERY;
          this.dab(p, press.level);
          return;
        }
        if (t.kind !== 'terrain' && t.kind !== 'forest') press.last = p;
      },
      { signal },
    );
    canvas.addEventListener('pointerleave', () => (this.hover = null), { signal });
    const end = (e: PointerEvent) => {
      const press = this.press;
      this.press = null;
      if (!press || e.button !== 0 || !this.tool) return;
      const p = ground(e) ?? press.last;
      this.release(press.start, press.dragged ? p : press.start);
    };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', () => (this.press = null), { signal });
  }

  private dab(p: { x: number; z: number }, level: number): void {
    const t = this.tool;
    if (t?.kind === 'terrain') this.game.usePower({ kind: 'terrain', brush: t.brush, size: this.size, x: p.x, z: p.z, level });
    else if (t?.kind === 'forest') this.game.usePower({ kind: 'forest', brush: t.brush, size: this.size, x: p.x, z: p.z });
  }

  /** A press with a tool ended: from `a` to `b` (the same point for a click). */
  private release(a: { x: number; z: number }, b: { x: number; z: number }): void {
    const t = this.tool;
    if (!t) return;
    const use = (power: Power, fail: string) => {
      if (!this.game.usePower(power)) this.toast(fail);
    };
    switch (t.kind) {
      case 'spawn':
        if (!this.game.spawnUnitAt(t.unit, this.side, b.x, b.z, this.count)) this.toast(`A ${this.game.ctx.units[t.unit].name} can't go there`);
        break;
      case 'rally':
        this.game.setRally(this.side, b);
        this.setTool(null);
        this.toast(`${this.sideName(this.side)} will gather there`);
        break;
      case 'airstrike':
        use({ kind: 'airstrike', strike: t.strike, ax: a.x, az: a.z, bx: b.x, bz: b.z }, 'That’s off the map');
        break;
      case 'quake':
        use({ kind: 'quake', quake: t.quake, x: b.x, z: b.z }, 'That’s off the map');
        break;
      case 'bridge':
        use({ kind: 'bridge', ax: a.x, az: a.z, bx: b.x, bz: b.z }, 'Drag a bridge across water, from shore to shore');
        break;
      case 'wall':
        use({ kind: 'wall', ax: a.x, az: a.z, bx: b.x, bz: b.z }, 'No room for a wall there');
        break;
      case 'terrain':
      case 'forest':
        break;
    }
  }
}
