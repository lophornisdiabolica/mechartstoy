import { describe, expect, it } from 'vitest';
import { Armed, Faction, GARRISON, Guard, Health, Mover, OutpostPart, Producer, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { buildOutpost, capture, garrisonSystem, outpostBonus } from '../src/game/outposts';
import { Rng } from '../src/core/rng';
import { BattleSettings, defaultFaction, defaultSettings, outpostCount } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { holdsOutposts } from '../src/game/systems/ai';
import { attackNumber } from '../src/game/tide';
import { UNIT_DEFS } from '../src/game/units';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function settings(outposts: number | 'auto', sides = 2): BattleSettings {
  const s = defaultSettings();
  s.map.outposts = outposts;
  s.factions = Array.from({ length: sides }, (_, i) => defaultFaction(i));
  return s;
}

/** A game with just outposts (no bases, no production), to test capturing in isolation. */
function bareGame(seed = 4): Game {
  const game = new Game(seed, { settings: settings(2), populate: false, autoSpawn: false });
  const rng = new Rng(1);
  for (const o of game.ctx.outposts) buildOutpost(game.world, game.ctx, o, rng);
  return game;
}

/** Units of a side standing in an outpost's capture ring. */
function squadAt(game: Game, faction: number, x: number, z: number, n: number): number[] {
  game.setStance(faction, 'hold');
  return Array.from({ length: n }, (_, i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, faction, x + (i % 3) * 2 - 2, z + Math.floor(i / 3) * 2 + 3));
}

/** Knock out an outpost's towers so a test squad can stand in it. */
function disarm(game: Game, outpost: number): void {
  for (const e of game.world.query(OutpostPart, Armed)) if (game.world.req(e, OutpostPart).outpost === outpost) game.world.req(e, Health).hp = 0;
}

describe('outposts', () => {
  it('places the number asked for (auto: one per side), apart, on contested ground the bases can reach', () => {
    expect(outpostCount(settings('auto', 3))).toBe(3);
    for (const [sides, count] of [[2, 2], [2, 4], [4, 4], [6, 6]]) {
      for (const seed of [1, 2, 3]) {
        const game = new Game(seed, { settings: settings(count, sides), populate: false, autoSpawn: false });
        const { field, nav } = game.ctx;
        expect(field.outpostSites.length).toBe(count);
        for (const o of field.outpostSites) {
          expect(field.isWater(o.x, o.z)).toBe(false);
          for (const b of field.baseSites) {
            expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeGreaterThan(b.radius + o.radius + 8);
            expect(nav.connected(o, b)).toBe(true);
          }
          for (const p of field.outpostSites) if (p !== o) expect(Math.hypot(o.x - p.x, o.z - p.z)).toBeGreaterThan(o.radius * 2 + 6);
        }
      }
    }
  });

  it('with two sides, outposts sit about as far from either base', () => {
    for (const seed of [1, 2, 3, 8]) {
      const game = new Game(seed, { settings: settings(2), populate: false, autoSpawn: false });
      const [a, b] = game.field.baseSites;
      for (const o of game.field.outpostSites) {
        const da = Math.hypot(o.x - a.x, o.z - a.z);
        const db = Math.hypot(o.x - b.x, o.z - b.z);
        expect(Math.abs(da - db) / Math.min(da, db)).toBeLessThan(0.45);
      }
    }
  });

  it("adding outposts doesn't move the bases or the town", () => {
    const none = new Game(7, { settings: settings(0), populate: false, autoSpawn: false }).field;
    const some = new Game(7, { settings: settings(3), populate: false, autoSpawn: false }).field;
    expect(some.baseSites).toEqual(none.baseSites);
    expect(some.townSites).toEqual(none.townSites);
    expect(none.outpostSites).toEqual([]);
  });

  it('starts held by a garrison that fights every side', () => {
    const game = new Game(5, { settings: settings(2) });
    const { sides } = game.ctx;
    for (const o of game.ctx.outposts) expect(o.owner).toBe(GARRISON);
    expect(sides.hostile(GARRISON, 0)).toBe(true);
    expect(sides.hostile(1, GARRISON)).toBe(true);
    expect(sides.hostile(GARRISON, GARRISON)).toBe(false);
    expect(sides.hostile(GARRISON, -1)).toBe(false);
    // Towers are armed, and the bunker turns out guards.
    const parts = [...game.world.query(OutpostPart, Faction)];
    expect(parts.filter((e) => game.world.has(e, Armed)).length).toBe(2 * game.ctx.outposts.length);
    run(game, 15);
    const guards = [...game.world.query(Guard, Faction)];
    expect(guards.length).toBeGreaterThan(0);
    for (const e of guards) expect(game.world.req(e, Faction).id).toBe(GARRISON);
    // Outposts aren't production: they don't keep a side alive in Conquest.
    for (const e of parts) expect(game.world.has(e, Producer)).toBe(false);
  });

  it('a side takes an undefended outpost by standing in it, and its buildings switch sides', () => {
    const game = bareGame();
    const o = game.ctx.outposts[0];
    const events: string[] = [];
    game.events.on('outpostCaptured', (e) => events.push(`${e.outpost}:${e.previous}>${e.faction}`));
    disarm(game, 0);
    run(game, 1);
    squadAt(game, 0, o.x, o.z, 4);
    run(game, 3);
    expect(o.claimant).toBe(0);
    expect(o.progress).toBeGreaterThan(0);
    run(game, 25);
    expect(o.owner).toBe(0);
    expect(events).toEqual([`0:${GARRISON}>0`]);
    for (const e of game.world.query(OutpostPart, Faction)) {
      if (game.world.req(e, OutpostPart).outpost === 0) expect(game.world.req(e, Faction).id).toBe(0);
    }
    expect(game.stats.sides[0].captured).toBe(1);
  });

  it('a contested or defended outpost does not change hands', () => {
    const game = bareGame();
    const o = game.ctx.outposts[0];
    disarm(game, 0);
    run(game, 1);
    squadAt(game, 0, o.x, o.z, 3);
    squadAt(game, 1, o.x + 1, o.z - 1, 3);
    // Keep both squads alive so it stays contested.
    for (const e of game.world.query(Unit, Health)) game.world.req(e, Health).armor = 1;
    run(game, 30);
    expect(o.owner).toBe(GARRISON);
    expect(o.progress).toBe(0);

    const held = bareGame(6);
    const p = held.ctx.outposts[1];
    capture(held.world, held.ctx, p, 1);
    disarm(held, 1);
    run(held, 1);
    squadAt(held, 1, p.x, p.z, 1); // one defender is enough
    squadAt(held, 0, p.x + 1, p.z - 1, 5);
    for (const e of held.world.query(Unit, Health)) held.world.req(e, Health).armor = 1;
    run(held, 30);
    expect(p.owner).toBe(1);
  });

  it("holding outposts speeds up production, scaled by the bonus setting; a knocked-out side's revert", () => {
    const game = new Game(3, { settings: settings(3), populate: false, autoSpawn: false });
    const { ctx } = game;
    expect(outpostBonus(ctx, 0, 'production')).toBe(0);
    for (const o of ctx.outposts) capture(game.world, ctx, o, 0);
    const production = ctx.outposts.filter((o) => o.bonus.kind === 'production').reduce((s, o) => s + o.bonus.amount, 0);
    expect(production).toBeGreaterThan(0);
    expect(outpostBonus(ctx, 0, 'production')).toBeCloseTo(production);
    ctx.settings.armies.outpostBonus = 2;
    expect(outpostBonus(ctx, 0, 'production')).toBeCloseTo(production * 2);
    expect(outpostBonus(ctx, 1, 'production')).toBe(0);
    ctx.settings.armies.outpostBonus = 0;
    expect(outpostBonus(ctx, 0, 'production')).toBe(0);

    ctx.sides.eliminate(0, 1);
    run(game, 0.5);
    for (const o of ctx.outposts) expect(o.owner).toBe(GARRISON);
  });

  it('a repair outpost heals its holder’s units nearby', () => {
    const game = bareGame(2);
    const o = game.ctx.outposts[0];
    o.bonus = { kind: 'repair', amount: 0.05 };
    capture(game.world, game.ctx, o, 0);
    const [tank] = squadAt(game, 0, o.x, o.z, 1);
    const h = game.world.req(tank, Health);
    h.hp = h.max * 0.5;
    run(game, 2);
    expect(h.hp).toBeGreaterThan(h.max * 0.55);
  });

  it('squads picked to hold an outpost on their lane go there between attacks', () => {
    const s = settings(2);
    s.armies.outpostHold = 0.5;
    const game = new Game(4, { settings: s, populate: false, autoSpawn: false });
    const { ctx } = game;
    game.setStance(0, 'hold');
    const attack = attackNumber(0, ctx.sides.phase[0], ctx.tide);
    const target = ctx.sides.target(0, attack)!;
    const routes = ctx.lanes.routes(0, target);
    // Find a squad the lane plan sends through an outpost.
    let squad = 0;
    while (routes[ctx.lanes.laneFor(0, target, attack, squad, ctx.settings.armies.flanking)].via?.kind !== 'outpost' || !holdsOutposts(squad, 0.5)) squad++;
    const via = routes[ctx.lanes.laneFor(0, target, attack, squad, ctx.settings.armies.flanking)].via!;
    const outpost = ctx.outposts[via.index];
    const base = game.field.baseSites[0];
    const unit = spawnUnit(game.world, ctx, UNIT_DEFS.tank, 0, base.x, base.z, squad);
    game.step(DT);
    const mover = game.world.req(unit, Mover);
    expect(Math.hypot(mover.targetX! - outpost.x, mover.targetZ! - outpost.z)).toBeLessThan(14);
  });

  it('a besieged bunker sends out no guards until the ring is clear', () => {
    const game = bareGame();
    const o = game.ctx.outposts[0];
    // bareGame leaves out the spawning systems, so run the garrison by hand.
    const garrison = garrisonSystem(game.ctx);
    const run = (seconds: number) => {
      for (let i = 0; i < seconds / DT; i++) {
        game.step(DT);
        garrison.update(game.world, DT);
      }
    };
    const guards = () => [...game.world.query(Guard)].filter((e) => game.world.req(e, Guard).outpost === 0).length;
    disarm(game, 0);
    const [tank] = squadAt(game, 1, o.x, o.z, 1);
    game.world.req(tank, Health).armor = 1;
    game.world.remove(tank, Armed);
    // Long enough for a couple of guards, short of the tank taking the outpost.
    run(20);
    expect(o.owner).toBe(GARRISON);
    expect(guards()).toBe(0);
    game.world.destroy(tank);
    run(15);
    expect(guards()).toBeGreaterThan(0);
  });

  it('outpost settings round-trip through the link', () => {
    const s = settings(5);
    s.armies.outpostBonus = 1.5;
    s.armies.outpostHold = 0.4;
    const p = settingsToParams(s);
    expect(p.get('outposts')).toBe('5');
    expect(p.get('obonus')).toBe('1.5');
    const back = settingsFromParams(new URLSearchParams(p.toString()));
    expect(back.map.outposts).toBe(5);
    expect(back.armies.outpostBonus).toBe(1.5);
    expect(back.armies.outpostHold).toBe(0.4);
    expect(p.get('ohold')).toBe('0.4');
    expect(settingsToParams(defaultSettings()).get('outposts')).toBeNull();
    expect(settingsFromParams(new URLSearchParams('outposts=99')).map.outposts).toBe(12);
    expect(settingsFromParams(new URLSearchParams('outposts=junk')).map.outposts).toBe('auto');
  });
});
