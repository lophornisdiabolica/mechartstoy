import { describe, expect, it } from 'vitest';
import { adviceFactor, needsOf, STYLES } from '../src/game/commander/advice';
import { PICTURE_INTERVAL, SidePicture } from '../src/game/commander/commander';
import { TOWERS_MOST, WALLS_MOST } from '../src/game/commander/engineers';
import { countByCategory } from '../src/game/caps';
import { Ai, Building, Faction, Guard, Health, Rubble, Transform, Unit } from '../src/game/components';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { spawnBuilding, spawnUnit } from '../src/game/spawn';
import { UNIT_DEFS } from '../src/game/units';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

describe('commander picture', () => {
  it('knows every base, outpost and town, and finds them while the map loads', () => {
    const game = new Game(7);
    const kinds = (k: string) => game.ctx.commander.places.filter((p) => p.kind === k).length;
    expect(kinds('base')).toBe(game.field.baseSites.length);
    expect(kinds('outpost')).toBe(game.field.outpostSites.length);
    expect(kinds('town')).toBe(game.field.townSites.length);
    for (const p of game.ctx.commander.places) expect(game.field.contains(p.x, p.z)).toBe(true);
  });

  it('counts each side’s army and what it faces', () => {
    const s = defaultSettings();
    s.map.outposts = 0;
    const game = new Game(3, { settings: s, populate: false, autoSpawn: false });
    const b = game.field.baseSites[0];
    for (let i = 0; i < 4; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + i * 3, b.z);
    spawnUnit(game.world, game.ctx, UNIT_DEFS.flakTank, 1, game.field.baseSites[1].x, game.field.baseSites[1].z);
    run(game, PICTURE_INTERVAL + DT);
    const [red, blue] = game.ctx.commander.sides;
    expect(red.mix.vehicle).toBe(4);
    expect(red.ground).toBeGreaterThan(0);
    expect(red.air).toBe(0);
    expect(red.enemyMix.antiAir).toBe(1);
    expect(blue.antiAir).toBeGreaterThan(0);
    expect(Math.abs(red.armyX! - b.x)).toBeLessThan(12);
    const strength = game.ctx.commander.strength;
    expect(strength.near(strength.ground, 0, b.x, b.z, 12)).toBeGreaterThan(0);
    expect(strength.near(strength.ground, 1, b.x, b.z, 12)).toBe(0);
  });

  it('states today’s team plan: mass at the rally point, then push the enemy base', () => {
    const game = new Game(11);
    run(game, PICTURE_INTERVAL + DT);
    const goals = game.ctx.commander.sides[0].goals;
    const push = goals.find((g) => g.kind === 'push');
    expect(push?.target).toBe(1);
    expect(push && Math.hypot(push.x - game.field.baseSites[1].x, push.z - game.field.baseSites[1].z)).toBe(0);
    expect(goals.every((g) => g.score >= 0 && g.score <= 1)).toBe(true);
  });
});

describe('task forces', () => {
  /** Two armies of tanks at home, two empty outposts, nothing built. */
  function setup(share: number): Game {
    const s = defaultSettings();
    s.map.outposts = 2;
    s.armies.taskForces = share;
    const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
    for (const f of [0, 1]) {
      const b = game.field.baseSites[f];
      for (let i = 0; i < 8; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, f, b.x + (i % 4) * 3 - 4, b.z + Math.floor(i / 4) * 3);
    }
    return game;
  }

  it('sends a few squads to take an outpost between attacks, and they take it', () => {
    const game = setup(0.4);
    run(game, PICTURE_INTERVAL * 2);
    const forces = game.ctx.commander.taskForces.forces;
    expect(forces.length).toBeGreaterThan(0);
    for (const tf of forces) {
      // Within its share of the army, and short of the whole army.
      expect(tf.squads.length).toBeGreaterThan(0);
      expect(tf.squads.length).toBeLessThan(8);
    }
    expect(game.ctx.commander.sides[forces[0].side].goals.some((g) => g.kind === 'take' && g.force === forces[0].id)).toBe(true);
    run(game, 90);
    expect(game.ctx.outposts.some((o) => o.owner >= 0)).toBe(true);
  });

  it('sends none when off, or when the player has planted a rally flag', () => {
    const off = setup(0);
    run(off, 10);
    expect(off.ctx.commander.taskForces.forces).toEqual([]);
    const flagged = setup(0.4);
    for (const f of [0, 1]) flagged.setRally(f, flagged.field.baseSites[f]);
    run(flagged, 10);
    expect(flagged.ctx.commander.taskForces.forces).toEqual([]);
  });
});

