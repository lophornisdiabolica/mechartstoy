import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { battlefieldConfig, defaultSettings } from '../src/game/settings';
import { Ai, Armed, Mover, Transform } from '../src/game/components';
import { Game } from '../src/game/game';
import { spawnUnit } from '../src/game/spawn';
import { effectiveRange } from '../src/game/systems/targeting';
import { UNIT_DEFS, UnitDef } from '../src/game/units';
import { generateBattlefield } from '../src/world/battlefield';
import { MOVE_RULES, terrainAllows, terrainAllowsFace } from '../src/world/moveClasses';
import { NavGrid, NavGrids } from '../src/world/navGrid';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

function quietGame(seed = 11): Game {
  return new Game(seed, { populate: false, autoSpawn: false });
}

/** A test-only aircraft: a Strider that flies. */
const GUNSHIP: UnitDef = { ...UNIT_DEFS.strider, id: 'gunship', name: 'Gunship', move: 'air' };

describe('movement classes', () => {
  it('lets each class onto the terrain it can cross', () => {
    const { foot, tracked, walker, hover, amphibious, naval, air } = MOVE_RULES;
    // Dry flat ground.
    for (const r of [foot, tracked, walker, hover, amphibious, air]) expect(terrainAllows(r, -1, 0.1)).toBe(true);
    expect(terrainAllows(naval, -1, 0.1)).toBe(false);
    // Shallow water: walkers wade, land vehicles and infantry don't.
    expect(terrainAllows(walker, 0.4, 0)).toBe(true);
    expect(terrainAllows(tracked, 0.4, 0)).toBe(false);
    expect(terrainAllows(foot, 0.4, 0)).toBe(false);
    // Deep water: only things that float or fly.
    for (const r of [hover, amphibious, naval, air]) expect(terrainAllows(r, 2, 0)).toBe(true);
    expect(terrainAllows(walker, 2, 0)).toBe(false);
    // Cliffs stop nothing, but hovers find them the worst going.
    expect(terrainAllows(hover, -1, 1.2)).toBe(true);
    expect(terrainAllows(tracked, -1, 1.2)).toBe(true);
    for (const r of [foot, tracked, walker]) expect(hover.steep).toBeGreaterThan(r.steep);
  });

  it('gives walkers routes through shallows that tracked vehicles must go round', () => {
    let checked = 0;
    for (let seed = 0; seed < 6; seed++) {
      const field = generateBattlefield(new Rng(seed));
      const navs = new NavGrids(field);
      const walker = navs.for('walker');
      for (let x = field.bounds.minX + 2; x < field.bounds.maxX - 2; x += 3) {
        for (let z = field.bounds.minZ + 2; z < field.bounds.maxZ - 2; z += 3) {
          const depth = field.seaLevel - field.heightAt(x, z);
          if (depth <= 0.05 || depth >= 0.55) continue;
          expect(walker.terrainAllowsAt(x, z)).toBe(true);
          expect(navs.land.terrainAllowsAt(x, z)).toBe(false);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('shares building obstacles between every class', () => {
    const field = generateBattlefield(new Rng(4));
    const navs = new NavGrids(field);
    const foot = navs.for('foot');
    const s = field.baseSites[0];
    const v = foot.version;
    navs.land.markObstacle(s.x, s.z, 3, 1);
    expect(foot.version).toBeGreaterThan(v);
    expect(foot.blockedAt(s.x, s.z)).toBe(true);
  });

  it('sends infantry through a town that tanks go round', () => {
    let compared = 0;
    for (let seed = 0; seed < 10 && compared < 3; seed++) {
      const field = generateBattlefield(new Rng(seed));
      const town = field.townSites[0];
      if (!town) continue;
      // Points on either side of the town, toward the two bases.
      const a = field.baseSites[0];
      const b = field.baseSites[1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const from = { x: town.x - ux * (town.radius + 5), z: town.z - uz * (town.radius + 5) };
      const to = { x: town.x + ux * (town.radius + 5), z: town.z + uz * (town.radius + 5) };
      const inTown = (nav: NavGrid) => {
        const path = nav.findPath(from, to);
        if (!path) return null;
        let inside = 0;
        let prev = from;
        for (const p of path) {
          const steps = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) / 0.5);
          for (let i = 1; i <= steps; i++) {
            const x = prev.x + ((p.x - prev.x) * i) / steps;
            const z = prev.z + ((p.z - prev.z) * i) / steps;
            if (Math.hypot(x - town.x, z - town.z) < town.radius) inside += 0.5;
          }
          prev = p;
        }
        return inside;
      };
      const foot = inTown(new NavGrid(field, 'foot'));
      const tracked = inTown(new NavGrid(field, 'tracked'));
      if (foot === null || tracked === null) continue;
      expect(foot).toBeGreaterThan(tracked);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('flies aircraft straight over water at altitude, out of reach of ground-only weapons', () => {
    const game = quietGame();
    const base = game.field.baseSites[0];
    const gunship = spawnUnit(game.world, game.ctx, GUNSHIP, 0, base.x, base.z);
    game.world.remove(gunship, Ai);
    // A harmless gunship, so the test is only about who can shoot at it.
    game.world.req(gunship, Armed).weapon = { ...GUNSHIP.weapon, range: 0 };
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, base.x + 5, base.z);
    const strider = spawnUnit(game.world, game.ctx, UNIT_DEFS.strider, 1, base.x - 5, base.z);
    game.world.remove(trooper, Ai);
    game.world.remove(strider, Ai);
    run(game, 1);
    const t = game.world.req(gunship, Transform);
    expect(t.y).toBeCloseTo(game.field.surfaceAt(t.x, t.z) + MOVE_RULES.air.altitude, 3);
    // Rifles only hit the ground; the Strider's autocannon hits both.
    expect(game.world.req(trooper, Armed).target).toBeNull();
    expect(game.world.req(strider, Armed).target).toBe(gunship);
    // Head for the far base in a straight line, whatever's in between.
    const goal = game.field.baseSites[1];
    const m = game.world.req(gunship, Mover);
    m.targetX = goal.x;
    m.targetZ = goal.z;
    run(game, 3);
    expect(m.nav.path).toBeNull();
  });
});

describe('roles', () => {
  it('artillery backs away from enemies inside its minimum range', () => {
    const game = quietGame();
    const base = game.field.baseSites[0];
    const howitzer = spawnUnit(game.world, game.ctx, UNIT_DEFS.howitzer, 0, base.x, base.z);
    const trooper = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, base.x + 4, base.z);
    game.world.remove(trooper, Ai);
    run(game, 6);
    const h = game.world.req(howitzer, Transform);
    const tt = game.world.req(trooper, Transform);
    expect(Math.hypot(h.x - tt.x, h.z - tt.z)).toBeGreaterThan(5);
  });

  it('support units follow behind the nearest frontline ally', () => {
    const game = quietGame();
    const base = game.field.baseSites[0];
    const medic: UnitDef = { ...UNIT_DEFS.strider, id: 'escort', role: 'support' };
    const lead = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x, base.z);
    game.world.remove(lead, Ai);
    const escort = spawnUnit(game.world, game.ctx, medic, 0, base.x + 12, base.z + 6);
    run(game, 10);
    const lt = game.world.req(lead, Transform);
    const et = game.world.req(escort, Transform);
    expect(Math.hypot(lt.x - et.x, lt.z - et.z)).toBeLessThan(8);
  });

  it('gives weapons on high ground a little more reach', () => {
    const game = quietGame();
    const base = game.field.baseSites[0];
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, base.x, base.z);
    const other = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 1, base.x + 10, base.z);
    const armed = game.world.req(tank, Armed);
    const range = armed.weapon.range;
    const ty = game.world.req(tank, Transform);
    const oy = game.world.req(other, Transform);
    oy.y = ty.y;
    expect(effectiveRange(game.world, tank, armed, other)).toBeCloseTo(range);
    ty.y = oy.y + 2;
    expect(effectiveRange(game.world, tank, armed, other)).toBeCloseTo(range * 1.06);
    ty.y = oy.y + 20;
    expect(effectiveRange(game.world, tank, armed, other)).toBeCloseTo(range * 1.15);
    ty.y = oy.y - 5;
    expect(effectiveRange(game.world, tank, armed, other)).toBeCloseTo(range);
  });
  it('stops a class on a slope too steep for it only where the slope is tall, not on a short bank', () => {
    const { tracked, walker, foot, hover, climber } = MOVE_RULES;
    // Gentle ground goes, however tall; a steep face goes only while it's short.
    expect(terrainAllowsFace(tracked, 0.9, 20)).toBe(true);
    expect(terrainAllowsFace(tracked, 1.4, 1)).toBe(true);
    expect(terrainAllowsFace(tracked, 1.4, 4)).toBe(false);
    expect(terrainAllowsFace(walker, 1.4, 4)).toBe(true);
    expect(terrainAllowsFace(foot, 1.8, 5)).toBe(true);
    expect(terrainAllowsFace(climber, 9, 99)).toBe(true);
    // Tanks climb more than hovers, less than walkers, which climb less than infantry.
    expect(hover.climb).toBeLessThan(tracked.climb);
    expect(tracked.climb).toBeLessThan(walker.climb);
    expect(walker.climb).toBeLessThan(foot.climb);
    expect(tracked.climbHeight).toBeLessThan(walker.climbHeight);
    expect(walker.climbHeight).toBeLessThan(foot.climbHeight);

    // On a hilly map, a hillside's face reads taller than a bump's; walkers get up some tanks can't.
    const s = defaultSettings();
    s.map = { ...s.map, hills: 2, water: 0 };
    const field = generateBattlefield(new Rng(3), battlefieldConfig(s));
    const navs = new NavGrids(field);
    let walkerOnly = 0;
    for (let x = field.bounds.minX + 2; x < field.bounds.maxX - 2; x += 1.5) {
      for (let z = field.bounds.minZ + 2; z < field.bounds.maxZ - 2; z += 1.5) {
        const slope = field.slopeAt(x, z);
        if (slope <= tracked.climb) continue;
        expect(field.faceHeight(x, z, tracked.climb)).toBeGreaterThan(0);
        if (!navs.land.terrainAllowsAt(x, z) && navs.for('walker').terrainAllowsAt(x, z)) walkerOnly++;
      }
    }
    expect(walkerOnly).toBeGreaterThan(20);
  });

  it('a tank left on a slope too steep for it can still get down off it', () => {
    const s = defaultSettings();
    s.map = { ...s.map, hills: 3, water: 0 };
    const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
    const f = game.field;
    const nav = game.ctx.navs.land;
    let spot: { x: number; z: number } | null = null;
    for (let x = f.bounds.minX + 6; x < f.bounds.maxX - 6 && !spot; x += 1.5) {
      for (let z = f.bounds.minZ + 6; z < f.bounds.maxZ - 6 && !spot; z += 1.5) {
        if (!nav.terrainAllowsAt(x, z) && !f.isWater(x, z) && f.baseSites.every((b) => Math.hypot(b.x - x, b.z - z) > b.radius + 6)) spot = { x, z };
      }
    }
    expect(spot).not.toBeNull();
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, spot!.x, spot!.z);
    const t = game.world.req(tank, Transform);
    t.x = spot!.x;
    t.z = spot!.z;
    const m = game.world.req(tank, Mover);
    const home = f.baseSites[0];
    m.targetX = home.x;
    m.targetZ = home.z;
    run(game, 20);
    expect(Math.hypot(t.x - spot!.x, t.z - spot!.z)).toBeGreaterThan(3);
  });
});
