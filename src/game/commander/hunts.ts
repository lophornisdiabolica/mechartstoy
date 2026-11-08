import { Entity, World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Ai, Armed, Faction, Guard, Health, Mover, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { fightingStrength } from '../offensive';
import { MAP_SIZES } from '../settings';
import * as D from '../../core/dmath';

/*
 * Hunting the guns. A howitzer or rocket truck shelling a side from far
 * behind its own lines (spotted for by a scout copter or a comms array, out
 * of reach of anything at the front) is something a Commander can do
 * something about: it sends a few of its fastest squads off to kill it. If
 * the enemy's army stands between them and the gun, they swing wide round
 * one side first and come at it from the flank; once there, they charge the
 * gun, and shoot it before anything else in reach (see targeting.ts).
 *
 * A hunt ends when the gun is dead, the hunters are spent, or it's taken too
 * long. A side runs one hunt at a time, and an attack on its base, the
 * rally flag or a stance other than auto call it off, like every other job.
 */

/** Artillery with at least this much range counts as a long-range gun worth hunting. */
const LONG_RANGE = 18;
/** A gun counts as shelling us if it fired in the last this many seconds at something of ours. */
const FIRING_WITHIN = 10;
/** No hunt for a gun with our own units this close already (they're on it). */
const ALREADY_ON = 12;
/** How far round the gun enemies count as guarding it. */
const GUARD_RADIUS = 14;
/** Hunters need this many times the guard's strength, and at least LEAST_FORCE. */
const MARGIN = 1.3;
const LEAST_FORCE = 45;
/** Most of the army a hunt takes. */
const BUDGET = 0.3;
/** How far out to the side of the gun the flank point is, and how far back toward the hunters. */
const FLANK_OUT = 18;
const FLANK_BACK = 4;
/** Enemy strength on the straight way to the gun, as a share of the hunters', that makes them go round instead. */
const IN_THE_WAY = 0.5;
/** Hunters this close to the flank point (on average) turn in for the gun. */
const FLANK_REACHED = 8;
/** A hunt is spent at this share of its starting strength. */
const SPENT = 0.4;
/** Seconds (on a medium map) a hunt gets before it's called off, and before the side hunts again after one ends. */
const TIMEOUT = 150;
const COOLDOWN = 25;

export interface Hunt {
  id: number;
  side: number;
  /** The gun, and where it was last seen. */
  gun: Entity;
  gunId: string;
  x: number;
  z: number;
  /** The point round the side they come in from, or null to go straight at it. */
  flankX: number | null;
  flankZ: number | null;
  stage: 'flank' | 'strike';
  squads: number[];
  launch: number;
  strength: number;
  since: number;
  /** Where the hunters are, on average. */
  fromX: number;
  fromZ: number;
}

interface SquadInfo {
  side: number;
  strength: number;
  x: number;
  z: number;
  units: number;
  /** Slowest unit's speed: the squad goes at its pace. */
  speed: number;
  free: boolean;
}

function squadsOf(world: World): Map<number, SquadInfo> {
  const out = new Map<number, SquadInfo>();
  for (const e of world.query(Ai, Unit, Faction, Transform, Health, Mover)) {
    if (world.has(e, Guard)) continue;
    const side = world.req(e, Faction).id;
    if (side < 0) continue;
    const def = world.req(e, Unit).def;
    if (def.builds) continue;
    const squad = world.req(e, Ai).squad;
    const t = world.req(e, Transform);
    const mover = world.req(e, Mover);
    let s = out.get(squad);
    if (!s) out.set(squad, (s = { side, strength: 0, x: 0, z: 0, units: 0, speed: Infinity, free: true }));
    s.strength += fightingStrength(world, e);
    s.x += t.x;
    s.z += t.z;
    s.units++;
    s.speed = Math.min(s.speed, mover.speed);
    // Boats can't go overland, aircraft have their own targets, and the super unit and artillery stay with the army.
    if (mover.move === 'naval' || MOVE_RULES[mover.move].flies || def.category === 'super' || def.role === 'artillery') s.free = false;
  }
  for (const s of out.values()) {
    s.x /= s.units;
    s.z /= s.units;
  }
  return out;
}

/** Enemy strength within `radius` of a point, as `side` sees it. */
function enemyNear(world: World, ctx: SimContext, side: number, x: number, z: number, radius: number): number {
  let sum = 0;
  ctx.grid.forEachNear(x, z, radius, (e: Entity) => {
    const f = world.get(e, Faction);
    if (f && ctx.sides.hostile(side, f.id)) sum += fightingStrength(world, e);
  });
  return sum;
}

/** Whether any of a side's units is within `radius` of a point. */
function oursNear(world: World, ctx: SimContext, side: number, x: number, z: number, radius: number): boolean {
  let found = false;
  ctx.grid.forEachNear(x, z, radius, (e: Entity) => {
    if (!found && world.get(e, Targetable)?.kind === 'unit' && world.get(e, Faction)?.id === side) found = true;
  });
  return found;
}

export class Hunts {
  hunts: Hunt[] = [];
  private bySquad = new Map<number, Hunt>();
  private nextId = 0;
  /** Per side: when it may start its next hunt. */
  private nextAt: number[] = [];

  /** The hunt a squad is on, if any. */
  forSquad(squad: number): Hunt | undefined {
    return this.bySquad.get(squad);
  }

  /** Re-plan every side's hunt. `busy` says whether a squad is on another job (a task force). */
  update(world: World, ctx: SimContext, busy: (squad: number) => boolean): void {
    const time = world.time;
    const kept: Hunt[] = [];
    if (!ctx.settings.armies.hunts) {
      this.hunts = [];
      this.bySquad.clear();
      return;
    }
    const scale = Math.max(1, ctx.field.config.cols / MAP_SIZES.medium.cols);
    const squads = squadsOf(world);
    for (let side = 0; side < ctx.sides.count; side++) {
      const orders = ctx.orders[side];
      const free = !ctx.sides.eliminated[side] && orders.stance === 'auto' && orders.rally === null && !ctx.sides.recalling[side] && !ctx.sides.underAttack(side);
      const mine = this.hunts.filter((h) => h.side === side);
      if (!free) {
        if (mine.length > 0) this.nextAt[side] = time + COOLDOWN * scale;
        continue;
      }
      let running = false;
      for (const h of mine) {
        h.squads = h.squads.filter((q) => squads.has(q));
        let x = 0;
        let z = 0;
        let units = 0;
        h.strength = 0;
        for (const q of h.squads) {
          const s = squads.get(q)!;
          h.strength += s.strength;
          x += s.x * s.units;
          z += s.z * s.units;
          units += s.units;
        }
        const alive = world.isAlive(h.gun) && world.has(h.gun, Targetable);
        if (!alive || units === 0 || h.strength < h.launch * SPENT || time - h.since > TIMEOUT * scale) {
          this.nextAt[side] = time + COOLDOWN * scale;
          if (!alive && units > 0) ctx.events.emit('hunt', { faction: side, x: h.x, z: h.z, unit: h.gunId, done: true });
          continue;
        }
        const gt = world.req(h.gun, Transform);
        h.x = gt.x;
        h.z = gt.z;
        h.fromX = x / units;
        h.fromZ = z / units;
        if (h.stage === 'flank' && (h.flankX === null || h.flankZ === null || D.hypot(h.fromX - h.flankX, h.fromZ - h.flankZ) < FLANK_REACHED || D.hypot(h.fromX - h.x, h.fromZ - h.z) < GUARD_RADIUS)) h.stage = 'strike';
        kept.push(h);
        running = true;
      }
      if (!running && time >= (this.nextAt[side] ?? 0)) {
        const h = this.plan(world, ctx, side, squads, busy, kept, time);
        if (h) kept.push(h);
      }
    }
    this.hunts = kept;
    this.bySquad.clear();
    for (const h of kept) for (const q of h.squads) this.bySquad.set(q, h);
  }

  /** A new hunt for a side: the long-range gun shelling it that's cheapest to get at, if it can spare the squads. */
  private plan(world: World, ctx: SimContext, side: number, squads: Map<number, SquadInfo>, busy: (squad: number) => boolean, hunts: Hunt[], time: number): Hunt | null {
    const taken = new Set(hunts.flatMap((h) => h.squads));
    let army = 0;
    const free: [number, SquadInfo][] = [];
    for (const [q, s] of squads) {
      if (s.side !== side) continue;
      army += s.strength;
      if (s.free && !busy(q) && !taken.has(q)) free.push([q, s]);
    }
    const budget = army * BUDGET;
    if (budget < LEAST_FORCE || free.length === 0) return null;
    // The guns shelling us from beyond our reach.
    let best: { gun: Entity; id: string; x: number; z: number; need: number; cost: number } | null = null;
    for (const e of world.query(Unit, Armed, Faction, Transform, Mover)) {
      const f = world.req(e, Faction).id;
      if (!ctx.sides.hostile(side, f) || world.has(e, Guard)) continue;
      const def = world.req(e, Unit).def;
      const armed = world.req(e, Armed);
      if (def.role !== 'artillery' || armed.weapon.range < LONG_RANGE) continue;
      const move = world.req(e, Mover).move;
      if (move === 'naval' || MOVE_RULES[move].flies) continue;
      if (time - armed.firedAt > FIRING_WITHIN || armed.firedOn === null || !ctx.sides.allied(armed.firedOn, side)) continue;
      const t = world.req(e, Transform);
      if (oursNear(world, ctx, side, t.x, t.z, ALREADY_ON)) continue;
      // Not into its base: that's what attacks are for.
      if (ctx.field.baseSites.some((b, g) => ctx.sides.hostile(side, g) && D.hypot(b.x - t.x, b.z - t.z) < b.radius + 6)) continue;
      const need = Math.max(LEAST_FORCE, enemyNear(world, ctx, side, t.x, t.z, GUARD_RADIUS) * MARGIN);
      if (need > budget) continue;
      const home = ctx.field.baseSites[side];
      const cost = need + D.hypot(t.x - home.x, t.z - home.z) * 0.5;
      if (!best || cost < best.cost) best = { gun: e, id: def.id, x: t.x, z: t.z, need, cost };
    }
    if (!best) return null;
    const gun = best;
    // The quickest squads to get there first.
    const eta = (s: SquadInfo) => D.hypot(s.x - gun.x, s.z - gun.z) / Math.max(0.5, s.speed);
    free.sort((a, b) => eta(a[1]) - eta(b[1]) || a[0] - b[0]);
    const picked: number[] = [];
    let strength = 0;
    let x = 0;
    let z = 0;
    let units = 0;
    for (const [q, s] of free) {
      if (strength >= gun.need) break;
      picked.push(q);
      strength += s.strength;
      x += s.x * s.units;
      z += s.z * s.units;
      units += s.units;
    }
    if (strength < gun.need || strength > budget * 1.25) return null;
    const fromX = x / units;
    const fromZ = z / units;
    const flank = this.flank(world, ctx, side, fromX, fromZ, gun.x, gun.z, strength);
    ctx.events.emit('hunt', { faction: side, x: gun.x, z: gun.z, unit: gun.id, done: false });
    return {
      id: this.nextId++,
      side,
      gun: gun.gun,
      gunId: gun.id,
      x: gun.x,
      z: gun.z,
      flankX: flank?.x ?? null,
      flankZ: flank?.z ?? null,
      stage: flank ? 'flank' : 'strike',
      squads: picked,
      launch: strength,
      strength,
      since: time,
      fromX,
      fromZ,
    };
  }

  /**
   * Where hunters coming from (fx, fz) swing round to, to come at a gun from
   * the side: null if the straight way there is clear enough, else the side
   * with less of the enemy about it.
   */
  private flank(world: World, ctx: SimContext, side: number, fx: number, fz: number, gx: number, gz: number, strength: number): { x: number; z: number } | null {
    const d = Math.max(1, D.hypot(gx - fx, gz - fz));
    const ux = (fx - gx) / d;
    const uz = (fz - gz) / d;
    // What's on the straight way: halfway, and two-thirds of the way.
    const inWay = Math.max(
      enemyNear(world, ctx, side, (fx + gx) / 2, (fz + gz) / 2, GUARD_RADIUS),
      enemyNear(world, ctx, side, fx + (gx - fx) * 0.66, fz + (gz - fz) * 0.66, GUARD_RADIUS),
    );
    if (inWay < strength * IN_THE_WAY) return null;
    const nav = ctx.navs.for('tracked');
    let best: { x: number; z: number; danger: number } | null = null;
    for (const sign of [1, -1]) {
      const px = gx - uz * FLANK_OUT * sign + ux * FLANK_BACK;
      const pz = gz + ux * FLANK_OUT * sign + uz * FLANK_BACK;
      if (!ctx.field.contains(px, pz, 4)) continue;
      const cell = nav.nearestOpen(px, pz, 5);
      if (!cell) continue;
      const p = nav.center(cell[0], cell[1]);
      // Danger on the way out there and at the point itself.
      const danger = enemyNear(world, ctx, side, p.x, p.z, GUARD_RADIUS) + enemyNear(world, ctx, side, (fx + p.x) / 2, (fz + p.z) / 2, GUARD_RADIUS);
      if (!best || danger < best.danger) best = { x: p.x, z: p.z, danger };
    }
    return best ? { x: best.x, z: best.z } : null;
  }

  /** What the page shows (see sim/mirror.ts). */
  get state(): Hunt[] {
    return this.hunts;
  }

  set state(hunts: Hunt[]) {
    this.hunts = hunts;
    this.bySquad.clear();
    for (const h of hunts) for (const q of h.squads) this.bySquad.set(q, h);
  }
}