describe('jobs that suit the unit', () => {
  function empty(): Game {
    const s = defaultSettings();
    s.map.outposts = 2;
    s.armies.taskForces = 0;
    return new Game(5, { settings: s, populate: false, autoSpawn: false });
  }

  it('sends flak to cover an outpost of its side that enemy aircraft are over', () => {
    const game = empty();
    const o = game.ctx.outposts[0];
    o.owner = 0;
    const b = game.field.baseSites[0];
    const flak = [0, 1].map((i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.flakTank, 0, b.x + i * 3, b.z));
    for (let i = 0; i < 3; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.gunship, 1, o.x + i * 2, o.z + 3);
    run(game, PICTURE_INTERVAL + DT);
    const jobs = flak.map((e) => game.ctx.commander.roles.jobFor(e));
    expect(jobs.some((j) => j?.kind === 'cover' && Math.hypot(j.x - o.x, j.z - o.z) < 1)).toBe(true);
    expect(game.ctx.commander.sides[0].jobs.cover).toBeGreaterThan(0);
  });

  it('keeps vehicles round the super unit on an attack', () => {
    const game = empty();
    game.ctx.offensive.attacking = () => true;
    const b = game.field.baseSites[0];
    const titan = spawnUnit(game.world, game.ctx, UNIT_DEFS.titan, 0, b.x, b.z);
    const tanks = [0, 1, 2, 3, 4].map((i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + 4 + i * 3, b.z));
    run(game, PICTURE_INTERVAL + DT);
    const escorts = tanks.filter((e) => game.ctx.commander.roles.jobFor(e)?.lead === titan);
    expect(escorts.length).toBe(3);
  });

  it('gives no jobs under a rally flag', () => {
    const game = empty();
    game.ctx.offensive.attacking = () => true;
    game.setRally(0, game.field.baseSites[0]);
    const b = game.field.baseSites[0];
    spawnUnit(game.world, game.ctx, UNIT_DEFS.titan, 0, b.x, b.z);
    const tank = spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + 4, b.z);
    run(game, PICTURE_INTERVAL + DT);
    expect(game.ctx.commander.roles.jobFor(tank)).toBeUndefined();
  });
});

