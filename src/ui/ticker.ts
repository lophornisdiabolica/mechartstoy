import { GOD, NEUTRAL } from '../game/components';
import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { GameEvents } from '../game/context';
import { el, hex } from './dom';

/** Lines shown at once, and seconds (real time) each stays before fading. */
const MOST = 6;
const STAYS = 24;
/** How near a named place something has to happen to be "at" it. */
const AT_BASE = 26;
const AT_OUTPOST = 14;
const AT_BRIDGE = 8;
const AT_TOWN = 16;

interface Line {
  node: HTMLElement;
  age: number;
}

/**
 * The battle ticker: a quiet feed in a corner of what's happening. Outposts
 * changing hands, super units falling (and where), production buildings
 * razed, attacks setting out, sides knocked out and the end of the battle,
 * in the sides' own colours. It reads the events the page already gets, and
 * the attack plans for when an attack sets out.
 */
export class Ticker {
  readonly root = el('div', { id: 'ticker' });
  private lines: Line[] = [];
  private game: Game | null = null;
  private factions: readonly FactionDef[] = [];
  private attacking: boolean[] = [];
  private enabled = true;

  constructor() {
    document.body.append(this.root);
  }

  get on(): boolean {
    return this.enabled;
  }

  set on(v: boolean) {
    this.enabled = v;
    this.root.hidden = !v;
  }

  /** Follow a new battle (the old one's lines go). */
  attach(game: Game, factions: readonly FactionDef[]): void {
    this.game = game;
    this.factions = factions;
    this.attacking = factions.map(() => false);
    this.lines = [];
    this.strokes.clear();
    this.root.replaceChildren();
    const { events } = game;
    // Events from a battle that's since been replaced are ignored.
    events.on('outpostCaptured', (e) => this.game === game && this.captured(e.outpost, e.faction, e.previous));
    events.on('unitDestroyed', (e) => {
      if (this.game !== game || e.def.category !== 'super') return;
      this.say([this.side(e.faction), `'s ${e.def.name} fell ${this.where(e.x, e.z, e.faction)}`, ...this.by(e.killer)]);
    });
    events.on('buildingDestroyed', (e) => {
      if (this.game !== game || e.faction < 0 || e.faction === NEUTRAL || (!e.def.production && e.def.id !== 'hq')) return;
      const by = e.killer && e.killer.faction >= 0 ? [this.side(e.killer.faction), ' razed '] : ['Down went '];
      this.say([...by, this.side(e.faction), `'s ${e.def.name.toLowerCase()}`]);
    });
    events.on('godUsed', (e) => this.game === game && this.god(e));
    events.on('sideEliminated', (e) => this.game === game && this.say([this.side(e.faction), ' is out of the war']));
    events.on('battleOver', (o) => {
      if (this.game !== game) return;
      if (o.winners.length === 0) return this.say(['Nobody is left standing']);
      const parts: (string | HTMLElement)[] = [];
      o.winners.forEach((f, i) => parts.push(...(i > 0 ? [i === o.winners.length - 1 ? ' and ' : ', '] : []), this.side(f)));
      this.say([...parts, o.winners.length === 1 ? ' wins the battle' : ' win the battle']);
    });
  }

  /** Each frame: attacks setting out, and old lines fading. */
  update(frameSeconds: number): void {
    const game = this.game;
    if (!game) return;
    const { offensive, sides } = game.ctx;
    const time = game.world.time;
    for (let f = 0; f < this.factions.length; f++) {
      const now = !sides.eliminated[f] && offensive.attacking(f, time);
      if (now && !this.attacking[f]) {
        const target = sides.target(f, offensive.attack(f, time));
        if (target !== null) this.say([this.side(f), ' sets out to attack ', this.side(target)]);
      }
      this.attacking[f] = now;
    }
    for (const line of this.lines) {
      line.age += frameSeconds;
      line.node.style.opacity = String(Math.max(0, Math.min(1, (STAYS - line.age) / 4)));
    }
    const gone = this.lines.filter((l) => l.age >= STAYS);
    for (const l of gone) l.node.remove();
    if (gone.length) this.lines = this.lines.filter((l) => l.age < STAYS);
  }

  private captured(index: number, faction: number, previous: number): void {
    const game = this.game!;
    const o = game.ctx.outposts[index];
    if (!o || faction < 0 || faction >= this.factions.length) return;
    const what = `the ${o.kind.name.toLowerCase()}${this.direction(o.x, o.z, ' in the ')}`;
    const from = previous >= 0 && previous < this.factions.length ? [' from ', this.side(previous)] : [];
    this.say([this.side(faction), ` took ${what}`, ...from]);
  }

  /** " to Crimson Host's Lancer", from the killing blow, if a side landed it. */
  private by(killer: { source: string; faction: number } | null): (string | HTMLElement)[] {
    if (killer?.faction === GOD) return [killer.source === 'airstrike' ? ' to an airstrike' : killer.source === 'earthquake' ? ' in the earthquake' : ' to a curse'];
    if (!killer || killer.faction < 0 || killer.faction >= this.factions.length) return [];
    const ctx = this.game!.ctx;
    const def = (ctx.units as Record<string, { name: string }>)[killer.source] ?? (ctx.buildings as Record<string, { name: string }>)[killer.source];
    return [' to ', this.side(killer.faction), def ? `'s ${def.name.toLowerCase()}` : ''];
  }

