import { describe, expect, it } from 'vitest';
import { Ai, Mover, Tilt, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';
import { deckLine, RAMP_FLARE } from '../src/world/battlefield';
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

/** A bridge whose ends stand well back from the water, over a low shore that runs on beside it: its ramps climb over dry land. */
function shored(): Game {
  const game = bridged();
  const f = game.field;
  f.removeBridge(0);
  expect(placeBridge(f, { x: -12, z: 0 }, { x: 12, z: 0 }, true)).toBe(true);
  return game;
}

/** Every short step along a route from `from`, as [before, after] points. */
function steps(from: { x: number; z: number }, route: { x: number; z: number }[]): [{ x: number; z: number }, { x: number; z: number }][] {
  const out: [{ x: number; z: number }, { x: number; z: number }][] = [];
  const pts = [from, ...route];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2);
    for (let s = 1; s <= n; s++) {
      out.push([
        { x: a.x + ((b.x - a.x) * (s - 1)) / n, z: a.z + ((b.z - a.z) * (s - 1)) / n },
        { x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n },
      ]);
    }
  }
  return out;
}

describe('getting off a bridge over the side', () => {
  it("routes walkers and infantry off a deck's side only where they can wade, not into deep water a cell short of the bank", () => {
    // Walkers and infantry may step over a railing (MoveRules.rail is low for them), but the channel
    // under this deck is deeper than either can wade. Routes used to drop them over the side where a
    // cell's middle was on the bank, and movement, reading the ground point by point, wouldn't let
    // them go: they stood against the railing for good (and the dome trucks escorting them parked round them).
    const game = bridged();
    const f = game.field;
    for (const move of ['walker', 'foot'] as const) {
      const nav = game.ctx.navs.for(move);
      for (let x = -5; x <= 5; x += 0.5) {
        for (const z of [-2.3, -1, 0, 1, 2.3]) {
          for (const goal of [{ x: 9, z: 9 }, { x: -9, z: 9 }, { x: 9, z: -9 }, { x: -9, z: -9 }, { x: 5, z: 12 }]) {
            const from = { x, z };
            expect(f.deckAt(x, z)).not.toBeNull();
            const route = nav.findPath(from, goal, 0.9);
            expect(route).not.toBeNull();
            for (const [, p] of steps(from, route!)) expect(nav.terrainAllowsAt(p.x, p.z), `${move} from (${x}, ${z}) to (${goal.x}, ${goal.z}) at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`).toBe(true);
            expect(nav.lineClear(from, goal, 0.9) && !steps(from, [goal]).every(([, p]) => nav.terrainAllowsAt(p.x, p.z))).toBe(false);
          }
        }
      }
    }
  });

  it('walks a walker standing at the edge of the deck off it and on, wherever it starts', () => {
    for (const [x, z, gx, gz] of [
      [3, 2.4, 9, 9],
      [0, 2.4, 9, 9],
      [-3, -2.4, -9, -9],
      [2.5, -2.4, 5, 12],
    ]) {
      const game = bridged();
      const { world, ctx } = game;
      const e = spawnUnit(world, ctx, UNIT_DEFS.lanceWalker, 0, x, z);
      world.remove(e, Ai);
      const m = world.req(e, Mover);
      m.targetX = gx;
      m.targetZ = gz;
      run(game, 25);
      const t = world.req(e, Transform);
      expect(Math.hypot(t.x - gx, t.z - gz), `from (${x}, ${z}) to (${gx}, ${gz}), at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBeLessThan(3);
    }
  }, 60000);
});

describe('bridge ramps', () => {
  it('are open, with wings, for a stretch at each end, even where the deck is level with the banks', () => {
    const game = bridged();
    const f = game.field;
    const b = f.bridges[0];
    const [ea, eb] = f.openRamps(b);
    expect(ea).toBeGreaterThan(1.5);
    expect(eb).toBeGreaterThan(1.5);
    expect(f.railedAt(b, 0.05)).toBe(false);
    expect(f.railedAt(b, 0.5)).toBe(true);
    // Beside the foot of a ramp, its wing slopes from the deck's edge down to the ground.
    const near = f.wingAt(-5.5, 2.7)!;
    const far = f.wingAt(-5.5, 3.4)!;
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(f.heightAt(-5.5, 3.4));
    expect(f.surfaceAt(-5.5, 2.7)).toBeCloseTo(near);
    // Narrowing to nothing where the railing starts.
    expect(f.wingAt(-6 + ea - 0.2, 3.0)).toBeNull();
    expect(f.wingAt(0, 3)).toBeNull();
  });

  it("keep tanks on a shore beside the deck from climbing on over the railing: they go back round to the ramp's foot", () => {
    const game = shored();
    const f = game.field;
    const b = f.bridges[1];
    const [ea] = f.openRamps(b);
    expect(ea).toBeLessThan(6);
    // Beside the railed stretch of the ramp, over dry land.
    const from = { x: -6, z: 3.4 };
    expect(f.isWater(from.x, from.z)).toBe(false);
    expect(f.railKind(from.x, from.z)).toBe(1);
    const nav = game.ctx.nav;
    const route = nav.findPath(from, { x: 6, z: 0 }, 1.1)!;
    expect(route).not.toBeNull();
    let boarded: number | null = null;
    for (const [p0, p1] of steps(from, route)) {
      expect(nav.railCrossing(p0.x, p0.z, p1.x, p1.z)).toBe(false);
      if (boarded === null && f.deckAt(p1.x, p1.z) !== null && f.deckAt(p0.x, p0.z) === null) boarded = p1.x;
    }
    // Got on within the open ramp at the a end.
    expect(boarded).not.toBeNull();
    expect(boarded!).toBeLessThan(b.ax + ea + 0.5);
    // A walker just steps up.
    expect(game.ctx.navs.for('walker').railCrossing(from.x, from.z, -6, 2.4)).toBe(false);
  });

  it('drive a tank from that shore round onto the ramp and over', () => {
    const game = shored();
    const { world, ctx, field } = game;
    const e = spawnUnit(world, ctx, UNIT_DEFS.tank, 0, -6, 4.2);
    world.remove(e, Ai);
    const m = world.req(e, Mover);
    m.targetX = 16;
    m.targetZ = 0;
    const [ea] = field.openRamps(field.bridges[1]);
    let boardedAt: number | null = null;
    let wasOn = false;
    for (let i = 0; i < 40 / DT; i++) {
      game.step(DT);
      const t = world.req(e, Transform);
      const on = field.deckAt(t.x, t.z) !== null;
      if (on && !wasOn && boardedAt === null) boardedAt = t.x;
      wasOn = on;
    }
    const t = world.req(e, Transform);
    expect(Math.hypot(t.x - 16, t.z)).toBeLessThan(3);
    expect(boardedAt).not.toBeNull();
    expect(boardedAt!).toBeLessThan(field.bridges[1].ax + ea + 1);
  }, 60000);
});

describe('bridge decks', () => {
  /** A flat, empty map with a channel right across it between a bank `low` above the water (x < 0) and one `high` above it (x > 0). */
  function banks(low: number, high: number): Game {
    const s = defaultSettings();
    s.map.hills = 0;
    s.map.water = 0;
    s.map.towns = 0;
    s.map.outposts = 0;
    s.map.forest = 0;
    s.armies.taskForces = 0;
    const game = new Game(4, { settings: s, populate: false, autoSpawn: false });
    const f = game.field;
    const { cols, rows } = f.config;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const x = f.vertexX(i);
        f.heights[j * (cols + 1) + i] = f.seaLevel + (Math.abs(x) < 3.5 ? -1.5 : x < 0 ? low : high);
      }
    }
    f.changed({ i0: 0, j0: 0, i1: cols - 1, j1: rows - 1 });
    expect(placeBridge(f, { x: -6, z: 0 }, { x: 6, z: 0 }, true)).toBe(true);
    return game;
  }

  it('slope from a low bank up to a high one, meeting each, rather than cutting into the high one', () => {
    const game = banks(1.3, 2.8);
    const f = game.field;
    const b = f.bridges[0];
    expect(b.rise).toBeGreaterThan(1);
    expect(f.deckAlong(b, 0.25)).toBeLessThan(f.deckAlong(b, 0.75) - 0.5);
    // Each end level with its own bank, which keeps its height.
    expect(f.deckAlong(b, 0)).toBeCloseTo(f.heightAt(b.ax, b.az), 1);
    expect(f.deckAlong(b, 1)).toBeCloseTo(f.heightAt(b.bx, b.bz), 1);
    expect(f.heightAt(b.bx + 3, 0) - f.seaLevel).toBeCloseTo(2.8, 1);
    // Still clear of the water all the way over.
    for (let t = 0; t <= 1; t += 0.1) expect(deckLine(b, t)).toBeGreaterThan(f.seaLevel + 1.2);
  });

  it('run level between banks of a height, and keep a steep crossing to a gentle slope by cutting the high bank down', () => {
    const level = banks(1.6, 1.65).field.bridges[0];
    expect(level.rise ?? 0).toBe(0);
    const game = banks(1.3, 3.8);
    const f = game.field;
    const b = f.bridges[0];
    const length = Math.hypot(b.bx - b.ax, b.bz - b.az);
    expect(Math.abs(b.rise!) / length).toBeLessThanOrEqual(0.15 + 1e-9);
    expect(f.heightAt(b.bx, b.bz) - f.seaLevel).toBeLessThan(3.8 - 0.3);
  });

  it("have ramps' wings only as wide as it takes to meet the ground beside them", () => {
    // Banks level with the deck: the ramps hardly climb, so their wings are small.
    const flat = banks(1.3, 1.3).field;
    for (const w of flat.rampFlares(flat.bridges[0])) expect(w).toBeLessThan(RAMP_FLARE * 0.6);
    // Low banks under a deck at its usual clearance: they climb, so they're wide.
    const low = banks(0.3, 0.3).field;
    for (const w of low.rampFlares(low.bridges[0])) expect(w).toBeGreaterThan(RAMP_FLARE * 0.6);
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
