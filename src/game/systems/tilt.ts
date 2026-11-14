import { System } from '../../core/ecs';
import { Collider, GroundFollow, Tilt, Transform, Wreck } from '../components';
import { SimContext } from '../context';
import * as D from '../../core/dmath';

/** Points round the hull the ground is felt at: a ring, so a bump under one track or a peak narrower than the hull averages out. */
const RING = 8;
const RING_COS: number[] = [];
const RING_SIN: number[] = [];
for (let k = 0; k < RING; k++) {
  RING_COS.push(D.cos((k / RING) * Math.PI * 2));
  RING_SIN.push(D.sin((k / RING) * Math.PI * 2));
}
/** The ring's radius, as a share of the unit's collider radius, and never under this. */
const RING_SHARE = 0.9;
const RING_MIN = 0.8;
/** Steepest a hull leans, radians: past this it's propped on its tracks' edge, not lying along a cliff. */
const MAX_TILT = 0.55;
/** How quickly a hull settles to the ground under it, per second: quick enough to follow a slope, slow enough not to rattle over bumps. */
const SETTLE = 6;
/** A hull standing still feels the ground again only this often (the ground can be cratered under it), ticks. */
const RECHECK = 40;

/**
 * Lays vehicles' hulls along the ground under them: a plane through the
 * ground on a ring round the hull, so it noses up a hill and leans along
 * the side of one, and doesn't rock over every bump or teeter on a peak.
 * Where the ring's ground is higher than the middle (a dip narrower than
 * the hull), the hull rides on the rims instead of sinking into them.
 * Runs after the ground follow, which puts the unit on the ground at its middle.
 */
export function tiltSystem(ctx: SimContext): System {
  const field = ctx.field;
  return {
    name: 'tilt',
    update(world, dt) {
      const ease = Math.min(1, dt * SETTLE);
      for (const e of world.query(Transform, Tilt)) {
        const t = world.req(e, Transform);
        const tilt = world.req(e, Tilt);
        tilt.ppitch = tilt.pitch;
        tilt.proll = tilt.roll;
        if (world.has(e, Wreck)) continue;
        const fresh = tilt.sx !== tilt.sx;
        const moved = fresh || tilt.sx !== t.x || tilt.sz !== t.z || tilt.sheading !== t.heading || (world.tick + e) % RECHECK === 0;
        if (moved) {
          const r = Math.max(RING_MIN, (world.get(e, Collider)?.radius ?? 1) * RING_SHARE);
          // Least-squares plane through the ring: the heights weighted by where round the ring they are.
          let gx = 0;
          let gz = 0;
          let mean = 0;
          for (let k = 0; k < RING; k++) {
            const h = field.surfaceAt(t.x + RING_COS[k] * r, t.z + RING_SIN[k] * r);
            gx += h * RING_COS[k];
            gz += h * RING_SIN[k];
            mean += h;
          }
          gx /= (RING / 2) * r;
          gz /= (RING / 2) * r;
          mean /= RING;
          // The rise along the nose (+x at the heading) and along the hull's left (+z), as in render/wrecks.ts.
          const ch = D.cos(t.heading);
          const sh = D.sin(t.heading);
          const ahead = gx * ch - gz * sh;
          const aside = gx * sh + gz * ch;
          tilt.wantPitch = clamp(D.atan(ahead), MAX_TILT);
          tilt.wantRoll = clamp(-D.atan(aside), MAX_TILT);
          tilt.sx = t.x;
          tilt.sz = t.z;
          tilt.sheading = t.heading;
          const floor = field.surfaceAt(t.x, t.z);
          tilt.lift = Math.max(0, mean - floor);
          if (fresh) {
            tilt.pitch = tilt.ppitch = tilt.wantPitch;
            tilt.roll = tilt.proll = tilt.wantRoll;
          }
        }
        tilt.pitch += (tilt.wantPitch - tilt.pitch) * ease;
        tilt.roll += (tilt.wantRoll - tilt.roll) * ease;
        // The ground follow put it on the ground at its middle this tick; lift it onto the rims of a dip.
        if (tilt.lift > 0 && world.has(e, GroundFollow)) t.y += tilt.lift;
      }
    },
  };
}

function clamp(v: number, max: number): number {
  return v > max ? max : v < -max ? -max : v;
}
