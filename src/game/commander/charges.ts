import { World } from '../../core/ecs';
import { MOVE_RULES } from '../../world/moveClasses';
import { Ai, Armed, Faction, Guard, Mover, Targetable, Transform, Unit } from '../components';
import { SimContext } from '../context';
import { fightingStrength } from '../offensive';
import * as D from '../../core/dmath';

/*
 * Charges. A melee squad (one with a unit whose main weapon is a melee one,
 * see MeleeDef) can't fight what it can't reach, and arriving at a fight one
 * by one is how melee units get shot down on the way in. So the Commander
 * watches the ground just past what its melee squads can see: when an enemy
 * group is there and the squad outweighs it, it calls a charge, and the
 * whole squad goes for it at once, at a run (MeleeDef.charge), rather than
 * waiting for it to walk into sight. Against a group too strong for it, it
 * holds off and lets the rest of the army come up.
 *
 * Squads off on another job (a task force, a hunt) don't charge, and the
 * rally flag and stances override it, like every other job.
 */

/** How far from a melee squad's middle the Commander looks for something to charge. */
export const CHARGE_CALL = 28;
/** How far round the enemy it counts strength, to judge whether the charge is worth it. */
const ODDS_RADIUS = 10;
/** The squad has to be at least this share of the enemy's strength there. */
const ODDS = 0.8;

export interface Charge {
  side: number;
  squad: number;
  /** What it's charging: an enemy unit's place when it was called. */
  x: number;
  z: number;
  /** The squad's middle when it was called (for the overlay). */
  fromX: number;
  fromZ: number;
}

interface SquadInfo {
  side: number;
  strength: number;
  x: number;
  z: number;
  units: number;
}

export class Charges {
  private readonly bySquad = new Map<number, Charge>();

  /** Every charge on now. */
  get charges(): Charge[] {
    return [...this.bySquad.values()];
  }

  forSquad(squad: number): Charge | undefined {
    return this.bySquad.get(squad);
  }

  /** Call charges afresh (every Commander refresh). `busy` says whether a squad has another job. */
  update(world: World, ctx: SimContext, busy: (squad: number) => boolean): void {
    this.bySquad.clear();
    const squads = new Map<number, SquadInfo>();
    let melee = false;
    for (const e of world.query(Unit, Ai, Armed, Faction, Transform)) {
      if (world.req(e, Armed).weapon.melee) melee = true;
    }
    // Most battles have no melee units at all.
    if (!melee) return;
    const meleeSquads = new Set<number>();
    for (const e of world.query(Unit, Ai, Armed, Faction, Transform)) {
      if (world.has(e, Guard) || world.req(e, Unit).def.builds) continue;
      const side = world.req(e, Faction).id;
      if (side < 0 || side >= ctx.orders.length) continue;
      const ai = world.req(e, Ai);
      if (world.req(e, Armed).weapon.melee) meleeSquads.add(ai.squad);
      const t = world.req(e, Transform);
      let s = squads.get(ai.squad);
      if (!s) squads.set(ai.squad, (s = { side, strength: 0, x: 0, z: 0, units: 0 }));
      s.strength += fightingStrength(world, e);
      s.x += t.x;
      s.z += t.z;
      s.units++;
    }
    const map = ctx.commander.strength;
    for (const squad of meleeSquads) {
      const s = squads.get(squad)!;
      if (busy(squad)) continue;
      const orders = ctx.orders[s.side];
      if (orders.stance !== 'auto' || orders.rally) continue;
      const x = s.x / s.units;
      const z = s.z / s.units;
      // The nearest enemy on the ground within call.
      let best: { x: number; z: number } | null = null;
      let bestD2 = CHARGE_CALL * CHARGE_CALL;
      ctx.grid.forEachNear(x, z, CHARGE_CALL, (other, d2) => {
        if (d2 >= bestD2 || world.get(other, Targetable)?.kind !== 'unit') return;
        if (!ctx.sides.hostile(s.side, world.req(other, Faction).id)) return;
        const m = world.get(other, Mover);
        if (m && MOVE_RULES[m.move].flies) return;
        const ot = world.req(other, Transform);
        best = { x: ot.x, z: ot.z };
        bestD2 = d2;
      });
      if (best === null) continue;
      const at: { x: number; z: number } = best;
      let theirs = 0;
      for (const g of ctx.sides.enemiesOf(s.side)) if (g >= 0 && g < map.ground.length) theirs += map.near(map.ground, g, at.x, at.z, ODDS_RADIUS);
      if (s.strength < theirs * ODDS) continue;
      // Not a charge to something already in reach: the squad's own weapons have that.
      if (D.hypot(at.x - x, at.z - z) < 4) continue;
      this.bySquad.set(squad, { side: s.side, squad, x: at.x, z: at.z, fromX: x, fromZ: z });
    }
  }
}