  /** Where something happened, by the nearest named place: "outside Crimson Host's base", "at the supply depot in the north", "on a bridge", "in the east". */
  private where(x: number, z: number, faction: number): string {
    const game = this.game!;
    const { field, ctx } = game;
    let best = '';
    let bestD = Infinity;
    const consider = (d: number, reach: number, text: string) => {
      if (d <= reach && d / reach < bestD) {
        bestD = d / reach;
        best = text;
      }
    };
    field.baseSites.forEach((b, f) => {
      if (f >= this.factions.length) return;
      consider(Math.hypot(b.x - x, b.z - z), AT_BASE, f === faction ? 'at its own base' : `outside ${this.factions[f].name}'s base`);
    });
    for (const o of ctx.outposts) consider(Math.hypot(o.x - x, o.z - z), AT_OUTPOST, `at the ${o.kind.name.toLowerCase()}${this.direction(o.x, o.z, ' in the ')}`);
    for (const p of ctx.commander.places) {
      if (p.kind === 'bridge') consider(Math.hypot(p.x - x, p.z - z), AT_BRIDGE, 'on a bridge');
      else if (p.kind === 'town') consider(Math.hypot(p.x - x, p.z - z), AT_TOWN, 'in the town');
    }
    return best || this.direction(x, z, 'in the ') || 'in the middle of the map';
  }

  /** "north", "south-west"..., prefixed, or '' near the middle of the map. North is away from the camera's first view (-z). */
  private direction(x: number, z: number, prefix: string): string {
    const { bounds } = this.game!.field;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cz = (bounds.minZ + bounds.maxZ) / 2;
    const dx = (x - cx) / ((bounds.maxX - bounds.minX) / 2);
    const dz = (z - cz) / ((bounds.maxZ - bounds.minZ) / 2);
    if (Math.hypot(dx, dz) < 0.25) return '';
    const names = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
    const k = Math.round(Math.atan2(dz, dx) / (Math.PI / 4));
    return prefix + names[(k + 8) % 8];
  }

  private side(f: number): HTMLElement {
    const d = this.factions[f];
    const span = el('span', { class: 'side' }, d ? d.name : 'Someone');
    if (d) span.style.color = hex(d.primary);
    return span;
  }

  /** The last stroke of each brush, so a stroke of many dabs is one line. */
  private strokes = new Map<string, { time: number; x: number; z: number }>();

  /** A god power, in words: "A heavy airstrike hit outside Crimson Host's base". */
  private god(e: GameEvents['godUsed']): void {
    const p = e.power;
    const where = () => this.where(e.x, e.z, -1);
    switch (p.kind) {
      case 'drop': {
        const def = this.game!.ctx.units[p.unit];
        const what = p.count === 1 ? `A ${def.name}` : `${p.count} ${def.name}s`;
        return this.say([`✦ ${what} dropped from the sky for `, this.side(p.faction), ` ${where()}`]);
      }
      case 'airstrike': {
        const words = { light: 'A light airstrike hit', heavy: 'A heavy airstrike hit', carpet: 'Carpet bombing rained down', big: 'The big one fell' };
        return this.say([`✦ ${words[p.strike]} ${where()}`]);
      }
      case 'quake': {
        const words = { tremor: 'A tremor shook the ground', quake: 'An earthquake struck', cataclysm: 'A cataclysm tore the land apart' };
        return this.say([`✦ ${words[p.quake]} ${where()}`]);
      }
      case 'terrain':
      case 'forest': {
        // A stroke is many dabs: one line for each, unless it's the same brush near the last line's spot.
        const key = `${p.kind}:${p.brush}`;
        const now = this.game!.world.time;
        const last = this.strokes.get(key);
        this.strokes.set(key, { time: now, x: e.x, z: e.z });
        if (last && now - last.time < 6 && Math.hypot(last.x - e.x, last.z - e.z) < 25) return;
        const words = { raise: 'The land rose', lower: 'The ground sank', flatten: 'The ground was levelled', plant: 'A forest sprang up', clear: 'The trees were felled' };
        return this.say([`✦ ${words[p.brush]} ${where()}`]);
      }
      case 'bridge':
        return this.say([`✦ A bridge appeared ${where()}`]);
      case 'wall':
        return this.say([`✦ A wall rose ${where()}`]);
      case 'bless': {
        const words = { production: ' was blessed with faster production', healing: ' was blessed with healing', curse: ' was cursed' };
        return this.say(['✦ ', this.side(p.faction), words[p.blessing]]);
      }
      case 'unbless':
        return this.say(['✦ ', this.side(p.faction), '’s blessings and curses were lifted']);
    }
  }

  private say(parts: (string | HTMLElement)[]): void {
    if (!this.enabled) return;
    const game = this.game!;
    const t = Math.floor(game.world.time);
    const node = el('div', { class: 'line' });
    node.append(el('span', { class: 'time' }, `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`), ' ');
    for (const p of parts) node.append(p);
    this.root.append(node);
    this.lines.push({ node, age: 0 });
    while (this.lines.length > MOST) this.lines.shift()!.node.remove();
  }
}
