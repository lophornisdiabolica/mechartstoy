import { describe, expect, it } from 'vitest';
import { applyDamage } from '../src/game/systems/projectiles';
import { Building, GARRISON, Health, Producer, Transform, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { capture, OUTPOST_KINDS, outpostBonus } from '../src/game/outposts';
import { capFor } from '../src/game/caps';
import { defaultSettings } from '../src/game/settings';
import { spawnUnit } from '../src/game/spawn';
import { traceShot } from '../src/game/lineOfFire';
import { BRIDGE_WIDTH } from '../src/world/waterways';
import { DECK_GRADE, OUTPOST_KIND_IDS } from '../src/world/battlefield';
import { MOVE_RULES } from '../src/world/moveClasses';
import { settingsFromParams, settingsToParams } from '../src/ui/settingsUrl';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function game(seed: number, change: (s: ReturnType<typeof defaultSettings>) => void = () => {}, populate = false): Game {
  const s = defaultSettings();
  change(s);
  return new Game(seed, { settings: s, populate, autoSpawn: populate });
}

describe('roads', () => {
  it('town streets and the roads between towns are lines, paved along their length', () => {
    const g = game(3, (s) => {
      s.map.size = 'large';
      s.map.towns = 3;
    });
    const f = g.field;
    // A street per town, and links between them.
    expect(f.roads.length).toBeGreaterThan(f.townSites.length);
    for (const road of f.roads) {
      // Every point along a road is paved (unless it's on water or a bridge).
      for (let k = 1; k < road.points.length; k++) {
        const a = road.points[k - 1];
        const b = road.points[k];
        for (let t = 0; t <= 1; t += 0.25) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          if (f.isWater(x, z) || f.deckAt(x, z) !== null) continue;
          expect(f.groundAt(x, z).id).toBe('road');
        }
      }
    }
  });
});

