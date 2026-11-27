import { System, World } from '../core/ecs';
import { Rng } from '../core/rng';
import { groundCode } from '../world/ground';
import { Building, Faction, GARRISON, NEUTRAL, RELIC, Transform } from './components';
import { SimContext } from './context';
import { spawnBuilding } from './spawn';
import * as D from '../core/dmath';

/**
 * Map traits in the battle (where they're laid out is world/traits.ts).
 *
 * - Relics (old walls, hulks, columns...) go up when the battle starts,
 *   nobody's (RELIC): they stop shots and block the way like any building,
 *   so they're cover for whoever gets there first, and fire wears them down.
 * - Oil field: a shell or flame bursting on a pool sets it alight. The fire
 *   creeps across the pool in a few seconds and burns everyone standing in
 *   it, whoever lit it, under a pall of black smoke that throws shots off,
 *   until the pool burns dry. A derrick that's destroyed blows up and sets
 *   the pools round it alight; while one stands, the pools by it fill back
 *   up, so a fight there can burn again.
 * - Geysers: each vent blows steam for a few seconds every half minute or
 *   so: nobody's haze (see smoke.ts), which throws everyone's shots off and
 *   hides stealthy units in it.
 * - Crashed hulk: the scrap round it never runs out while it stands, kept
 *   topped up for the scrap sides to feed on (Hive's fabricators, Lodestar's
 *   cranes).
 *
 * Runs on its own random stream, so a battle without traits is untouched.
 */

/** Seconds a full pool burns for. */
const FUEL = 35;
/** Seconds between oil, geyser and hulk updates. */
const TICK = 0.25;
/** Heat added to a burning pool's cell every tick: enough to keep it hot, short of white-hot (see fire.ts). */
const OIL_HEAT = 0.15;
/** Chance each tick that a burning cell sets each pool cell beside it alight. */
const CREEP = 0.3;
/** Smoke a burning cell gives off every tick. */
const OIL_SMOKE = 0.18;
/** Fuel a pool cell by a standing derrick gets back, per second. */
const REFILL = 0.2;
/** How near a derrick (centre to cell) a pool cell has to be to fill back up, or to catch when it blows. */
const DERRICK_REACH = 7;
/** Steam a vent gives off per second while it blows, and how wide. */
const STEAM = 1.5;
const STEAM_RADIUS = 3.2;
/** Scrap kept round a crashed hulk, in tank-sized wrecks, and how far out. */
const HULK_SCRAP = 120;
const HULK_REACH = 7.5;
/** Seconds between topping up a hulk's scrap. */
const HULK_EVERY = 6;

/** What traits keep track of during a battle. */
export class TraitState {
  /** Oil pool cells (map cell indices), with each one's fuel and whether it's burning. */
  readonly pools: number[] = [];
  readonly fuel: Float32Array;
  readonly lit: Uint8Array;
  /** Pool cells by map cell, for spreading. */
  private readonly poolAt = new Map<number, number>();
  private readonly rng: Rng;
  /** Burning pool cells, by index into `pools`. */
  burning = new Set<number>();

  constructor(
    private readonly ctx: Pick<SimContext, 'field'>,
    seed: number,
  ) {
    const field = ctx.field;
    const oil = groundCode('oil');
    for (let k = 0; k < field.ground.length; k++) {
      if (field.ground[k] !== oil) continue;
      this.poolAt.set(k, this.pools.length);
      this.pools.push(k);
    }
    this.fuel = new Float32Array(this.pools.length).fill(FUEL);
    this.lit = new Uint8Array(this.pools.length);
    this.rng = new Rng(seed ^ 0x6f696c);
  }

  /** Whether the map has anything for the traits system to do. */
  get active(): boolean {
    return this.pools.length > 0 || this.ctx.field.traits.vents.length > 0 || this.ctx.field.traits.relics.some((r) => r.building === 'crashedHulk');
  }

