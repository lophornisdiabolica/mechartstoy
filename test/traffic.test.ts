import { describe, expect, it } from 'vitest';
import { Ai, Mover, Tilt, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { placeBridge } from '../src/world/waterways';

const DT = 1 / 30;
/** A flat, empty map with a channel right across it and one bridge over the channel. */
function bridged(): Game {
  const s = defaultSettings();
  s.map.hills = 0;
  s.map.water = 0;
  s.map.towns = 0;
  s.map.outposts = 0;
  s.map.forest = 0;
  s.armies.taskForces = 0;
  const game = new Game(4, { settings: s, populate: false, autoSpawn: false });
  const f = game.field;
  for (let z = f.bounds.minZ; z <= f.bounds.maxZ; z += 1) f.reshape(0, z, 3.5, () => f.seaLevel - 1.5);
  expect(placeBridge(f, { x: -6, z: 0 }, { x: 6, z: 0 }, true)).toBe(true);
  return game;
}

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

describe('bridge railings', () => {
  it('mark the ground just beside a raised deck, and cost vehicles a lot to route over', () => {
    const game = bridged();
    const f = game.field;
    const nav = game.ctx.nav;
    expect(f.deckAt(0, 0)).not.toBeNull();
    // Beside the ramp on dry land, where the deck stands above the ground: a railing.
    expect(f.railAt(-5, 3.2)).toBe(true);
    // Off the end of the ramp, the open mouth: no railing.
    expect(f.railAt(-6.5, 0)).toBe(false);
    expect(f.railAt(-7, 2)).toBe(false);
    expect(nav.costAt(-4, 3.3)).toBeGreaterThan(20);
    // Infantry would rather not, but can.
    expect(game.ctx.navs.for('foot').costAt(-4, 3.3)).toBeLessThan(5);
    // Over the railing is no way on or off; up the ramp is.
    // The last deck cell and the first railing cell going out sideways from the middle of the ramp.
    let deck = { x: -4, z: 0 };
    let rail = deck;
    for (let z = 0; z < 6; z += 0.25) {
      if (f.railAt(-4, z)) {
        rail = { x: -4, z };
        break;
      }
      deck = { x: -4, z };
    }
    expect(rail).not.toBe(deck);
    expect(nav.railCrossing(deck.x, deck.z, rail.x, rail.z + 0.3)).toBe(true);
    expect(nav.railCrossing(rail.x, rail.z + 0.3, deck.x, deck.z)).toBe(true);
    expect(nav.railCrossing(-8, 0, -6.5, 0)).toBe(false);
    expect(nav.railCrossing(-3, -0.5, 3, 0.5)).toBe(false);
    expect(game.ctx.navs.for('foot').railCrossing(deck.x, deck.z, rail.x, rail.z + 0.3)).toBe(false);
  });

  it('send a tank from beside the ramp round to its end, not over the side', () => {
    const game = bridged();
    const nav = game.ctx.nav;
    const from = { x: -5, z: 4.6 };
    const route = nav.findPath(from, { x: 3, z: 0 }, 1.1)!;
    expect(route).not.toBeNull();
    const pts = [from, ...route];
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1];
      const b = pts[k];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2);
      for (let s = 1; s <= steps; s++) {
        const p0 = { x: a.x + ((b.x - a.x) * (s - 1)) / steps, z: a.z + ((b.z - a.z) * (s - 1)) / steps };
        const p1 = { x: a.x + ((b.x - a.x) * s) / steps, z: a.z + ((b.z - a.z) * s) / steps };
        expect(nav.railCrossing(p0.x, p0.z, p1.x, p1.z)).toBe(false);
      }
    }
  });
});

