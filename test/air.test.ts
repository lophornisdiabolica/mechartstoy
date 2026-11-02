import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS } from '../src/game/buildings';
import { Ai, Armed, Health, makeTransform, Projectile, Transform } from '../src/game/components';
import { DOCTRINE_IDS, DOCTRINES, doctrineUnits } from '../src/game/doctrines';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { newSquad, spawnBuilding, spawnUnit } from '../src/game/spawn';
import { alert } from '../src/game/systems/movement';
import { applyDamage } from '../src/game/systems/projectiles';
import { canHit } from '../src/game/systems/targeting';
import { UNIT_DEFS } from '../src/game/units';
import { MOVE_RULES } from '../src/world/moveClasses';

const DT = 1 / 30;

function run(game: Game, seconds: number): void {
  for (let i = 0; i < seconds / DT; i++) game.step(DT);
}

/** An empty map with production off (see territory.test.ts). */
function emptyGame(seed = 4): Game {
  const s = defaultSettings();
  s.armies.caps.super = 0;
  const game = new Game(seed, { settings: s, populate: false });
  for (const site of game.field.baseSites) {
    const a = Math.atan2(-site.z, -site.x);
    spawnBuilding(game.world, game.ctx, BUILDING_DEFS.mechbay, site.faction, site.x - Math.cos(a) * site.radius * 0.7, site.z - Math.sin(a) * site.radius * 0.7, 0);
  }
  return game;
}

describe('aircraft', () => {
  it('fly at their altitude, and only anti-air weapons can shoot at them', () => {
    const game = emptyGame();
    const site = game.field.baseSites[1];
    const scout = spawnUnit(game.world, game.ctx, UNIT_DEFS.scout, 1, site.x, site.z);
    run(game, 0.1);
    const t = game.world.req(scout, Transform);
    expect(t.y - game.field.surfaceAt(t.x, t.z)).toBeCloseTo(MOVE_RULES.air.altitude, 1);
    const rifleman = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, site.x - 5, site.z);
    const at = spawnUnit(game.world, game.ctx, UNIT_DEFS.atTrooper, 0, site.x - 5, site.z + 1);
    const flak = spawnUnit(game.world, game.ctx, UNIT_DEFS.flakTank, 0, site.x - 6, site.z - 2);
    expect(canHit(game.world, game.world.req(rifleman, Armed), scout)).toBe(false);
    expect(canHit(game.world, game.world.req(at, Armed), scout)).toBe(true);
    expect(canHit(game.world, game.world.req(flak, Armed), scout)).toBe(true);
  });

  it('a shell bursting on the ground hurts the soldier there, not the aircraft overhead', () => {
    const game = emptyGame();
    const site = game.field.baseSites[1];
    const soldier = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 1, site.x, site.z);
    const scout = spawnUnit(game.world, game.ctx, UNIT_DEFS.scout, 1, site.x, site.z);
    for (const e of [soldier, scout]) game.world.remove(e, Ai);
    run(game, 0.1);
    const ground = game.field.surfaceAt(site.x, site.z);
    const shell = game.world.create();
    game.world.add(shell, Transform, makeTransform(site.x, ground, site.z, 0));
    game.world.add(shell, Projectile, {
      kind: 'artillery',
      weapon: UNIT_DEFS.howitzer.weapon,
      faction: 0,
      source: 'howitzer',
      target: null,
      sx: site.x,
      sy: ground,
      sz: site.z,
      ex: site.x,
      ey: ground,
      ez: site.z,
      arcHeight: 0,
      elapsed: 0,
      duration: 0.01,
    });
    run(game, 0.1);
    expect(game.world.isAlive(soldier) ? game.world.req(soldier, Health).hp : 0).toBeLessThan(UNIT_DEFS.trooper.hp);
    expect(game.world.req(scout, Health).hp).toBe(UNIT_DEFS.scout.hp);
  });

  it('a shot-down aircraft falls to the ground', () => {
    const game = emptyGame();
    const site = game.field.baseSites[1];
    const scout = spawnUnit(game.world, game.ctx, UNIT_DEFS.scout, 1, site.x, site.z);
    run(game, 0.1);
    applyDamage(game.world, game.ctx, scout, 1e6);
    run(game, 2);
    const t = game.world.req(scout, Transform);
    expect(t.y - game.field.surfaceAt(t.x, t.z)).toBeLessThan(0.5);
  });

  it('every doctrine fields an aircraft and something that can shoot one down', () => {
    for (const id of DOCTRINE_IDS) {
      const units = doctrineUnits(DOCTRINES[id]).map((u) => UNIT_DEFS[u]);
      expect(units.some((u) => u.category === 'air'), id).toBe(true);
      expect(units.some((u) => u.category !== 'air' && u.weapon.targets !== 'ground'), id).toBe(true);
    }
    // The howitzer is saved for the Bastion doctrine.
    expect(doctrineUnits(DOCTRINES.armour)).not.toContain('howitzer');
  });
});

describe('infantry formations', () => {
  it('a squad gathers round one spot, not scattered over the rally ground', () => {
    const game = emptyGame();
    const site = game.field.baseSites[0];
    const squad = newSquad(game.ctx);
    const offsets = Array.from({ length: 6 }, () => {
      const e = spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, site.x, site.z, squad);
      const ai = game.world.req(e, Ai);
      return { x: ai.rallyOffsetX, z: ai.rallyOffsetZ };
    });
    for (const a of offsets) for (const b of offsets) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(2.5);
  });

  it('infantry march huddled and open out once a fight starts', () => {
    const game = emptyGame();
    const site = game.field.baseSites[0];
    const squad = newSquad(game.ctx);
    const soldiers = Array.from({ length: 8 }, (_, i) => spawnUnit(game.world, game.ctx, UNIT_DEFS.trooper, 0, site.x + (i % 4) * 0.2, site.z + Math.floor(i / 4) * 0.2, squad));
    for (const e of soldiers) game.world.remove(e, Ai);
    const spread = () => {
      const ts = soldiers.map((e) => game.world.req(e, Transform));
      let near = Infinity;
      for (const a of ts) for (const b of ts) if (a !== b) near = Math.min(near, Math.hypot(a.x - b.x, a.z - b.z));
      return near;
    };
    run(game, 3);
    expect(soldiers.some((e) => alert(game.world, e))).toBe(false);
    const huddled = spread();
    expect(huddled).toBeLessThan(0.8);
    for (const e of soldiers) applyDamage(game.world, game.ctx, e, 0.001);
    expect(alert(game.world, soldiers[0])).toBe(true);
    run(game, 3);
    expect(spread()).toBeGreaterThan(huddled + 0.5);
  });
});