describe('production advice and styles', () => {
  const picture = (enemy: Partial<SidePicture['enemyMix']>, enemyAir: number, antiAir: number): SidePicture => ({
    armyX: 0,
    armyZ: 0,
    ground: 100,
    air: 0,
    antiAir,
    mix: { infantry: 0, vehicle: 0, air: 0, super: 0, antiAir: 0, artillery: 0 },
    enemyMix: { infantry: 0, vehicle: 0, air: 0, super: 0, antiAir: 0, artillery: 0, ...enemy },
    enemyAir,
    needs: { antiAir: 0, antiArmour: 0 },
    goals: [],
    jobs: { cover: 0, overwatch: 0, escort: 0, build: 0 },
    detours: 0,
    detourPaths: [],
  });

  it('leans toward flak against aircraft it can’t answer, and away from it with none about', () => {
    const balanced = STYLES.balanced;
    const short = needsOf(picture({ air: 6 }, 400, 20));
    const flak = adviceFactor(UNIT_DEFS.flakTank, short, balanced, 0.3);
    expect(flak).toBeGreaterThan(1.15);
    expect(flak).toBeLessThanOrEqual(1.3);
    const none = needsOf(picture({ vehicle: 10 }, 0, 200));
    expect(adviceFactor(UNIT_DEFS.flakTank, none, balanced, 0.3)).toBeLessThan(1);
    expect(adviceFactor(UNIT_DEFS.flakTank, short, balanced, 0)).toBe(1);
  });

  it('leans toward hard hitters against armour and sprayers against infantry, within the limit', () => {
    const armour = needsOf(picture({ vehicle: 20 }, 0, 0));
    const infantry = needsOf(picture({ infantry: 90 }, 0, 0));
    expect(adviceFactor(UNIT_DEFS.lancer, armour, STYLES.balanced, 0.3)).toBeGreaterThan(1);
    expect(adviceFactor(UNIT_DEFS.lancer, infantry, STYLES.balanced, 0.3)).toBeLessThan(1);
    expect(adviceFactor(UNIT_DEFS.flameTrooper, infantry, STYLES.balanced, 0.3)).toBeGreaterThan(1);
    for (const def of Object.values(UNIT_DEFS)) {
      const k = adviceFactor(def, armour, STYLES.raider, 0.3);
      expect(k).toBeGreaterThanOrEqual(0.7 - 1e-9);
      expect(k).toBeLessThanOrEqual(1.3 + 1e-9);
    }
  });

  it('a cautious side sends out less than a raider', () => {
    const sent = (style: 'cautious' | 'raider') => {
      const s = defaultSettings();
      s.map.outposts = 2;
      s.factions[0].style = style;
      const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
      const b = game.field.baseSites[0];
      for (let i = 0; i < 12; i++) spawnUnit(game.world, game.ctx, UNIT_DEFS.tank, 0, b.x + (i % 4) * 3 - 4, b.z + Math.floor(i / 4) * 3);
      run(game, PICTURE_INTERVAL * 2);
      return game.ctx.commander.taskForces.forces.filter((tf) => tf.side === 0).reduce((n, tf) => n + tf.squads.length, 0);
    };
    expect(sent('raider')).toBeGreaterThan(sent('cautious'));
  });
});

describe('engineers', () => {
  const built = (id: string) => (game: Game, side: number) => [...game.world.query(Building, Faction, Transform)].filter((e) => game.world.req(e, Building).def.id === id && game.world.req(e, Faction).id === side);
  const walls = built('wall');
  const towers = built('fieldTower');
  const engineers = (game: Game, side: number) => [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Unit).def.builds && game.world.req(e, Faction).id === side);

  it('the HQ trains engineers, who wall off the front of the rally point and stay out of the army', () => {
    const game = new Game(7);
    run(game, 60);
    for (let side = 0; side < 2; side++) {
      // A field tower behind the line, within its low cap.
      expect(towers(game, side).length).toBeGreaterThan(0);
      expect(towers(game, side).length).toBeLessThanOrEqual(TOWERS_MOST);
      const built = walls(game, side);
      expect(built.length).toBeGreaterThan(0);
      expect(built.length).toBeLessThanOrEqual(WALLS_MOST);
      const crew = engineers(game, side);
      expect(crew.length).toBeGreaterThan(0);
      expect(crew.length).toBeLessThanOrEqual(game.settings.armies.engineers);
      // Nearer the rally point than home, and a little toward the enemy from it.
      const home = game.field.baseSites[side];
      const enemy = game.field.baseSites[1 - side];
      const rally = game.ctx.lanes.rally(side, 1 - side, 0);
      for (const w of built) {
        const t = game.world.req(w, Transform);
        expect(Math.hypot(t.x - rally.x, t.z - rally.z)).toBeLessThan(Math.hypot(t.x - home.x, t.z - home.z));
        expect(Math.hypot(t.x - enemy.x, t.z - enemy.z)).toBeLessThan(Math.hypot(rally.x - enemy.x, rally.z - enemy.z));
      }
      // No cap, no task force.
      for (const e of crew) expect(game.ctx.commander.taskForces.forSquad(game.world.req(e, Ai).squad)).toBeUndefined();
    }
    const counts = countByCategory(game.world, 2);
    const infantry = (side: number) => [...game.world.query(Unit, Faction)].filter((e) => game.world.req(e, Faction).id === side && game.world.req(e, Unit).def.category === 'infantry' && !game.world.req(e, Unit).def.builds && !game.world.has(e, Guard)).length;
    expect(counts[0].infantry).toBe(infantry(0));
  });

  it('builds nothing when off', () => {
    const s = defaultSettings();
    s.armies.engineers = 0;
    const game = new Game(7, { settings: s });
    run(game, 45);
    expect(walls(game, 0).length + walls(game, 1).length + towers(game, 0).length + towers(game, 1).length).toBe(0);
    expect(engineers(game, 0).length + engineers(game, 1).length).toBe(0);
  });

  it('walls crumble over their lifetime and leave no rubble', () => {
    const game = new Game(7, { populate: false, autoSpawn: false });
    const { world, ctx } = game;
    const b = game.field.baseSites[0];
    const def = ctx.buildings.wall;
    const w = spawnBuilding(world, ctx, def, 0, b.x + 6, b.z + 6, 0);
    const engineers = ctx.commander.engineers;
    engineers.update(world, ctx);
    engineers.tick(world, ctx, def.lasts! / 4);
    expect(world.req(w, Health).hp).toBeCloseTo(def.hp * 0.75, 3);
    engineers.tick(world, ctx, def.lasts!);
    game.step(DT);
    expect(world.isAlive(w)).toBe(false);
    expect([...world.query(Rubble)].length).toBe(0);
  });
});