describe('bridge traffic', () => {
  it('tanks meeting at a bridge take turns instead of meeting in the middle, and all get across', () => {
    const game = bridged();
    const { world, ctx, field } = game;
    const tanks: { e: number; to: { x: number; z: number } }[] = [];
    for (let n = 0; n < 3; n++) {
      for (const side of [-1, 1]) {
        const e = spawnUnit(world, ctx, UNIT_DEFS.tank, 0, side * (14 + n * 4), n * 3 - 3);
        world.remove(e, Ai);
        const to = { x: -side * (14 + n * 3), z: 3 - n * 3 };
        const m = world.req(e, Mover);
        m.targetX = to.x;
        m.targetZ = to.z;
        tanks.push({ e, to });
      }
    }
    game.step(DT);
    // The map's bridges are narrows from the first tick.
    expect(ctx.traffic.at(0, 0)).toBeGreaterThanOrEqual(0);
    let headOn = 0;
    let held = 0;
    let busiest = 0;
    let overhang = -Infinity;
    let roll = 0;
    for (let i = 0; i < 90 / DT; i++) {
      game.step(DT);
      // Which ways the tanks on the deck are heading.
      const ways = new Set<number>();
      for (const { e } of tanks) {
        const t = world.req(e, Transform);
        const m = world.req(e, Mover);
        if (field.deckAt(t.x, t.z) !== null && m.targetX !== null) ways.add(m.targetX > t.x ? 1 : -1);
        if (world.time < world.req(e, Mover).nav.holdUntil) held++;
      }
      if (ways.size > 1) headOn++;
      // While they queue, the bridge costs more to plan a route over.
      busiest = Math.max(busiest, ctx.nav.costAt(0, 0));
      // On the deck, hulls stay on it and lie flat across it.
      for (const { e } of tanks) {
        const t = world.req(e, Transform);
        if (field.deckAt(t.x, t.z) === null || Math.abs(t.x) > 4.5) continue;
        // (Roll on the level middle: on a ramp a hull turning onto it rolls with the ramp, as it should.)
        if (Math.abs(t.x) < 2) roll = Math.max(roll, Math.abs(world.req(e, Tilt).roll));
        overhang = Math.max(overhang, Math.abs(t.z) + UNIT_DEFS.tank.radius - 2.5);
      }
    }
    expect(held).toBeGreaterThan(0);
    expect(busiest).toBeGreaterThan(2);
    expect(overhang).toBeLessThan(0.5);
    expect(roll).toBeLessThan(0.05);
    // A moment's overlap as one rolls off while the next rolls on, at most.
    expect(headOn * DT).toBeLessThan(1.5);
    for (const { e, to } of tanks) {
      const t = world.req(e, Transform);
      expect(Math.hypot(t.x - to.x, t.z - to.z)).toBeLessThan(3);
    }
  }, 120000);

  it('registers bridges as narrows, and takes narrows anyone adds (a street, say)', () => {
    const game = bridged();
    const { ctx } = game;
    const before = ctx.nav.costAt(0, 0);
    game.step(DT);
    const id = ctx.traffic.at(0, 0);
    expect(id).toBeGreaterThanOrEqual(0);
    expect(ctx.traffic.get(id)!.kind).toBe('bridge');
    // A narrow anyone can add (a street, say), found along a route that runs down it.
    const street = ctx.traffic.add({ ax: -20, az: 15, bx: -20, bz: 30, width: 4.5, kind: 'street' });
    expect(ctx.traffic.along({ x: -20, z: 10 }, [{ x: -20, z: 35 }])).toEqual({ id: street, dir: 1 });
    // Crossing it from side to side isn't running along it.
    expect(ctx.traffic.along({ x: -25, z: 20 }, [{ x: -15, z: 20 }])).toBeNull();
    ctx.traffic.remove(street);
    expect(ctx.traffic.get(street)).toBeNull();
    expect(before).toBeLessThan(1.5);
  });

  it("lets a hovercraft running down the channel hop straight over the bridge's deck", () => {
    const game = bridged();
    const { world, ctx } = game;
    // Side by side down the channel, a little apart.
    const boats = (['skimmer', 'amphib', 'hoverFortress'] as const).map((id, n) => {
      const e = spawnUnit(world, ctx, UNIT_DEFS[id], 0, n * 2 - 2, -14 - n * 6);
      world.remove(e, Ai);
      const m = world.req(e, Mover);
      m.targetX = n * 2 - 2;
      m.targetZ = 14 + n * 6;
      return { e, to: { x: n * 2 - 2, z: 14 + n * 6 } };
    });
    run(game, 90);
    for (const { e, to } of boats) {
      const t = world.req(e, Transform);
      expect(Math.hypot(t.x - to.x, t.z - to.z)).toBeLessThan(3);
    }
  }, 60000);
});
