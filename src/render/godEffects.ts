import { Building, Faction, Producer, Transform, Unit } from '../game/components';
import { Game } from '../game/game';
import { Effects } from './effects';

/** Seconds between bursts of motes. */
const EVERY = 0.12;

/**
 * Blessings and curses you can see (see game/god.ts): motes of gold light
 * drifting up off a healed side's units or a blessed side's factories, and
 * dark wisps off a cursed side's units.
 */
export class GodEffects {
  private timer = 0;

  constructor(
    private readonly game: Game,
    private readonly effects: Effects,
  ) {}

  update(simSeconds: number): void {
    if (simSeconds <= 0) return;
    this.timer -= simSeconds;
    if (this.timer > 0) return;
    this.timer = EVERY;
    const { world, ctx } = this.game;
    const now = world.time;
    for (const b of ctx.god.blessings) {
      if (b.until <= now) continue;
      const curse = b.kind === 'curse';
      if (b.kind === 'production') {
        for (const e of world.query(Producer, Building, Faction, Transform)) {
          if (world.req(e, Faction).id !== b.faction || Math.random() > 0.5) continue;
          const t = world.req(e, Transform);
          const def = world.req(e, Building).def;
          this.effects.sparkle(t.x, t.y + def.height * 0.8, t.z, false);
        }
        continue;
      }
      // A few of the side's units at a time, so a big army isn't a blizzard.
      const units: number[] = [];
      for (const e of world.query(Unit, Faction, Transform)) if (world.req(e, Faction).id === b.faction) units.push(e);
      const n = Math.min(units.length, 4 + Math.round(units.length * 0.08));
      for (let k = 0; k < n; k++) {
        const e = units[Math.floor(Math.random() * units.length)];
        const t = world.req(e, Transform);
        const r = world.req(e, Unit).def.radius;
        this.effects.sparkle(t.x, t.y + r * 0.8, t.z, curse);
      }
    }
  }
}
