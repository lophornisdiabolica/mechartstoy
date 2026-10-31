import { Entity, World } from '../core/ecs';
import { Ai, Armed, Collider, Faction, GroundFollow, Health, makeTransform, Mover, Renderable, Transform, Unit } from './components';
import { SimContext } from './context';
import { UnitDef } from './units';

/** Create a combat unit from its definition. The single place units are assembled. */
export function spawnUnit(world: World, ctx: SimContext, def: UnitDef, faction: number, x: number, z: number): Entity {
  const enemyBase = ctx.field.baseSites.find((s) => s.faction !== faction)!;
  const heading = Math.atan2(-(enemyBase.z - z), enemyBase.x - x);
  const e = world.create();
  world.add(e, Transform, makeTransform(x, ctx.field.surfaceAt(x, z), z, heading));
  world.add(e, Faction, { id: faction });
  world.add(e, Unit, { def });
  world.add(e, Renderable, { model: def.model, scale: 1 });
  world.add(e, GroundFollow, { offset: 0 });
  world.add(e, Mover, { speed: def.speed, turnRate: def.turnRate, targetX: null, targetZ: null, canCrossWater: false });
  world.add(e, Health, { hp: def.hp, max: def.hp });
  world.add(e, Collider, { radius: def.radius });
  world.add(e, Armed, {
    weapon: def.weapon,
    target: null,
    aim: heading,
    cooldown: ctx.rng.range(0, def.weapon.cooldown),
    burstLeft: 0,
    burstTimer: 0,
  });
  world.add(e, Ai, {
    // Spread units across the enemy base so they don't all converge on one point.
    objectiveX: enemyBase.x + ctx.rng.range(-0.6, 0.6) * enemyBase.radius,
    objectiveZ: enemyBase.z + ctx.rng.range(-0.6, 0.6) * enemyBase.radius,
    nextThinkAt: world.time + ctx.rng.range(0, 0.5),
  });
  ctx.events.emit('spawned', { entity: e, def, faction });
  return e;
}
