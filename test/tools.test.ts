import { describe, expect, it } from 'vitest';
import { hashSeed, Rng } from '../src/core/rng';
import { World } from '../src/core/ecs';
import { battlefieldConfig, defaultSettings } from '../src/game/settings';
import { BENCH_CASES, compareBench, runBench } from '../src/sim/bench';
import { pictureFor, settingsFor } from '../src/sim/mapTool';
import { formatProfile, formatTimeline, parseBattleNumbers, parseSeed, runBattle, Scenario, TIMELINE_EVERY } from '../src/sim/simulate';
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
