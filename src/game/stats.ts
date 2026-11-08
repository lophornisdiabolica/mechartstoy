import { EventBus } from '../core/events';
import { World } from '../core/ecs';
import { Armed, Faction, GOD, Guard, NEUTRAL, Unit } from './components';
import { GameEvents } from './context';
import { strengthOf } from './offensive';

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
  /**
   * Damage it did to enemies, and took from them (what came off health, after
   * armour, overkill not counted). `dealtTo` splits what it did by the
   * victims' category: infantry, vehicle, air, super or building.
   */
  dealt: number;
  taken: number;
  dealtTo: Record<string, number>;
  /**
   * Seconds its units spent on the field (all of them added up, so a cap slot
   * held for a minute is 60), seconds with a target picked, and seconds
   * within a couple of seconds of firing. Only filled in when something
   * calls BattleStats.sample, as balance runs do.
   */
  alive: number;
  engaged: number;
  firing: number;
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
  /**
   * The army strength of the enemy units each type killed, counted at full
   * health (see strengthOf), so a tank kill is worth more than a rifleman.
   */
  strengthBy: Record<string, number>;
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
    this.sides = Array.from({ length: factions }, () => ({ fielded: 0, lost: 0, kills: 0, razed: 0, captured: 0, killsBy: {}, strengthBy: {}, types: {} }));
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
        if (k && k.faction !== e.faction) bump(t.killers, this.side(k.faction) ? k.source : k.faction === GOD ? `god ${k.source}` : `outpost ${k.source}`);
      }
      if (k && this.side(k.faction) && k.faction !== e.faction) {
        this.sides[k.faction].kills++;
        this.credit(k.faction, k.source);
        const by = this.sides[k.faction].strengthBy;
        by[k.source] = (by[k.source] ?? 0) + strengthOf(e.def.hp, e.def.armor, e.def.weapon);
        const t = this.type(k.faction, k.source);
        t.kills++;
        bump(t.victims, e.def.id);
      }
    });
    events.on('damaged', (e) => {
      const k = e.by;
      // Only damage between enemies: stray fire on the town and blasts on your own side don't count.
      if (!k || k.faction === e.faction || e.faction === NEUTRAL) return;
      if (this.side(e.faction)) this.type(e.faction, e.victim).taken += e.amount;
      if (this.side(k.faction)) {
        const t = this.type(k.faction, k.source);
        t.dealt += e.amount;
        t.dealtTo[e.category] = (t.dealtTo[e.category] ?? 0) + e.amount;
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

  /**
   * Adds `seconds` of field time to every unit on a side (outpost guards
   * aren't part of an army), and to its engaged and firing time if it's
   * fighting. Balance runs call this once a sim second; the game doesn't.
   */
  sample(world: World, seconds: number): void {
    for (const e of world.query(Unit, Faction)) {
      const f = world.req(e, Faction).id;
      if (!this.side(f) || world.has(e, Guard)) continue;
      const t = this.type(f, world.req(e, Unit).def.id);
      t.alive += seconds;
      const armed = world.get(e, Armed);
      if (!armed) continue;
      if (armed.target !== null) t.engaged += seconds;
      if (world.time - armed.firedAt <= armed.weapon.cooldown + FIRING_SLACK) t.firing += seconds;
    }
  }

  /** The type with the most kills on a side, or null before anyone has scored. */
  best(faction: number): { source: string; kills: number; strength: number } | null {
    const side = this.sides[faction];
    let top: { source: string; kills: number; strength: number } | null = null;
    for (const [source, kills] of Object.entries(side.killsBy)) {
      if (!top || kills > top.kills) top = { source, kills, strength: side.strengthBy?.[source] ?? 0 };
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
    return (types[id] ??= { built: 0, lost: 0, kills: 0, razed: 0, victims: {}, killers: {}, dealt: 0, taken: 0, dealtTo: {}, alive: 0, engaged: 0, firing: 0 });
  }
}

/** A unit counts as firing until this long after its weapon is ready again: one missed beat isn't a pause. */
const FIRING_SLACK = 1;

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
