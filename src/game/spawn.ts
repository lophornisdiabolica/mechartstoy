import { Entity, World } from '../core/ecs';
import { BuildingDef } from './buildings';
import {
  Ai,
  Armed,
  Building,
  Collider,
  Construction,
  Faction,
  GroundFollow,
  Health,
  makeTransform,
  Mover,
  NEUTRAL,
  Producer,
  Renderable,
  Targetable,
  Transform,
  Unit,
} from './components';
import { SimContext } from './context';
import { UnitDef, WeaponDef } from './units';

function armed(
  ctx: SimContext,
  weapon: WeaponDef,
  sight: number,
  turret: boolean,
  turnRate: number,
  muzzleOffset: number,
  aim: number,
  siege = false,
): Armed {
  return {
    weapon,
    sight,
    turret,
    turnRate,
    muzzleOffset,
    siege,
    target: null,
    nextTargetAt: 0,
    aim,
    cooldown: ctx.rng.range(0, weapon.cooldown),
    burstLeft: 0,
    burstTimer: 0,
  };
}

/** Pick a point inside the enemy base for a unit to push toward. */
export function enemyObjective(ctx: SimContext, faction: number): { x: number; z: number } {
  const base = ctx.field.baseSites.find((s) => s.faction !== faction)!;
  return {
    x: base.x + ctx.rng.range(-0.6, 0.6) * base.radius,
    z: base.z + ctx.rng.range(-0.6, 0.6) * base.radius,
  };
}

/** A spot in front of a faction's own base where idle units gather. */
export function rallyPoint(ctx: SimContext, faction: number): { x: number; z: number } {
  const base = ctx.field.baseSites.find((s) => s.faction === faction)!;
  const forward = faction === 0 ? 1 : -1;
  for (let tries = 0; tries < 10; tries++) {
    const x = base.x + forward * (base.radius + ctx.rng.range(4, 12));
    const z = base.z + ctx.rng.range(-0.8, 0.8) * base.radius;
    if (!ctx.field.isWater(x, z)) return { x, z };
  }
  return { x: base.x + forward * base.radius, z: base.z };
}

/** Create a combat unit from its definition. The single place units are assembled. */
export function spawnUnit(world: World, ctx: SimContext, def: UnitDef, faction: number, x: number, z: number): Entity {
  const objective = enemyObjective(ctx, faction);
  const heading = Math.atan2(-(objective.z - z), objective.x - x);
  const e = world.create();
  world.add(e, Transform, makeTransform(x, ctx.field.surfaceAt(x, z), z, heading));
  world.add(e, Faction, { id: faction });
  world.add(e, Unit, { def });
  world.add(e, Targetable, { kind: 'unit' });
  world.add(e, Renderable, { model: def.model, scale: 1 });
  world.add(e, GroundFollow, { offset: 0 });
  world.add(e, Mover, { speed: def.speed, turnRate: def.turnRate, targetX: null, targetZ: null, canCrossWater: false });
  world.add(e, Health, { hp: def.hp, max: def.hp, armor: def.armor });
  world.add(e, Collider, { radius: def.radius });
  world.add(
    e,
    Armed,
    armed(ctx, def.weapon, def.sight, def.turret, def.turret ? def.turretTurnRate : def.turnRate, def.radius * 0.8, heading, def.siege),
  );
  const rally = rallyPoint(ctx, faction);
  world.add(e, Ai, { objectiveX: objective.x, objectiveZ: objective.z, rallyX: rally.x, rallyZ: rally.z });
  ctx.events.emit('spawned', { entity: e, def, faction });
  return e;
}

/**
 * Create a building. With `construct`, it starts as a construction site that
 * rises over the def's buildTime before it produces or shoots.
 */
export function spawnBuilding(
  world: World,
  ctx: SimContext,
  def: BuildingDef,
  faction: number,
  x: number,
  z: number,
  heading: number,
  construct = false,
): Entity {
  const e = world.create();
  const y = ctx.field.heightAt(x, z);
  world.add(e, Transform, makeTransform(x, y, z, heading));
  world.add(e, Faction, { id: faction });
  world.add(e, Building, { def });
  world.add(e, Targetable, { kind: 'building' });
  world.add(e, Renderable, { model: def.model, scale: 1 });
  world.add(e, Health, { hp: construct ? def.hp * 0.3 : def.hp, max: def.hp, armor: def.armor });
  world.add(e, Collider, { radius: def.radius });
  if (def.weapon && faction !== NEUTRAL) {
    world.add(e, Armed, armed(ctx, def.weapon, def.sight ?? def.weapon.range, true, def.turretTurnRate ?? 2, 0.4, heading));
  }
  if (def.production && faction !== NEUTRAL) {
    world.add(e, Producer, {
      table: def.production.table,
      interval: def.production.interval,
      // Stagger first batches so buildings don't all fire on the same tick.
      timer: ctx.rng.range(0.3, 1) * def.production.interval,
    });
  }
  if (construct) {
    world.add(e, Construction, { elapsed: 0, duration: def.buildTime });
    ctx.events.emit('constructionStarted', { entity: e, x, y, z, def });
  }
  return e;
}
