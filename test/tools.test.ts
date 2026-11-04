import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/core/rng';
import { World } from '../src/core/ecs';
import { battlefieldConfig, defaultSettings } from '../src/game/settings';
import { BENCH_CASES, compareBench, runBench } from '../src/sim/bench';
import { pictureFor, settingsFor } from '../src/sim/mapTool';
import { DOCTRINE_IDS } from '../src/game/doctrines';
import { BattleResult, formatLatin, formatProfile, formatSweep, formatTimeline, latinPlans, parseBattleNumbers, parseSeed, runBattle, Scenario, summarizeDoctrines, sweepVariants, TIMELINE_EVERY } from '../src/sim/simulate';
import { parseAt, settingsFromParams } from '../src/ui/settingsUrl';
import { generateBattlefield } from '../src/world/battlefield';
import { groundPicture } from '../src/world/mapPicture';

const short: Scenario = { id: 'test', label: 'Test', battles: 1, quick: 1, setup: (s) => (s.map.size = 'small'), minutes: 1 };

describe('sims tools', () => {
  it('reads battle seeds and battle number lists', () => {
    expect(parseSeed('1v1-small-3')).toMatchObject({ scenario: { id: '1v1-small' }, battle: 3 });
    expect(parseSeed('1v1-12')).toMatchObject({ scenario: { id: '1v1' }, battle: 12 });
    expect(parseSeed('nope-3')).toBeNull();
    expect(parseBattleNumbers('3, 7-9,12,8')).toEqual([3, 7, 8, 9, 12]);
    expect(() => parseBattleNumbers('3,x')).toThrow();
  });

  it('records a timeline and a profile without changing the battle', () => {
    const plain = runBattle(short, 1);
    const traced = runBattle(short, 1, undefined, '', '', { timeline: true, profile: true });
    expect(traced.sides).toEqual(plain.sides);
    expect(plain.timeline).toBeUndefined();
    // A point at the start, every TIMELINE_EVERY seconds, and at the end.
    expect(traced.timeline!.length).toBe(1 + Math.floor((1 * 60) / TIMELINE_EVERY) + 1);
    expect(traced.timeline![0].sides[0].units).toBeGreaterThan(0);
    expect(traced.timeline!.at(-1)!.sides[0].kills).toBe(traced.sides[0].kills);
    expect(Object.keys(traced.profile!)).toEqual(expect.arrayContaining(['movement', 'separation', 'cleanup']));
    // Time adds up in floating point, so the limit can take one more tick.
    expect(Math.abs(traced.ticks! - 60 * 30)).toBeLessThanOrEqual(1);
    expect(formatProfile([traced])).toContain('movement');
    expect(formatTimeline(traced)).toContain('Min');
  }, 30000);

  it('World.profile times each system only while set', () => {
    const w = new World();
    w.addSystem({ name: 'a', update: () => {} });
    w.step(1 / 30);
    expect(w.profile).toBeNull();
    w.profile = new Map();
    w.step(1 / 30);
    expect([...w.profile.keys()]).toEqual(['a', 'cleanup']);
  });
});

describe('bench', () => {
  it('fingerprints the same battle the same way, profiled or not', () => {
    const a = runBench(BENCH_CASES[0], 0.1, true);
    const b = runBench(BENCH_CASES[0], 0.1, false);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.systems?.movement).toBeGreaterThanOrEqual(0);
    expect(compareBench([a], [b])).toContain('same fingerprint');
    expect(compareBench([a], [{ ...b, fingerprint: 'x' }])).toContain('DIFFERENT');
  });
});

describe('map pictures', () => {
  it('draws the same map the game generates, with the bases on it', () => {
    const s = settingsFor('?seed=pic&size=small&sides=3');
    expect(s.factions.length).toBe(3);
    const pic = pictureFor(s, 'pic', 2);
    const field = generateBattlefield(new Rng(hashSeed('pic')).fork(1), battlefieldConfig(s));
    expect(pic.width).toBe(field.config.cols * 2);
    expect(pic.height).toBe(field.config.rows * 2);
    const ground = groundPicture(field);
    // A pixel inside the first base is tinted towards its side's colour, not plain ground.
    const b = field.baseSites[0];
    const i = Math.floor((b.x - field.bounds.minX) / field.config.cellSize);
    const j = Math.floor((b.z - field.bounds.minZ) / field.config.cellSize + 3);
    const k = (j * 2 * pic.width + i * 2) * 4;
    expect([...pic.data.subarray(k, k + 3)]).not.toEqual([...ground.data.subarray((j * ground.width + i) * 4, (j * ground.width + i) * 4 + 3)]);
    // Sims seeds give that battle's settings.
    expect(settingsFor('1v1-small-2').seed).toBe('1v1-small-2');
    expect(defaultSettings().seed).toBe('');
  });
});

describe('opening a battle at a minute', () => {
  it('reads minutes, seconds and minutes:seconds', () => {
    expect(parseAt('25')).toBe(1500);
    expect(parseAt('25m')).toBe(1500);
    expect(parseAt('2.5m')).toBe(150);
    expect(parseAt('90s')).toBe(90);
    expect(parseAt('12:30')).toBe(750);
    expect(parseAt('')).toBeNull();
    expect(parseAt('soon')).toBeNull();
    expect(parseAt('0')).toBeNull();
  });
});

