import { EventBus } from '../core/events';
import { NEUTRAL } from './components';
import { GameEvents } from './context';

/** One unit (or building) type's tally on one side. */
export interface TypeStats {
  /** Units of this type that took the field (0 for buildings). */
  built: number;
  lost: number;
  /** Enemy units it landed the killing blow on, and enemy buildings it brought down. */
  kills: number;
  razed: number;
  /** Enemy unit types it killed, and the enemy unit or building types that killed it, with counts. */
  victims: Record<string, number>;
  killers: Record<string, number>;
}

/** One side's tally for the end-of-battle summary. */
export interface SideStats {
  /** Units that took the field: opening army, production, waves and drops. */
  fielded: number;
  lost: number;
  /** Enemy units this side destroyed. */
  kills: number;
  /** Buildings this side destroyed, including the civilian town. */
  razed: number;
  /** Outposts this side took. */
  captured: number;
  /** Kills (units and buildings) by the unit or building type that landed the last blow. */
  killsBy: Record<string, number>;
  /** The same tallies broken down by unit or building type, for balance runs. */
  types: Record<string, TypeStats>;
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
    this.sides = Array.from({ length: factions }, () => ({ fielded: 0, lost: 0, kills: 0, razed: 0, captured: 0, killsBy: {}, types: {} }));
    events.on('spawned', (e) => {
      if (!this.side(e.faction)) return;
      this.sides[e.faction].fielded++;
      this.type(e.faction, e.def.id).built++;
    });
    events.on('unitDestroyed', (e) => {
      const k = e.killer;
      if (this.side(e.faction)) {
        this.sides[e.faction].lost++;
        const t = this.type(e.faction, e.def.id);
        t.lost++;
        // Outpost garrisons aren't a side: their kills show as e.g. "outpost tower".
        if (k && k.faction !== e.faction) bump(t.killers, this.side(k.faction) ? k.source : `outpost ${k.source}`);
      }
      if (k && this.side(k.faction) && k.faction !== e.faction) {
        this.sides[k.faction].kills++;
        this.credit(k.faction, k.source);
        const t = this.type(k.faction, k.source);
        t.kills++;
        bump(t.victims, e.def.id);
      }
    });
    events.on('outpostCaptured', (e) => this.side(e.faction) && this.sides[e.faction].captured++);
    events.on('buildingDestroyed', (e) => {
      if (e.faction === NEUTRAL) this.townRazed++;
      const k = e.killer;
      if (k && this.side(k.faction) && k.faction !== e.faction) {
        this.sides[k.faction].razed++;
        this.credit(k.faction, k.source);
        this.type(k.faction, k.source).razed++;
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
    bump(this.sides[faction].killsBy, source);
  }

  private type(faction: number, id: string): TypeStats {
    const types = this.sides[faction].types;
    return (types[id] ??= { built: 0, lost: 0, kills: 0, razed: 0, victims: {}, killers: {} });
  }
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
