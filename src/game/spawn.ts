import { Entity, World } from '../core/ecs';
import { BuildingDef } from './buildings';
import { productionFor } from './doctrines';
import {
  Ai,
  Ammo,
  Armed,
  Carrier,
  Building,
  Collider,
  Construction,
  Faction,
  GroundFollow,
  Health,
  makeNavState,
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
import { MOVE_RULES } from '../world/moveClasses';
import { UnitDef, WeaponDef } from './units';
import * as D from '../core/dmath';

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
    blocked: false,
    spotX: null,
    spotZ: null,
    aim,
    cooldown: ctx.rng.range(0, weapon.cooldown),
    burstLeft: 0,
    burstTimer: 0,
    firedAt: -Infinity,
    firedOn: null,
  };
}

/** A fresh squad id, for a group of units that should move together. */
export function newSquad(ctx: SimContext): number {
  return ctx.squads++;
}

/** Pick a point inside a side's base for a unit to push toward. */
export function objectiveIn(ctx: SimContext, faction: number): { x: number; z: number } {
  const base = ctx.field.baseSites[faction];
  return {
    x: base.x + ctx.rng.range(-0.6, 0.6) * base.radius,
    z: base.z + ctx.rng.range(-0.6, 0.6) * base.radius,
  };
}

/** How far round a rally point units spread, and how far an infantry soldier stands from the rest of the squad. */
const RALLY_SPREAD = 6;
const SQUAD_HUDDLE = 1.2;

/**
 * A unit's spot relative to its rally point (and the waypoints it marches
 * to). Vehicles each get their own. Infantry squads share one, with each
 * soldier close by, so a squad moves as a tight group instead of soldiers
 * scattering over the whole rally area (see separationSystem for how they
 * spread out again once a fight starts).
 */
function rallyOffset(ctx: SimContext, def: UnitDef, squad: number): { x: number; z: number } {
  const a = ctx.rng.range(0, Math.PI * 2);
  if (def.class !== 'infantry') {
    const r = Math.sqrt(ctx.rng.next()) * RALLY_SPREAD;
    return { x: D.cos(a) * r, z: D.sin(a) * r };
  }
  // The squad's spot: spread by the golden angle so squads don't pile onto each other.
  const sa = squad * 2.399963;
  const sr = Math.sqrt((squad * 0.618034) % 1) * RALLY_SPREAD;
  const r = Math.sqrt(ctx.rng.next()) * SQUAD_HUDDLE;
  return { x: D.cos(sa) * sr + D.cos(a) * r, z: D.sin(sa) * sr + D.sin(a) * r };
}

/**
 * Create a combat unit from its definition. The single place units are assembled.
 * Units spawned with the same `squad` (see newSquad) stick together on the same lane.
 */
export function spawnUnit(world: World, ctx: SimContext, def: UnitDef, faction: number, x: number, z: number, squad = newSquad(ctx)): Entity {
  // Face the middle of the map; the AI picks a real objective on its first think.
  const heading = D.atan2(z, -x);
  const e = world.create();
  world.add(e, Transform, makeTransform(x, MOVE_RULES[def.move].minDepth > 0 ? ctx.field.waterSurfaceAt(x, z) : ctx.field.surfaceAt(x, z), z, heading));
  world.add(e, Faction, { id: faction });
  world.add(e, Unit, { def });
  world.add(e, Targetable, { kind: 'unit' });
  world.add(e, Renderable, { model: def.model, scale: 1 });
  world.add(e, GroundFollow, { offset: MOVE_RULES[def.move].altitude });
  world.add(e, Mover, {
    speed: def.speed,
    turnRate: def.turnRate,
    targetX: null,
    targetZ: null,
    faceX: null,
    faceZ: null,
    move: def.move,
    nav: makeNavState(),
    ...(def.fixedWing ? { cruise: true, loiterX: x, loiterZ: z } : {}),
  });
  world.add(e, Health, { hp: def.hp, max: def.hp, armor: def.armor, lastHit: null, hurtAt: -Infinity });
  world.add(e, Collider, { radius: def.radius });
  world.add(
    e,
    Armed,
    armed(ctx, def.weapon, def.sight, def.turret, def.turret ? def.turretTurnRate : def.turnRate, def.radius * 0.8, heading, def.siege),
  );
  const offset = rallyOffset(ctx, def, squad);
  world.add(e, Ai, {
    objectiveX: x,
    objectiveZ: z,
    rallyOffsetX: offset.x,
    rallyOffsetZ: offset.z,
    squad,
    lane: 0,
    laneAttack: -1,
    target: -1,
    roleCheckAt: 0,
    threat: null,
    escort: null,
  });
  if (def.carries) world.add(e, Carrier, { loaded: true, reloadAt: 0 });
  if (def.ammo) world.add(e, Ammo, { left: def.ammo, max: def.ammo, rearming: false, readyAt: null });
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
  world.add(e, Health, { hp: construct ? def.hp * 0.3 : def.hp, max: def.hp, armor: def.armor, lastHit: null, hurtAt: -Infinity });
  world.add(e, Collider, { radius: def.radius });
  if (def.weapon && faction !== NEUTRAL) {
    world.add(e, Armed, armed(ctx, def.weapon, def.sight ?? def.weapon.range, true, def.turretTurnRate ?? 2, 0.4, heading));
  }
  const production = faction !== NEUTRAL ? productionFor(ctx, def, faction) : undefined;
  if (production) {
    world.add(e, Producer, {
      table: production.table,
      interval: production.interval,
      // Stagger first batches so buildings don't all fire on the same tick.
      timer: ctx.rng.range(0.3, 1) * production.interval,
      // The first one takes the full build, like the mech bay's after a loss.
      ...(production.flagship ? { flagship: production.flagship.unit, flagshipInterval: production.flagship.interval, flagshipTimer: production.flagship.interval } : {}),
    });
  }
  if (construct) {
    world.add(e, Construction, { elapsed: 0, duration: def.buildTime });
    ctx.events.emit('constructionStarted', { entity: e, x, y, z, def });
  }
  return e;
}
