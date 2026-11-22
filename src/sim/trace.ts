import { Faction, GARRISON, Guard, NEUTRAL, Transform, Unit } from '../game/components';
import { Game, SIM_HZ } from '../game/game';
import { hillOf, hillTimeLeft, teamHeld } from '../game/hill';
import { fightingStrength } from '../game/offensive';
import { BattleSettings, factionDefs } from '../game/settings';
import { hashSeed } from '../core/rng';
import * as D from '../core/dmath';
import { settingsFromParams } from '../ui/settingsUrl';
import { TIME_LIMIT } from './simulate';

/**
 * A battle traced from its link (`npm run sims -- --trace LINK`): it plays
 * the battle the link shows, as the page would, and writes down what each
 * Commander is up to every so often (its plan, what it's waiting for, where
 * its army is), plus the moments in between when a plan changes, an outpost
 * changes hands or the hill's clock moves on. For "why did the AI do that?":
 * a standoff, an army that never left home, an attack that went nowhere.
 */

/** How near a base or the hill an army has to be to count as there. */
const AT_BASE = 40;
const AT_HILL = 24;

export interface TraceOptions {
  /** Seconds between snapshots. */
  every?: number;
  /** Stop at this many minutes, if the battle hasn't ended (default: the sims' time limit). */
  minutes?: number;
}

/** The settings and seed a battle link (a whole address or just its query) shows. */
export function linkSettings(link: string): BattleSettings {
  const query = link.includes('?') ? link.slice(link.indexOf('?') + 1) : link;
  const settings = settingsFromParams(new URLSearchParams(query.split('#')[0]));
  if (!settings.seed) throw new Error('That link has no seed=, so there is no battle to replay');
  return settings;
}

