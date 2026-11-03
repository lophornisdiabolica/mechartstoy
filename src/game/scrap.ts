import { System } from '../core/ecs';
import { SimContext } from './context';
import { groundCode } from '../world/ground';

/**
 * Scrap: where vehicles are wrecked, the wreckage piles up, and once enough
 * has piled up on a patch of ground it turns to scrap (see ground.ts), hard
 * going for tracks and hovers and easy for long legs, and any dense forest
 * there is flattened. Routes re-plan round it like any other change to the
 * map. Scrap is cleared away a few minutes after it forms (by the salvage
 * crews nobody sees), so a long battle's map doesn't silt up for good.
 *
 * Off with the map's scrap setting.
 */

/** Wreckage a map cell needs before it turns to scrap, in tank-sized wrecks (a wreck counts its radius squared). */
const SCRAP_AT = 2.5;
/** How far round a wreck its wreckage lands (it counts less toward the edge). */
const REACH = 2.5;
/** Seconds wreckage takes to fade to a third if nothing more piles on. */
const FADE = 180;
/** Seconds scrap lasts before it's cleared. */
const SCRAP_LIFE = 240;
/** Seconds between updates (new scrap is laid in batches). */
const TICK = 2;

export function scrapSystem(ctx: SimContext): System {
  const field = ctx.field;
  const { cols, rows, cellSize } = field.config;
  const debris = new Float32Array(cols * rows);
  /** Scrap cells and when they formed. */
  const scrapped = new Map<number, number>();
  const pending = new Set<number>();
  const scrap = groundCode('scrap');
  const road = groundCode('road');
  let acc = 0;
  let time = 0;

  const pile = (k: number, weight: number) => {
    debris[k] += weight;
    if (debris[k] >= SCRAP_AT && field.ground[k] !== scrap && field.ground[k] !== road && !scrapped.has(k)) pending.add(k);
  };
  if (ctx.settings.map.scrap) {
    ctx.events.on('unitDestroyed', (ev) => {
      const cls = ev.def.class;
      if (cls === 'infantry' || ev.def.move === 'naval') return;
      if (field.isWater(ev.x, ev.z) || field.deckAt(ev.x, ev.z) !== null) return;
      // Wreckage lands round where it fell, thickest in the middle.
      const w = ev.def.radius * ev.def.radius;
      const [i0, j0] = field.cellAt(ev.x - REACH, ev.z - REACH);
      const [i1, j1] = field.cellAt(ev.x + REACH, ev.z + REACH);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(field.bounds.minX + (i + 0.5) * cellSize - ev.x, field.bounds.minZ + (j + 0.5) * cellSize - ev.z);
          if (d <= REACH) pile(j * cols + i, w * (1 - 0.7 * (d / REACH)));
        }
      }
    });
  }

  return {
    name: 'scrap',
    update(_world, dt) {
      if (!ctx.settings.map.scrap) return;
      acc += dt;
      if (acc < TICK) return;
      time += acc;
      const fade = Math.exp(-acc / FADE);
      acc = 0;
      // New scrap, flattening any trees there.
      if (pending.size > 0) {
        const cells = [...pending];
        pending.clear();
        for (const k of cells) {
          scrapped.set(k, time);
          for (const t of field.woods.standingIn(k)) {
            const tree = field.woods.trees[t];
            field.woods.fell(t, { x: tree.x + 0.3, z: tree.z + 0.3 });
          }
        }
        field.setGround(cells, 'scrap');
      }
      // Old scrap cleared: back to open ground (any forest there is gone).
      const cleared: number[] = [];
      for (const [k, at] of scrapped) {
        if (time - at < SCRAP_LIFE) continue;
        scrapped.delete(k);
        debris[k] = 0;
        cleared.push(k);
      }
      if (cleared.length > 0) field.setGround(cleared, 'plain');
      for (let k = 0; k < debris.length; k++) if (debris[k] > 0) debris[k] *= fade;
    },
  };
}