  /** A burst at a point: any pool with fuel within `radius` of it catches. */
  strike(x: number, z: number, radius: number): void {
    if (this.pools.length === 0) return;
    const field = this.ctx.field;
    const { cols, cellSize } = field.config;
    const r = radius + cellSize * 0.5;
    const [i0, j0] = field.cellAt(x - r, z - r);
    const [i1, j1] = field.cellAt(x + r, z + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = this.poolAt.get(j * cols + i);
        if (p === undefined) continue;
        const cx = field.bounds.minX + (i + 0.5) * cellSize;
        const cz = field.bounds.minZ + (j + 0.5) * cellSize;
        if (D.hypot(cx - x, cz - z) <= r) this.light(p);
      }
    }
  }

  private light(p: number): void {
    if (this.lit[p] || this.fuel[p] < 1) return;
    this.lit[p] = 1;
    this.burning.add(p);
  }

  /** Burn the burning pools, let fire creep across them, and refill the ones by a standing derrick. */
  burn(ctx: SimContext, derricks: { x: number; z: number }[], dt: number): void {
    const field = ctx.field;
    const { cols, cellSize } = field.config;
    const centre = (k: number) => {
      const i = k % cols;
      return { x: field.bounds.minX + (i + 0.5) * cellSize, z: field.bounds.minZ + ((k - i) / cols + 0.5) * cellSize };
    };
    const catching: number[] = [];
    for (const p of this.burning) {
      const k = this.pools[p];
      const c = centre(k);
      this.fuel[p] -= dt;
      if (this.fuel[p] <= 0) {
        this.fuel[p] = 0;
        this.lit[p] = 0;
        this.burning.delete(p);
        continue;
      }
      // Oil fire is nobody's: it burns everyone (see fire.ts, which burns the enemies of whoever's fire it is).
      ctx.fire.add(c.x, c.z, cellSize * 0.5, OIL_HEAT, GARRISON, 'oilFire');
      ctx.smoke.add(c.x, c.z, cellSize, OIL_SMOKE, NEUTRAL);
      for (const n of [k - 1, k + 1, k - cols, k + cols]) {
        const q = this.poolAt.get(n);
        if (q !== undefined && !this.lit[q] && this.rng.next() < CREEP) catching.push(q);
      }
    }
    for (const q of catching) this.light(q);
    if (derricks.length === 0) return;
    for (let p = 0; p < this.pools.length; p++) {
      if (this.lit[p] || this.fuel[p] >= FUEL) continue;
      const c = centre(this.pools[p]);
      if (derricks.some((d) => D.hypot(d.x - c.x, d.z - c.z) < DERRICK_REACH)) this.fuel[p] = Math.min(FUEL, this.fuel[p] + REFILL * dt);
    }
  }
}

/** Put up the map's relics, nobody's (see world/traits.ts). */
export function raiseRelics(world: World, ctx: SimContext): void {
  for (const r of ctx.field.traits.relics) spawnBuilding(world, ctx, ctx.buildings[r.building], RELIC, r.x, r.z, r.heading);
}

/** Runs the traits: oil fires, geysers and a crashed hulk's scrap. */
export function traitSystem(ctx: SimContext): System {
  const state = ctx.traits;
  const vents = ctx.field.traits.vents;
  let acc = 0;
  let hulkAt = 0;
  // A derrick that blows up sets the pools round it alight.
  ctx.events.on('buildingDestroyed', (ev) => {
    if (ev.def.id === 'derrick') state.strike(ev.x, ev.z, DERRICK_REACH * 0.7);
  });
  return {
    name: 'traits',
    update(world, dt) {
      acc += dt;
      if (acc < TICK) return;
      const step = acc;
      acc = 0;
      const derricks: { x: number; z: number }[] = [];
      const hulks: { x: number; z: number }[] = [];
      if (state.pools.length > 0 || world.time >= hulkAt) {
        for (const e of world.query(Building, Faction, Transform)) {
          if (world.req(e, Faction).id !== RELIC) continue;
          const id = world.req(e, Building).def.id;
          if (id !== 'derrick' && id !== 'crashedHulk') continue;
          const t = world.req(e, Transform);
          (id === 'derrick' ? derricks : hulks).push({ x: t.x, z: t.z });
        }
      }
      if (state.pools.length > 0) state.burn(ctx, derricks, step);
      for (const v of vents) {
        if ((world.time + v.phase) % v.period < v.length) ctx.smoke.add(v.x, v.z, STEAM_RADIUS, STEAM * step, NEUTRAL);
      }
      if (world.time >= hulkAt) {
        hulkAt = world.time + HULK_EVERY;
        for (const h of hulks) topUp(ctx, h.x, h.z);
      }
    },
  };
}

/** Keep the scrap round a crashed hulk topped up (see wreckage.ts). */
function topUp(ctx: SimContext, x: number, z: number): void {
  const want = HULK_SCRAP;
  const have = ctx.wreckage.massNear(x, z, HULK_REACH);
  if (have < want) ctx.wreckage.add(x, z, HULK_REACH, (want - have) * 0.25);
}