/** Play the battle a link shows and describe it as it goes (see the notes above). */
export function traceBattle(link: string, options: TraceOptions = {}): string {
  const settings = linkSettings(link);
  const every = Math.max(1, options.every ?? 30);
  const limit = (options.minutes ?? TIME_LIMIT) * 60;
  const game = new Game(hashSeed(settings.seed), { settings });
  const { ctx, world } = game;
  const sides = ctx.sides;
  const names = factionDefs(settings).map((d) => d.name);
  const side = (f: number) => (f >= 0 && f < names.length ? names[f] : f === GARRISON ? 'its garrison' : f === NEUTRAL ? 'nobody' : `side ${f}`);
  const teamName = (team: number) => sides.teams.flatMap((t, f) => (t === team ? [names[f]] : [])).join(' + ');
  const lines: string[] = [];
  const clock = () => {
    const t = Math.floor(world.time);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  const note = (text: string) => lines.push(`  ${clock()}  ${text}`);

  lines.push(`Tracing seed ${settings.seed}: ${settings.mode}, ${settings.map.size} map, ${names.map((n, f) => `${n} (${settings.factions[f].doctrine}, team ${settings.factions[f].team + 1})`).join(' v ')}.`);
  game.events.on('outpostCaptured', (e) => note(`${side(e.faction)} took ${ctx.outposts[e.outpost]?.kind.id === 'hill' ? 'the hill' : `outpost ${e.outpost}`} from ${side(e.previous)}`));
  game.events.on('sideEliminated', (e) => note(`${side(e.faction)} is out`));
  game.events.on('unitDestroyed', (e) => {
    if (e.def.category === 'super' && e.faction >= 0) note(`${side(e.faction)} lost its ${e.def.name}`);
  });
  game.events.on('hillClock', (e) => note(`${side(e.faction)} is ${e.left} s from holding the hill`));
  game.events.on('hillAllIn', (e) => note(`${teamName(sides.teams[e.faction])} goes all in for the hill (${Math.round(e.left)} s left on the enemy's clock)`));
  game.events.on('hillHeld', (e) => note(`${side(e.faction)} held the hill`));

  // A plan's state, as the HUD would put it.
  const planOf = (team: number): string => {
    const lead = sides.standing().find((f) => sides.teams[f] === team);
    if (lead === undefined) return 'out';
    const p = ctx.offensive.plan(lead);
    if (ctx.offensive.allIn(lead)) return 'all in';
    if (settings.armies.attackTiming === 'tide') return ctx.offensive.attacking(lead, world.time) ? 'attacking (tide)' : 'waiting (tide)';
    if (p.state === 'massing') return `massing ${Math.round(p.ready * 100)}%`;
    return p.state;
  };
  const lastPlan = new Map<number, string>();

  const snapshot = () => {
    lines.push('');
    const hill = hillOf(ctx);
    const head = [`${clock()}`];
    if (hill) {
      const held = sides.teamList.map((t) => `${teamName(t)} ${Math.round(teamHeld(ctx, t))} s`).join(', ');
      head.push(`hill: ${hill.owner >= 0 ? `held by ${side(hill.owner)}` : 'nobody'}${ctx.hill?.contested ? ', contested' : ''} (${held})`);
    }
    lines.push(head.join('  '));
    for (const team of sides.teamList) {
      const members = sides.teams.flatMap((t, f) => (t === team ? [f] : []));
      const lead = sides.standing().find((f) => sides.teams[f] === team);
      const p = lead !== undefined ? ctx.offensive.plan(lead) : null;
      const target = lead !== undefined ? sides.target(lead, ctx.offensive.attack(lead, world.time)) : null;
      const bits = [planOf(team)];
      if (p && p.need > 0 && p.state === 'massing') bits.push(`army ${Math.round(p.army)} of ${Math.round(p.need)} needed`);
      if (target !== null && !hill) bits.push(`next target ${side(target)}`);
      if (hill && lead !== undefined) {
        const left = hillTimeLeft(ctx, lead);
        if (left < Infinity) bits.push(`enemy wins in ${Math.round(left)} s if unchallenged`);
      }
      lines.push(`  ${teamName(team)}: ${bits.join(', ')}`);
      for (const f of members) {
        if (sides.eliminated[f]) {
          lines.push(`    ${names[f]}: out`);
          continue;
        }
        const where = { home: 0, hill: 0, enemy: 0, field: 0 };
        let units = 0;
        let strength = 0;
        let guards = 0;
        for (const e of world.query(Unit, Faction, Transform)) {
          if (world.req(e, Faction).id !== f) continue;
          if (world.has(e, Guard)) {
            guards++;
            continue;
          }
          units++;
          strength += fightingStrength(world, e);
          const t = world.req(e, Transform);
          const home = ctx.field.baseSites[f];
          if (D.hypot(t.x - home.x, t.z - home.z) < AT_BASE) where.home++;
          else if (hill && D.hypot(t.x - hill.x, t.z - hill.z) < AT_HILL) where.hill++;
          else if (ctx.field.baseSites.some((b, g) => sides.hostile(f, g) && !sides.eliminated[g] && D.hypot(t.x - b.x, t.z - b.z) < AT_BASE)) where.enemy++;
          else where.field++;
        }
        const s = game.stats.sides[f];
        const at = Object.entries(where)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${k === 'enemy' ? 'at an enemy base' : k === 'home' ? 'home' : k === 'hill' ? 'on the hill' : 'in the field'}`)
          .join(', ');
        const extra = [sides.underAttack(f) ? 'base under attack' : '', sides.recalling[f] ? 'recalling the army' : '', guards ? `${guards} outpost guards` : ''].filter(Boolean);
        lines.push(`    ${names[f]}: ${units} units (strength ${Math.round(strength)}): ${at || 'none'}; ${s.kills} kills, ${s.lost} lost, ${ctx.outposts.filter((o) => o.owner === f).length} outposts${extra.length ? `; ${extra.join(', ')}` : ''}`);
      }
    }
  };

  const dt = 1 / SIM_HZ;
  let next = 0;
  let checkPlans = 0;
  while (game.outcome === null && world.time < limit) {
    game.step(dt);
    if (world.time >= checkPlans) {
      checkPlans = world.time + 1;
      for (const team of sides.teamList) {
        // Plan changes as they happen (not the massing percentage creeping up).
        const now = planOf(team).replace(/ \d+%$/, '');
        const was = lastPlan.get(team);
        if (was !== undefined && was !== now) note(`${teamName(team)}: ${was} → ${now}`);
        lastPlan.set(team, now);
      }
    }
    if (world.time >= next) {
      next += every;
      snapshot();
    }
  }
  snapshot();
  lines.push('');
  const o = game.outcome;
  lines.push(o ? (o.team !== null ? `${teamName(o.team)} won after ${clock()}.` : `Nobody won (all out) after ${clock()}.`) : `No winner by ${clock()}.`);
  return lines.join('\n');
}
