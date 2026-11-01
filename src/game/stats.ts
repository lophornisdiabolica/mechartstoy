import { EventBus } from '../core/events';
import { NEUTRAL } from './components';
import { GameEvents } from './context';

/** One side's tally for the end-of-battle summary. */
export interface SideStats {
  /** Units that took the field: opening army, production, waves and drops. */
  fielded: number;
  lost: number;
  /** Enemy units this side destroyed. */
  kills: number;
  /** Buildings this side destroyed, including the civilian town. */
  razed: number;
  /** Kills (units and buildings) by the unit or building type that landed the last blow. */
  killsBy: Record<string, number>;
}

/**
 * Keeps score for a battle by listening to the sim's events. It reads
 * nothing else, so it can't affect the battle.
 */
export class BattleStats {
  readonly sides: SideStats[];
  /** Civilian buildings destroyed by anyone. */
  townRazed = 0;

  constructor(events: EventBus<GameEvents>, factions: number) {
    this.sides = Array.from({ length: factions }, () => ({ fielded: 0, lost: 0, kills: 0, razed: 0, killsBy: {} }));
    events.on('spawned', (e) => this.side(e.faction) && this.sides[e.faction].fielded++);
    events.on('unitDestroyed', (e) => {
      if (this.side(e.faction)) this.sides[e.faction].lost++;
      const k = e.killer;
      if (k && this.side(k.faction) && k.faction !== e.faction) {
        this.sides[k.faction].kills++;
        this.credit(k.faction, k.source);
      }
    });
    events.on('buildingDestroyed', (e) => {
      if (e.faction === NEUTRAL) this.townRazed++;
      const k = e.killer;
      if (k && this.side(k.faction) && k.faction !== e.faction) {
        this.sides[k.faction].razed++;
        this.credit(k.faction, k.source);
      }
    });
  }

  /** The type with the most kills on a side, or null before anyone has scored. */
  best(faction: number): { source: string; kills: number } | null {
    let top: { source: string; kills: number } | null = null;
    for (const [source, kills] of Object.entries(this.sides[faction].killsBy)) {
      if (!top || kills > top.kills) top = { source, kills };
    }
    return top;
  }

  private side(f: number): boolean {
    return f >= 0 && f < this.sides.length;
  }

  private credit(faction: number, source: string): void {
    const by = this.sides[faction].killsBy;
    by[source] = (by[source] ?? 0) + 1;
  }
}
