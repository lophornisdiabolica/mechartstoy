import { Armed, Faction, Unit } from '../game/components';
import { FactionDef } from '../game/factions';
import { Game } from '../game/game';
import { fightingStrength } from '../game/offensive';
import { hex } from './dom';

/** Sim seconds between samples. */
const EVERY = 5;
const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 420;
const HEIGHT = 110;

/** One moment of the battle: each side's army strength (see fightingStrength). */
export interface Sample {
  time: number;
  strength: number[];
}

/**
 * Post-battle charts: records each side's army strength through the
 * battle (on the page, from what it shows), and after it ends draws it as
 * a chart for the victory banner, with the turning point (when the winners
 * took the lead in strength for good) and the unit of the battle (the type
 * with the most kills on any side).
 */
export class BattleHistory {
  private samples: Sample[] = [];
  private game: Game | null = null;
  private next = 0;

  /** Start recording a new battle. */
  attach(game: Game): void {
    this.game = game;
    this.samples = [];
    // A battle opened part-way through (the `at` option) starts its chart there.
    this.next = 0;
  }

  /** Each frame: sample when due. */
  update(): void {
    const game = this.game;
    if (!game || game.outcome !== null) return;
    const time = game.world.time;
    if (time < this.next) return;
    this.next = Math.floor(time / EVERY) * EVERY + EVERY;
    this.samples.push({ time, strength: armyStrength(game) });
  }

  /** The chart and its notes, for the banner; null if there's too little to draw. */
  render(factions: readonly FactionDef[]): HTMLElement | null {
    const game = this.game;
    if (!game || this.samples.length < 2) return null;
    const samples = [...this.samples, { time: game.outcome?.time ?? game.world.time, strength: armyStrength(game) }];
    const t0 = samples[0].time;
    const t1 = samples[samples.length - 1].time;
    const top = Math.max(1, ...samples.flatMap((s) => s.strength));
    const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * WIDTH;
    const y = (v: number) => HEIGHT - 4 - (v / top) * (HEIGHT - 8);

    const wrap = document.createElement('div');
    wrap.className = 'chart';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
    svg.setAttribute('width', String(WIDTH));
    svg.setAttribute('height', String(HEIGHT));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Each side’s army strength through the battle');
    const turn = turningPoint(game, samples);
    if (turn !== null && turn > t0) {
      const line = document.createElementNS(SVG, 'line');
      line.setAttribute('x1', String(x(turn)));
      line.setAttribute('x2', String(x(turn)));
      line.setAttribute('y1', '0');
      line.setAttribute('y2', String(HEIGHT));
      line.setAttribute('class', 'turn');
      svg.append(line);
    }
    factions.forEach((f) => {
      const path = document.createElementNS(SVG, 'polyline');
      path.setAttribute('points', samples.map((s) => `${x(s.time).toFixed(1)},${y(s.strength[f.id] ?? 0).toFixed(1)}`).join(' '));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', hex(f.primary));
      path.setAttribute('stroke-width', '2');
      path.setAttribute('stroke-linejoin', 'round');
      svg.append(path);
    });
    const label = document.createElement('div');
    label.className = 'axis';
    label.textContent = `Army strength, ${clock(t0)} to ${clock(t1)}`;
    wrap.append(label, svg);

    const notes: string[] = [];
    const outcome = game.outcome;
    if (outcome && outcome.winners.length > 0) {
      if (turn === null) notes.push('The winners never had the bigger army: they won on the buildings.');
      else if (turn <= t0) notes.push('The winners led in strength from start to finish.');
      else notes.push(`Turning point: ${clock(turn)}, when the winners took the lead for good.`);
    }
    const mvp = unitOfTheBattle(game, factions);
    if (mvp) notes.push(mvp);
    for (const n of notes) {
      const p = document.createElement('div');
      p.className = 'note';
      p.textContent = n;
      wrap.append(p);
    }
    return wrap;
  }
}

/** Each side's army strength now. */
function armyStrength(game: Game): number[] {
  const { world } = game;
  const out = game.ctx.sides.teams.map(() => 0);
  for (const e of world.query(Unit, Faction, Armed)) {
    const f = world.req(e, Faction).id;
    if (f >= 0 && f < out.length) out[f] += fightingStrength(world, e);
  }
  return out;
}

/**
 * When the winning team took the lead in army strength for good: the first
 * sample from which it led every later one. Null if it didn't lead at the
 * end; the first sample's time if it always led.
 */
export function turningPoint(game: Game, samples: Sample[]): number | null {
  const outcome = game.outcome;
  if (!outcome || outcome.winners.length === 0) return null;
  const teams = game.ctx.sides.teams;
  const winTeam = teams[outcome.winners[0]];
  const leads = (s: Sample) => {
    const byTeam = new Map<number, number>();
    s.strength.forEach((v, f) => byTeam.set(teams[f], (byTeam.get(teams[f]) ?? 0) + v));
    const mine = byTeam.get(winTeam) ?? 0;
    for (const [t, v] of byTeam) if (t !== winTeam && v >= mine) return false;
    return true;
  };
  let from: number | null = null;
  for (const s of samples) {
    if (leads(s)) from ??= s.time;
    else from = null;
  }
  return from;
}

/** "Unit of the battle: Cobalt Accord's battle tanks, 85 kills." */
function unitOfTheBattle(game: Game, factions: readonly FactionDef[]): string | null {
  const { stats, ctx } = game;
  let best: { f: number; source: string; kills: number } | null = null;
  for (const f of factions) {
    const b = stats.best(f.id);
    if (b && (!best || b.kills > best.kills)) best = { f: f.id, ...b };
  }
  if (!best || best.kills === 0) return null;
  const def = (ctx.units as Record<string, { name: string }>)[best.source] ?? (ctx.buildings as Record<string, { name: string }>)[best.source];
  const name = def ? def.name : best.source;
  return `Unit of the battle: ${factions[best.f].name}’s ${name}, ${best.kills} kills.`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
