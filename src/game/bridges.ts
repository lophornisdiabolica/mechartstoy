import { Entity, System, World } from '../core/ecs';
import { distanceToSegment, mapBridgeNear } from '../world/battlefield';
import { MOVE_RULES } from '../world/moveClasses';
import { Faction, GroundFollow, Health, Hit, Mover, Targetable, Transform, Unit, Wreck } from './components';
import { SimContext } from './context';
import { Outpost } from './outposts';
import { damageThrough } from './systems/projectiles';
import * as D from '../core/dmath';

/*
 * The map's own bridges in a battle (engineers' bridges are in
 * commander/engineers.ts).
 *
 * Falling bridges (the Bridges fall setting). A bridge is nobody's and
 * takes a lot of punishment, but every shot that bursts on it or by it
 * wears it down, whoever fired it, and under heavy fire it comes down,
 * taking whatever's on it into the water. It stays down: the crossing's
 * cut, and the sides' engineers bridge it again if the way round is long
 * (see commander/engineers.ts), so a fight over a bridge can end with a
 * fight to rebuild it.
 *
 * Drawbridges (the drawbridge outpost). Whoever holds one works the bridge
 * by it: up when the holder's enemies come near it and nobody's on it, so
 * they can't cross there, and down again once they've gone, for the
 * holder's own to cross. Held by its garrison it stays down.
 */

/** How much a map bridge takes before it comes down, and its armour. */
const BRIDGE_HP = 1500;
const BRIDGE_ARMOR = 10;
/** Seconds between drawbridge checks. */
const TICK = 1;
/** Enemies of the holder this near either end of a drawbridge (or on it) get it raised; with none this near, it comes down again. */
const RAISE_REACH = 16;
const LOWER_REACH = 24;
/** The map's bridges' wear, the ones that have fallen, and which are drawbridges. */
export class BridgeWear {
  private readonly hp = new Map<number, number>();
  /** Bridges that came down for good. */
  readonly fallen = new Set<number>();
  /** Units that went into the water with a bridge: their wrecks sink (see bridgeSystem). */
  readonly drowned = new Set<Entity>();

  constructor(readonly on: boolean) {}

  /** A shot burst at a point: a map bridge it's on or bursts by takes the hit (see projectiles.ts). */
  blast(world: World, ctx: SimContext, x: number, y: number, z: number, damage: number, splash: number, by: Hit): void {
    if (!this.on) return;
    const bridges = ctx.field.bridges;
    for (let k = 0; k < bridges.length; k++) {
      const b = bridges[k];
      if (b.gone || b.builtBy !== undefined) continue;
      const off = distanceToSegment(x, z, b.ax, b.az, b.bx, b.bz);
      if (off > b.width / 2 + splash || y > b.level + 2 + splash) continue;
      const hp = (this.hp.get(k) ?? BRIDGE_HP) - damageThrough(damage * (off <= b.width / 2 ? 1 : 0.5), BRIDGE_ARMOR);
      this.hp.set(k, hp);
      if (hp <= 0) this.collapse(world, ctx, k, by);
    }
  }

  /** How worn a bridge is: 1 sound, 0 down. */
  health(k: number): number {
    return this.fallen.has(k) ? 0 : Math.max(0, this.hp.get(k) ?? BRIDGE_HP) / BRIDGE_HP;
  }

  /** A map bridge comes down for good, and whatever's on it goes in the water. */
  collapse(world: World, ctx: SimContext, k: number, by: Hit | null): void {
    const b = ctx.field.bridges[k];
    if (!b || b.gone) return;
    this.fallen.add(k);
    for (const e of onDeck(world, ctx, k)) {
      const h = world.get(e, Health);
      if (!h) continue;
      if (by) h.lastHit = by;
      h.hp = 0;
      this.drowned.add(e);
    }
    ctx.field.removeBridge(k);
    ctx.events.emit('bridgeFell', { x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2 });
  }
}

/** How fast a drowned unit's wreck sinks, and how far down it's gone. */
const SINK_SPEED = 0.6;
const SUNK = 3;

/** The wrecks of what went into the water with a fallen bridge sink out of sight, leaving no heap (see BridgeWear.collapse). */
export function sinkingSystem(ctx: SimContext): System {
  return {
    name: 'sinking',
    update(world, dt) {
      for (const e of ctx.bridges.drowned) {
        if (!world.isAlive(e)) {
          ctx.bridges.drowned.delete(e);
          continue;
        }
        const wreck = world.get(e, Wreck);
        const g = world.get(e, GroundFollow);
        if (!wreck || !g) continue;
        wreck.mass = 0;
        g.offset -= SINK_SPEED * dt;
        if (g.offset < -SUNK) {
          ctx.bridges.drowned.delete(e);
          world.destroy(e);
        }
      }
    },
  };
}

