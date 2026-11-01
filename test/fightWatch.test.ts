import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/events';
import { GameEvents } from '../src/game/context';
import { Game } from '../src/game/game';
import { FightWatch } from '../src/render/fightWatch';

const BOUNDS = { minX: -100, maxX: 100, minZ: -60, maxZ: 60 };

/** Runs the watch for `seconds`, with `perSecond` shots a second at each fight. */
function fight(watch: FightWatch, seconds: number, fights: { x: number; z: number; perSecond: number }[]): void {
  for (let t = 0; t < seconds; t += 0.25) {
    for (const f of fights) for (let i = 0; i < f.perSecond / 4; i++) watch.warm(f.x + (i % 3), f.z, 1);
    watch.update(0.25);
  }
}

const near = (p: { x: number; z: number } | null, x: number, z: number) => p !== null && Math.hypot(p.x - x, p.z - z) < 10;

describe('fight watch', () => {
  it('has nothing to look at until there is a fight', () => {
    const watch = new FightWatch(new EventBus<GameEvents>(), BOUNDS);
    fight(watch, 5, []);
    expect(watch.focus).toBeNull();
    fight(watch, 2, [{ x: 40, z: -20, perSecond: 6 }]);
    expect(near(watch.focus, 40, -20)).toBe(true);
  });

  it('stays on a fight for a while before moving to a bigger one', () => {
    const watch = new FightWatch(new EventBus<GameEvents>(), BOUNDS);
    fight(watch, 3, [{ x: -50, z: 0, perSecond: 6 }]);
    fight(watch, 2, [{ x: -50, z: 0, perSecond: 6 }, { x: 60, z: 30, perSecond: 30 }]);
    expect(near(watch.focus, -50, 0)).toBe(true);
    fight(watch, 8, [{ x: -50, z: 0, perSecond: 6 }, { x: 60, z: 30, perSecond: 30 }]);
    expect(near(watch.focus, 60, 30)).toBe(true);
  });

  it('a similar fight elsewhere does not pull the camera away', () => {
    const watch = new FightWatch(new EventBus<GameEvents>(), BOUNDS);
    fight(watch, 3, [{ x: -50, z: 0, perSecond: 10 }]);
    fight(watch, 20, [{ x: -50, z: 0, perSecond: 10 }, { x: 60, z: 30, perSecond: 12 }]);
    expect(near(watch.focus, -50, 0)).toBe(true);
  });

  it('moves on promptly when its fight is over', () => {
    const watch = new FightWatch(new EventBus<GameEvents>(), BOUNDS);
    fight(watch, 3, [{ x: -50, z: 0, perSecond: 10 }]);
    fight(watch, 12, [{ x: 60, z: 30, perSecond: 8 }]);
    expect(near(watch.focus, 60, 30)).toBe(true);
  });

  it('follows a fight as it drifts', () => {
    const watch = new FightWatch(new EventBus<GameEvents>(), BOUNDS);
    for (let x = -60; x <= 0; x += 2) fight(watch, 1, [{ x, z: 10, perSecond: 10 }]);
    expect(near(watch.focus, 0, 10)).toBe(true);
  });

  it('finds the fighting in a real battle', () => {
    const game = new Game(3);
    const watch = new FightWatch(game.events, game.field.bounds);
    const deaths: { x: number; z: number }[] = [];
    game.events.on('unitDestroyed', (e) => deaths.push(e));
    for (let i = 0; i < 30 * 120; i++) {
      game.step(1 / 30);
      watch.update(1 / 30);
    }
    expect(deaths.length).toBeGreaterThan(0);
    const f = watch.focus!;
    expect(f).not.toBeNull();
    // Somewhere units have actually been dying, not an empty corner.
    expect(Math.min(...deaths.map((d) => Math.hypot(d.x - f.x, d.z - f.z)))).toBeLessThan(20);
  }, 30000);
});