describe('keeping out of where they’re weak', () => {
  function battery(avoidance = true) {
    const s = defaultSettings();
    s.armies.avoidance = avoidance;
    // A large map, so the lanes are far enough apart for one to be out of the battery's reach.
    s.map.size = 'large';
    const game = new Game(5, { settings: s, populate: false, autoSpawn: false });
    const { world, ctx } = game;
    // The enemy's tanks at home, and a mortar battery on the centre lane.
    const home = game.field.baseSites[1];
    for (let i = 0; i < 6; i++) spawnUnit(world, ctx, UNIT_DEFS.tank, 1, home.x + i * 2, home.z);
    const mid = ctx.lanes.lanes(0, 1)[0][1];
    for (let i = 0; i < 12; i++) spawnUnit(world, ctx, UNIT_DEFS.mortar, 1, mid.x + (i % 4) * 1.5, mid.z + Math.floor(i / 4) * 1.5);
    ctx.commander.update(world, ctx);
    return game;
  }

  it('maps artillery as a danger to infantry above the enemy’s usual mix, and not to vehicles', () => {
    const { ctx } = battery();
    const mid = ctx.lanes.lanes(0, 1)[0][1];
    const map = ctx.commander.threats;
    expect(map.excess(ctx, 0, 'infantry', map.usualShare(ctx, 0, 'infantry'), mid.x, mid.z)).toBeGreaterThan(50);
    expect(map.excess(ctx, 0, 'vehicle', map.usualShare(ctx, 0, 'vehicle'), mid.x, mid.z)).toBeLessThan(0);
  });

  it('sends infantry down another lane than the one the artillery covers, and leaves vehicles on it', () => {
    const game = battery();
    const { ctx } = game;
    expect(ctx.lanes.lanes(0, 1).length).toBeGreaterThan(1);
    expect(ctx.commander.avoidance.lane(ctx, 0, 1, 0, 'infantry')).not.toBe(0);
    expect(ctx.commander.avoidance.lane(ctx, 0, 1, 0, 'vehicle')).toBe(0);
    // Off, nothing changes.
    const off = battery(false);
    expect(off.ctx.commander.avoidance.lane(off.ctx, 0, 1, 0, 'infantry')).toBe(0);
  });
});