/** Land units on a bridge's deck over the water. */
function onDeck(world: World, ctx: SimContext, k: number): Entity[] {
  const b = ctx.field.bridges[k];
  const out: Entity[] = [];
  if (!b) return out;
  const mx = (b.ax + b.bx) / 2;
  const mz = (b.az + b.bz) / 2;
  const reach = D.hypot(b.bx - b.ax, b.bz - b.az) / 2 + b.width;
  ctx.grid.forEachNear(mx, mz, reach, (e) => {
    if (world.get(e, Targetable)?.kind !== 'unit') return;
    const t = world.req(e, Transform);
    const move = world.get(e, Mover)?.move;
    if (!move || move === 'naval' || MOVE_RULES[move].flies) return;
    if (ctx.field.bridgeAt(t.x, t.z) === k && ctx.field.deckAt(t.x, t.z) !== null) out.push(e);
  });
  return out;
}

/** The map bridge a drawbridge outpost works: the nearest one within reach, or -1. */
export function drawbridgeOf(ctx: SimContext, o: { x: number; z: number }): number {
  return mapBridgeNear(ctx.field, o.x, o.z).bridge;
}

/** Works the drawbridges for whoever holds them. */
export function drawbridgeSystem(ctx: SimContext): System {
  const works: { outpost: Outpost; bridge: number }[] = [];
  for (const o of ctx.outposts) {
    if (!o.kind.draws) continue;
    const k = drawbridgeOf(ctx, o);
    if (k >= 0) works.push({ outpost: o, bridge: k });
  }
  let acc = 0;
  return {
    name: 'drawbridges',
    update(world, dt) {
      if (works.length === 0) return;
      acc += dt;
      if (acc < TICK) return;
      acc = 0;
      for (const { outpost, bridge } of works) {
        if (ctx.bridges.fallen.has(bridge)) continue;
        const b = ctx.field.bridges[bridge];
        const up = b.gone === true;
        const holder = outpost.owner;
        if (holder < 0) {
          // Its garrison leaves it down.
          if (up) lower(ctx, outpost, bridge);
          continue;
        }
        const enemies = (reach: number) => enemiesNear(world, ctx, holder, b, reach);
        if (!up && enemies(RAISE_REACH) && onDeck(world, ctx, bridge).length === 0) {
          ctx.field.removeBridge(bridge, true);
          ctx.events.emit('drawbridge', { outpost: outpost.index, faction: holder, up: true, x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2 });
        } else if (up && !enemies(LOWER_REACH)) lower(ctx, outpost, bridge);
      }
    },
  };
}

function lower(ctx: SimContext, outpost: Outpost, k: number): void {
  const b = ctx.field.bridges[k];
  // Engineers threw their own bridge over while it was up: it stays up, out of that one's way.
  const mx = (b.ax + b.bx) / 2;
  const mz = (b.az + b.bz) / 2;
  if (ctx.field.bridges.some((o, j) => j !== k && !o.gone && distanceToSegment(mx, mz, o.ax, o.az, o.bx, o.bz) < o.width / 2 + b.width)) return;
  ctx.field.restoreBridge(k);
  ctx.events.emit('drawbridge', { outpost: outpost.index, faction: outpost.owner, up: false, x: (b.ax + b.bx) / 2, z: (b.az + b.bz) / 2 });
}

/** Whether any land unit hostile to `side` is within `reach` of either end of a bridge, or on it. */
function enemiesNear(world: World, ctx: SimContext, side: number, b: { ax: number; az: number; bx: number; bz: number }, reach: number): boolean {
  let found = false;
  const mx = (b.ax + b.bx) / 2;
  const mz = (b.az + b.bz) / 2;
  const half = D.hypot(b.bx - b.ax, b.bz - b.az) / 2;
  ctx.grid.forEachNear(mx, mz, half + reach, (e) => {
    if (found || world.get(e, Targetable)?.kind !== 'unit' || !world.has(e, Unit)) return;
    const f = world.get(e, Faction);
    if (!f || !ctx.sides.hostile(side, f.id)) return;
    const move = world.get(e, Mover)?.move;
    if (!move || move === 'naval' || MOVE_RULES[move].flies) return;
    const t = world.req(e, Transform);
    if (distanceToSegment(t.x, t.z, b.ax, b.az, b.bx, b.bz) < reach) found = true;
  });
  return found;
}
