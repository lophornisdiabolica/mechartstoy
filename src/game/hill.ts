import { System } from '../core/ecs';
import { Faction, Unit } from './components';
import { SimContext } from './context';
import { CAPTURE_RADIUS, Outpost } from './outposts';

/**
 * King of the hill (the 'hill' battle mode): one outpost on the most
 * contested ground near the middle of the map (see placeHill in
 * battlefield.ts). While a side holds it and no enemy is in its ring, the
 * side's clock runs; the first team whose sides have held it for
 * `armies.hillHold` seconds in all wins. Conquest's rules still apply, so a
 * team can also win by knocking everyone else out.
 *
 * Armies fight for it (see the hill in systems/ai.ts and offensive.ts):
 * attacks go to the hill instead of the enemy base, and a team that holds
 * it keeps its army there between attacks.
 */

/** Seconds between checks. */
const TICK = 0.25;
/** Enemies of the holder this close to the hill stop its clock: a little beyond the capture ring, so a fight at its edge counts. */
export const CONTEST_RADIUS = CAPTURE_RADIUS + 6;
/** Ticker milestones: seconds left on a team's clock worth announcing. */
export const HILL_CALLS = [60, 30];

export interface HillState {
  /** Index of the hill in ctx.outposts. */
  outpost: number;
  /** Seconds each side has held it. A team's time is its sides' times added up. */
  held: number[];
  /** Whether an enemy of the holder is in its ring right now, which stops the clock. */
  contested: boolean;
}

/** The hill's state, for a battle that has one. */
export function createHill(ctx: { outposts: Outpost[] }, sides: number): HillState | null {
  const i = ctx.outposts.findIndex((o) => o.kind.id === 'hill');
  return i < 0 ? null : { outpost: i, held: new Array<number>(sides).fill(0), contested: false };
}

/** The hill itself, if this battle has one. */
export function hillOf(ctx: SimContext): Outpost | null {
  return ctx.hill ? ctx.outposts[ctx.hill.outpost] : null;
}

/** Seconds a team has held the hill, in all. */
export function teamHeld(ctx: Pick<SimContext, 'hill' | 'sides'>, team: number): number {
  if (!ctx.hill) return 0;
  let sum = 0;
  ctx.hill.held.forEach((s, f) => {
    if (ctx.sides.teams[f] === team) sum += s;
  });
  return sum;
}

/**
 * How close an enemy of `side` is to winning on the hill, 0 to 1: the
 * holding team's time as a share of what it needs, if it isn't `side`'s.
 */
export function hillUrgency(ctx: SimContext, side: number): number {
  const hill = hillOf(ctx);
  if (!hill || hill.owner < 0 || ctx.sides.allied(hill.owner, side)) return 0;
  return Math.min(1, teamHeld(ctx, ctx.sides.teams[hill.owner]) / ctx.settings.armies.hillHold);
}

export function hillSystem(ctx: SimContext): System {
  let acc = 0;
  return {
    name: 'hill',
    update(world, dt) {
      const state = ctx.hill;
      if (!state || ctx.outcome) return;
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      const hill = ctx.outposts[state.outpost];
      const owner = hill.owner;
      if (owner < 0) {
        state.contested = false;
        return;
      }
      let contested = false;
      ctx.grid.forEachNear(hill.x, hill.z, CONTEST_RADIUS, (e) => {
        if (contested || !world.has(e, Unit)) return;
        const f = world.req(e, Faction).id;
        if (f >= 0 && ctx.sides.hostile(f, owner)) contested = true;
      });
      state.contested = contested;
      if (contested) return;
      const team = ctx.sides.teams[owner];
      const before = teamHeld(ctx, team);
      state.held[owner] += step;
      const after = teamHeld(ctx, team);
      const goal = ctx.settings.armies.hillHold;
      for (const left of HILL_CALLS) {
        if (goal - before > left && goal - after <= left && goal > left * 2) ctx.events.emit('hillClock', { faction: owner, left });
      }
      if (after < goal) return;
      ctx.outcome = { team, winners: ctx.sides.teams.flatMap((t, f) => (t === team ? [f] : [])), time: world.time };
      ctx.events.emit('hillHeld', { faction: owner, time: world.time });
      ctx.events.emit('battleOver', ctx.outcome);
    },
  };
}
