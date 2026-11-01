import { describe, expect, it } from 'vitest';
import { Health } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings, rampFor } from '../src/game/settings';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { applyDamage } from '../src/game/systems/projectiles';
import { escalate, RAMP_INTERVAL, RAMP_MAX, tide } from '../src/game/tide';
import { UNIT_DEFS } from '../src/game/units';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

describe('ramp', () => {
  it('ramps Conquest by default but not Eternal', () => {
    const s = defaultSettings();
    expect(rampFor(s)).toBe(0);
    s.mode = 'conquest';
    expect(rampFor(s)).toBeGreaterThan(0);
  });

  it('escalation grows by the ramp each interval and levels off', () => {
    let level = 0;
    for (let t = 0; t < RAMP_INTERVAL; t += 1) level = escalate(level, 0.5, 1);
    expect(level).toBeCloseTo(0.5, 6);
    for (let t = 0; t < RAMP_INTERVAL * 20; t += 1) level = escalate(level, 0.5, 1);
    expect(level).toBe(RAMP_MAX);
  });

  it('the tide swings harder as the battle escalates, but never stops production', () => {
    const t = { tideStrength: 0.6, tidePeriod: 100 };
    const peak = 25; // a quarter cycle: side 0 at the top of its surge
    expect(tide(peak, 0, t, 0)).toBeCloseTo(1.6);
    expect(tide(peak, 0, t, 1)).toBeCloseTo(2.2);
    expect(tide(peak, 1, t, 1)).toBeGreaterThan(0);
  });

  it('the tide stretches on maps longer than medium', () => {
    const period = (size: 'small' | 'medium' | 'large') => {
      const s = defaultSettings();
      s.map.size = size;
      return new Game(2, { settings: s, populate: false, autoSpawn: false }).ctx.tide.tidePeriod;
    };
    const base = defaultSettings().armies.tidePeriod;
    expect(period('small')).toBe(base);
    expect(period('medium')).toBe(base);
    expect(period('large')).toBeGreaterThan(base * 1.25);
  });

  it('a running Conquest battle escalates, an Eternal one stays level', () => {
    const conquest = defaultSettings();
    conquest.mode = 'conquest';
    const a = new Game(3, { settings: conquest, populate: false });
    run(a, 60);
    expect(a.ctx.escalation).toBeCloseTo((rampFor(conquest) * 60) / RAMP_INTERVAL, 2);
    const b = new Game(3, { populate: false });
    run(b, 60);
    expect(b.ctx.escalation).toBe(0);
  });

  it('escalation makes hits on buildings (not units) land harder', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[1];
    const b = spawnBuilding(game.world, game.ctx, game.ctx.buildings.factory, 1, site.x, site.z, Math.PI);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, site.x + 12, site.z);
    const damageTaken = (e: number) => {
      const h = game.world.req(e, Health);
      const before = h.hp;
      applyDamage(game.world, game.ctx, e, 10);
      return before - h.hp;
    };
    const calmBuilding = damageTaken(b);
    const calmTank = damageTaken(tank);
    game.ctx.escalation = 1;
    expect(damageTaken(b)).toBeCloseTo(calmBuilding * 2);
    expect(damageTaken(tank)).toBeCloseTo(calmTank);
  });

  it('each mode keeps its own ramp in the link', () => {
    const s = defaultSettings();
    s.armies.ramp = { conquest: 0.3, eternal: 0.45 };
    const p = settingsToParams(s);
    expect(p.get('ramp')).toBe('0.3');
    expect(p.get('eramp')).toBe('0.45');
    expect(settingsFromParams(p).armies.ramp).toEqual(s.armies.ramp);
    expect(settingsFromParams(new URLSearchParams('ramp=7')).armies.ramp.conquest).toBe(1);
  });
});

describe('battle stats', () => {
  it('credits kills to the unit type that landed the last blow', () => {
    const game = new Game(11, { populate: false, autoSpawn: false });
    const base = game.field.baseSites[0];
    spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x, base.z);
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, base.x + 8, base.z);
    run(game, 15);
    expect(game.world.isAlive(trooper)).toBe(false);
    const [west, east] = game.stats.sides;
    expect(west.fielded).toBe(1);
    expect(east.fielded).toBe(1);
    expect(west.kills).toBe(1);
    expect(east.lost).toBe(1);
    expect(game.stats.best(0)).toEqual({ source: 'tank', kills: 1 });
    expect(game.stats.best(1)).toBeNull();
  });

  it('counts razed buildings and ignores deaths nobody caused', () => {
    const game = new Game(4, { populate: false, autoSpawn: false });
    const site = game.field.baseSites[1];
    const b = spawnBuilding(game.world, game.ctx, game.ctx.buildings.barracks, 1, site.x, site.z, Math.PI);
    spawnUnit(game.world, game.ctx, UNIT_DEFS.howitzer, 0, site.x - 16, site.z);
    while (game.world.isAlive(b) && game.world.time < 300) game.step(DT);
    expect(game.world.isAlive(b)).toBe(false);
    expect(game.stats.sides[0].razed).toBe(1);
    expect(game.stats.best(0)).toEqual({ source: 'howitzer', kills: 1 });

    const doomed = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, site.x + 20, site.z + 20);
    game.world.req(doomed, Health).hp = 0;
    game.step(DT);
    expect(game.stats.sides[1].lost).toBe(1);
    expect(game.stats.sides[0].kills).toBe(0);
  });
});