describe('score beyond win or loss', () => {
  it('records each team\'s share of the armies\' strength, and the winners\' margin', () => {
    const quick: Scenario = { id: 'score', label: 'score', battles: 1, quick: 1, minutes: 2, setup: (s) => (s.map.size = 'small') };
    const r = runBattle(quick, 1);
    for (const side of r.sides) {
      expect(side.share).toBeGreaterThanOrEqual(0);
      expect(side.share).toBeLessThanOrEqual(1);
      expect(side.strength).toBeGreaterThanOrEqual(0);
    }
    // Two teams: the shares add up to the whole.
    expect(r.sides[0].share! + r.sides[1].share!).toBeCloseTo(1, 5);
    expect(r.margin).toBeNull();
  }, 60000);

  it('averages the share against par per doctrine', () => {
    const side = (doctrine: string, team: number, share: number) => ({ name: '', doctrine, team, out: null, kills: 0, lost: 0, razed: 0, captured: 0, attacks: 0, share, units: {} });
    const battle = (a: number) => ({ scenario: 'x', seed: 'x-1', map: '', set: '', minutes: 10, decided: true, winner: 1, msPerTick: 0, link: '', sides: [side('armour', 1, a), side('legion', 2, 1 - a)] }) as BattleResult;
    const sums = summarizeDoctrines([battle(0.7), battle(0.6)]);
    const armour = sums[DOCTRINE_IDS.indexOf('armour')];
    expect(armour.edge).toBeCloseTo(1.3, 5);
    expect(sums[DOCTRINE_IDS.indexOf('legion')].edge).toBeCloseTo(0.7, 5);
    expect(armour.edgeMargin).toBeGreaterThan(0);
  });
});

describe('parameter sweeps', () => {
  it('turns a setting or a unit stat into one variant per value', () => {
    expect(sweepVariants('tforce=0,0.35')).toEqual([
      { label: 'tforce=0', set: 'tforce=0' },
      { label: 'tforce=0.35', set: 'tforce=0.35' },
    ]);
    const v = sweepVariants('tank.damage=0.9,1.1');
    expect(v.map((x) => x.set)).toEqual(['tank=1,0.9,1,1', 'tank=1,1.1,1,1']);
    expect(settingsFromParams(new URLSearchParams(v[1].set)).units.tank.damage).toBe(1.1);
    expect(() => sweepVariants('tforce=0')).toThrow();
    expect(() => sweepVariants('nounit.hp=1,2')).toThrow();
    expect(() => sweepVariants('tank.armour=1,2')).toThrow();
  });

  it('compares the variants side by side', () => {
    const r = (variant: string, winner: number) => ({ scenario: 'x', seed: 'x-1', map: '', set: '', minutes: 10, decided: true, winner, margin: 0.8, variant, msPerTick: 0, link: '', sides: [] }) as unknown as BattleResult;
    const text = formatSweep([r('a=1', 1), r('a=2', 2)], [{ label: 'a=1', set: 'a=1' }, { label: 'a=2', set: 'a=2' }]);
    expect(text).toContain('a=1');
    expect(text).toContain('T2:1');
  });
});

describe('matchups apart from maps', () => {
  it('meets every pairing on every map type once, sides taking turns', () => {
    const plans = latinPlans(0, ['medium', 'wet', 'dry', 'hilly']);
    expect(plans.length).toBe(28 * 4);
    const seen = new Map<string, number>();
    const side1 = new Map<string, number>();
    for (const p of plans) {
      const q = new URLSearchParams(p.set);
      const a = q.get('doc1')!;
      const b = q.get('doc2')!;
      expect(a).not.toBe(b);
      const key = [a, b].sort().join('|') + '@' + p.map;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      side1.set(`${a}@${p.map}`, (side1.get(`${a}@${p.map}`) ?? 0) + 1);
    }
    expect(seen.size).toBe(28 * 4);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
    // Each doctrine is side 1 in three or four of its seven matchups on each map type.
    for (const n of side1.values()) expect(Math.abs(n - 3.5)).toBeLessThanOrEqual(0.5);
    expect(latinPlans(224, ['medium', 'wet']).length).toBe(224);
  });

  it('shows each pairing per map type, and which ones the map decides', () => {
    const side = (doctrine: string, team: number) => ({ name: '', doctrine, team, out: null, kills: 0, lost: 0, razed: 0, captured: 0, attacks: 0, units: {} });
    const r = (map: string, winner: number) => ({ scenario: '1v1', seed: '1v1-1', map, set: '', minutes: 10, decided: true, winner, msPerTick: 0, link: '', sides: [side('armour', 1), side('legion', 2)] }) as BattleResult;
    const text = formatLatin([r('wet', 1), r('dry', 2)]);
    expect(text).toMatch(/armour v legion\s+1-1\s+1-0\s+0-1/);
    expect(text).toContain('the map decides): armour v legion');
  });
});