describe('bridges', () => {
  it('are wide enough for the biggest walkers, no wider, ramp gently and land on dry ground', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const g = game(seed, (s) => {
        s.map.water = 0.8;
        s.map.hills = 1.3;
      });
      const f = g.field;
      for (const b of f.bridges) {
        seen++;
        expect(b.width).toBe(BRIDGE_WIDTH);
        const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
        const ux = (b.bx - b.ax) / len;
        const uz = (b.bz - b.az) / len;
        // The deck never climbs faster than its ramps allow.
        let last = f.surfaceAt(b.ax + ux * 0.3, b.az + uz * 0.3);
        for (let s = 0.6; s < len - 0.3; s += 0.3) {
          const y = f.surfaceAt(b.ax + ux * s, b.az + uz * s);
          expect(Math.abs(y - last) / 0.3).toBeLessThan(DECK_GRADE + 0.15);
          last = y;
        }
        // Both ends land on dry ground across the deck's width.
        for (const [x, z] of [[b.ax, b.az], [b.bx, b.bz]]) {
          for (const off of [-1, 0, 1]) expect(f.isWater(x - uz * off * (b.width / 2 - 0.2), z + ux * off * (b.width / 2 - 0.2))).toBe(false);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
    // The biggest walker fits.
    expect(BRIDGE_WIDTH).toBeGreaterThan(2 * 2);
  });

  it('walkers would rather go round by land', () => {
    expect(MOVE_RULES.walker.bridge).toBeGreaterThan(1);
    expect(MOVE_RULES.tracked.bridge).toBe(1);
  });

  it('keep buildings, docks included, off their decks', () => {
    for (const seed of [4, 7, 11]) {
      const g = game(
        seed,
        (s) => {
          s.map.water = 0.9;
          s.factions.forEach((f) => (f.doctrine = 'tidewater'));
        },
        true,
      );
      for (const e of g.world.query(Building, Transform)) {
        const t = g.world.req(e, Transform);
        expect(g.field.nearBridge(t.x, t.z, 0.5)).toBe(false);
      }
    }
  });
});

describe('dense forest', () => {
  it('stops shots, falls to them, and turns back into open ground once cleared', () => {
    const g = game(9, (s) => (s.map.forest = 0.5));
    const woods = g.field.woods;
    expect(woods.trees.length).toBeGreaterThan(50);
    // A tree well inside the map.
    const tree = woods.trees.find((t) => g.field.contains(t.x, t.z, 10))!;
    expect(g.field.groundAt(tree.x, tree.z).id).toBe('thicket');
    // A shot straight through the tree's trunk stops at it.
    const from = { x: tree.x - 6, y: tree.y + 1, z: tree.z };
    const to = { x: tree.x + 6, y: tree.y + 1, z: tree.z };
    const shooter = spawnUnit(g.world, g.ctx, g.ctx.units.tank, 0, from.x, from.z);
    const trace = traceShot(g.world, g.ctx, from, to, 12, shooter, 0, null);
    expect(['tree', 'ground']).toContain(trace.stoppedBy);
    expect(Math.hypot(trace.x - tree.x, trace.z - tree.z)).toBeLessThan(6);
    // Enough damage knocks it (and its neighbours in the blast) flat; a cleared cell is open ground.
    const [i, j] = g.field.cellAt(tree.x, tree.z);
    const cell = j * g.field.config.cols + i;
    for (let n = 0; n < 5; n++) for (const t of woods.standingIn(cell)) woods.damage(woods.trees[t].x, woods.trees[t].z, woods.trees[t].y + 1, 1, 100);
    expect(tree.fell).not.toBeNull();
    expect(woods.standingIn(cell)).toEqual([]);
    expect(g.field.groundAt(tree.x, tree.z).id).toBe('plain');
  });

  it('slows vehicles, which flatten the trees they drive into; infantry slip between', () => {
    const g = game(9, (s) => (s.map.forest = 0.5));
    const woods = g.field.woods;
    const tree = woods.trees.find((t) => woods.hasTreesAt(t.x, t.z) && !g.field.isWater(t.x + 3, t.z))!;
    expect(g.field.groundAt(tree.x, tree.z).speed.tracked).toBeLessThan(1);
    expect(g.ctx.navs.for('tracked').costAt(tree.x, tree.z)).toBeGreaterThan(g.ctx.navs.for('foot').costAt(tree.x, tree.z));
    const before = woods.trees.filter((t) => t.fell !== null).length;
    // A trooper walking through leaves the trees standing.
    const trooper = spawnUnit(g.world, g.ctx, g.ctx.units.trooper, 0, tree.x, tree.z);
    run(g, 0.5);
    g.world.destroy(trooper);
    expect(woods.trees.filter((t) => t.fell !== null).length).toBe(before);
    // A tank on the same spot flattens them.
    spawnUnit(g.world, g.ctx, g.ctx.units.tank, 0, tree.x, tree.z);
    g.world.req([...g.world.query(Unit)].at(-1)!, Transform);
    const tank = [...g.world.query(Unit)].at(-1)!;
    const m = g.world.req(tank, Transform);
    // Drive it a little way so the movement system runs over the spot.
    m.x = tree.x - 1;
    m.z = tree.z;
    g.ctx.orders[0] = { stance: 'hold', rally: { x: tree.x + 3, z: tree.z } };
    run(g, 3);
    expect(woods.trees.filter((t) => t.fell !== null).length).toBeGreaterThan(before);
  });
});

describe('scrap', () => {
  it('piles up where vehicles are wrecked, slows tanks, and is cleared later', () => {
    const g = game(5, (s) => (s.map.forest = 0));
    const site = g.field.baseSites[0];
    const x = site.x + (site.x < 0 ? 22 : -22);
    const z = site.z;
    // Wrecked one at a time, so they don't push each other apart first.
    for (let n = 0; n < 5; n++) {
      const tank = spawnUnit(g.world, g.ctx, g.ctx.units.tank, 1, x, z);
      applyDamage(g.world, g.ctx, tank, 1e6, { source: 'tank', faction: 0 });
      run(g, DT);
    }
    run(g, 3);
    expect(g.field.groundAt(x, z).id).toBe('scrap');
    expect(g.ctx.navs.for('tracked').costAt(x, z)).toBeGreaterThan(g.ctx.navs.for('walker').costAt(x, z));
    run(g, 250);
    expect(g.field.groundAt(x, z).id).toBe('plain');
  });

  it('can be turned off', () => {
    const g = game(5, (s) => {
      s.map.forest = 0;
      s.map.scrap = false;
    });
    const site = g.field.baseSites[0];
    const x = site.x + (site.x < 0 ? 22 : -22);
    for (let n = 0; n < 6; n++) applyDamage(g.world, g.ctx, spawnUnit(g.world, g.ctx, g.ctx.units.tank, 1, x, site.z), 1e6, null);
    run(g, 3);
    expect(g.field.groundAt(x, site.z).id).not.toBe('scrap');
  });
});

describe('outpost kinds', () => {
  it('deals out every kind on a map with enough outposts, the gun on the highest', () => {
    const g = game(
      12,
      (s) => {
        s.map.size = 'large';
        s.map.outposts = 6;
      },
      true,
    );
    const kinds = g.ctx.outposts.map((o) => o.kind.id).sort();
    expect(kinds).toEqual([...OUTPOST_KIND_IDS].sort());
    const height = (o: { x: number; z: number }) => g.field.heightAt(o.x, o.z);
    const gun = g.ctx.outposts.find((o) => o.kind.id === 'gun')!;
    for (const o of g.ctx.outposts) expect(height(gun)).toBeGreaterThanOrEqual(height(o) - 1e-6);
    // Each kind with a building of its own has it.
    for (const o of g.ctx.outposts) {
      if (!o.kind.building) continue;
      const own = [...g.world.query(Building, Transform)].filter((e) => {
        const t = g.world.req(e, Transform);
        return g.world.req(e, Building).def.id === o.kind.building && Math.hypot(t.x - o.x, t.z - o.z) < 9;
      });
      expect(own.length).toBe(1);
    }
  });

  it('give their holders what they promise', () => {
    const g = game(
      12,
      (s) => {
        s.map.size = 'large';
        s.map.outposts = 6;
      },
      true,
    );
    const { ctx, world } = g;
    const air = capFor(ctx, 0, 'air');
    for (const o of ctx.outposts) capture(world, ctx, o, 0);
    expect(capFor(ctx, 0, 'air')).toBe(air + OUTPOST_KINDS.airstrip.bonus!.amount);
    expect(outpostBonus(ctx, 0, 'production')).toBeCloseTo(0.2);
    expect(outpostBonus(ctx, 0, 'readiness')).toBeCloseTo(0.4);
    // The ruined factory builds its holder's vehicles, and only while held.
    const factory = [...world.query(Building)].find((e) => world.req(e, Building).def.id === 'ruinedFactory')!;
    expect(world.req(factory, Producer).table.map((p) => p.unit)).toContain('tank');
    capture(world, ctx, ctx.outposts.find((o) => o.kind.id === 'factory')!, GARRISON);
    expect(world.has(factory, Producer)).toBe(false);
    // The fuel depot's tanks blow up.
    const tanks = [...world.query(Building, Health)].find((e) => world.req(e, Building).def.id === 'fuelTanks')!;
    expect(world.req(tanks, Building).def.explodes).toBeDefined();
  });

  it('can be limited to some kinds, in the URL too', () => {
    const s = defaultSettings();
    s.map.outpostKinds = ['gun', 'relay'];
    const back = settingsFromParams(settingsToParams(s));
    expect(back.map.outpostKinds).toEqual(['gun', 'relay']);
    const g = game(
      12,
      (t) => {
        t.map.size = 'large';
        t.map.outposts = 4;
        t.map.outpostKinds = ['gun', 'relay'];
      },
      true,
    );
    for (const o of g.ctx.outposts) expect(['gun', 'relay']).toContain(o.kind.id);
  });
});

describe('placing by hand', () => {
  it('puts bases, towns and outposts where they were placed', () => {
    const g = game(21, (s) => {
      s.map.towns = 2;
      s.map.outposts = 2;
      s.map.placed = {
        bases: [
          { x: -0.6, z: -0.5 },
          { x: 0.6, z: 0.5 },
        ],
        towns: [
          { x: 0, z: 0.4 },
          { x: -0.1, z: -0.4 },
        ],
        outposts: [
          { x: 0.5, z: -0.5 },
          { x: -0.5, z: 0.5 },
        ],
      };
    });
    const f = g.field;
    const at = (p: { x: number; z: number }) => ({ x: (p.x * f.width) / 2, z: (p.z * f.depth) / 2 });
    const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-6;
    expect(near(f.baseSites[0], at({ x: -0.6, z: -0.5 }))).toBe(true);
    expect(near(f.baseSites[1], at({ x: 0.6, z: 0.5 }))).toBe(true);
    expect(f.townSites.map((t) => ({ x: t.x, z: t.z }))).toEqual([at({ x: 0, z: 0.4 }), at({ x: -0.1, z: -0.4 })]);
    expect(near(f.outpostSites[0], at({ x: 0.5, z: -0.5 }))).toBe(true);
  });

  it('ignores placements that no longer match the number of sides, towns or outposts, and round-trips them', () => {
    const s = defaultSettings();
    s.map.placed.towns = [{ x: 0.1, z: 0.2 }];
    s.map.towns = 2;
    const g = new Game(21, { settings: s, populate: false, autoSpawn: false });
    expect(g.field.townSites.length).toBe(2);
    s.map.placed.bases = [
      { x: -0.25, z: 0.5 },
      { x: 0.75, z: -0.33 },
    ];
    expect(settingsFromParams(settingsToParams(s)).map.placed).toEqual(s.map.placed);
  });
});
