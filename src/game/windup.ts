import { System } from '../core/ecs';
import { Armed, Health, Mover, Tilt, Transform, Unit, WindUp } from './components';
import { SimContext } from './context';

/*
 * Tin Soldiers: clockwork toys (UnitDef.windUp).
 *
 * Each one runs down: after `run` seconds of marching and shooting it stops
 * where it is to wind its key back up, for `rewind` seconds, neither moving
 * nor firing. Standing about runs it down only slowly. And a toy knocked by
 * a big enough hit (`topple` of its health in one go) can tip over onto its
 * side, lying there a few seconds before it rights itself.
 */

/** Share of the run used up standing idle, against marching or shooting. */
const IDLE_DRAIN = 0.3;
/** Seconds a toppled toy lies on its side. */
const DOWN_FOR = 3;
/** Chance a big enough hit tips it over. */
const TOPPLE_CHANCE = 0.6;
/** How far over a toppled toy lies, radians. */
const LIE = 1.45;

/** Toys running down and winding up, and tipping over. Runs after the AI, before movement. */
export function windUpSystem(ctx: SimContext): System {
  return {
    name: 'windUp',
    update(world, dt) {
      for (const e of world.query(Unit, Mover, Transform)) {
        const def = world.req(e, Unit).def;
        if (!def.windUp) continue;
        let w = world.get(e, WindUp);
        const h = world.get(e, Health);
        if (!w) w = world.add(e, WindUp, { left: def.windUp.run * ctx.rng.range(0.5, 1), rewindUntil: -Infinity, downUntil: -Infinity, hp: h?.hp ?? 0, side: 1 });
        if (!world.has(e, Tilt)) world.add(e, Tilt, { pitch: 0, roll: 0, ppitch: 0, proll: 0, sx: NaN, sz: NaN, sheading: 0, wantPitch: 0, wantRoll: 0, lift: 0 });
        const mover = world.req(e, Mover);
        const armed = world.get(e, Armed);
        // A big knock tips it over.
        if (h) {
          const lost = w.hp - h.hp;
          w.hp = h.hp;
          if (h.hp > 0 && lost >= h.max * (def.windUp.topple ?? Infinity) && world.time >= w.downUntil && ctx.rng.chance(TOPPLE_CHANCE)) {
            w.downUntil = world.time + DOWN_FOR;
            w.side = ctx.rng.chance(0.5) ? 1 : -1;
            const t = world.req(e, Transform);
            ctx.events.emit('toppled', { x: t.x, y: t.y, z: t.z });
          }
        }
        const down = world.time < w.downUntil;
        if (!down && world.time >= w.rewindUntil) {
          const busy = mover.targetX !== null || (armed !== undefined && world.time - armed.firedAt < 1.5);
          w.left -= dt * (busy ? 1 : IDLE_DRAIN);
          if (w.left <= 0) {
            w.rewindUntil = world.time + def.windUp.rewind;
            w.left = def.windUp.run;
          }
        }
        if (down || world.time < w.rewindUntil) {
          mover.targetX = null;
          mover.targetZ = null;
          if (armed) armed.cooldown = Math.max(armed.cooldown, 0.25);
        }
      }
    },
  };
}

/** Toppled toys lie on their sides. Runs after the tilt system, which lays everything else along the ground. */
export function toppleSystem(): System {
  return {
    name: 'topple',
    update(world, dt) {
      for (const e of world.query(WindUp, Tilt)) {
        const w = world.req(e, WindUp);
        const tilt = world.req(e, Tilt);
        const want = world.time < w.downUntil ? LIE * w.side : null;
        if (want === null && Math.abs(tilt.roll) < 0.3) continue;
        // Over quickly, back up a little slower.
        const goal = want ?? tilt.wantRoll;
        tilt.roll += (goal - tilt.roll) * Math.min(1, dt * (want !== null ? 9 : 4));
      }
    },
  };
}
