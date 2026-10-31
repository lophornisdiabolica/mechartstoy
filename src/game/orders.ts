/**
 * Standing orders a faction's units follow, set by the player (or left on
 * auto). The sim reads these; the UI writes them through Game commands.
 */
export type Stance = 'auto' | 'attack' | 'hold';

export interface FactionOrders {
  /** auto follows the tide; attack and hold override it. */
  stance: Stance;
  /** Custom gathering point; null uses the default spot in front of the base. */
  rally: { x: number; z: number } | null;
}

export function defaultOrders(): FactionOrders[] {
  return [0, 1].map(() => ({ stance: 'auto', rally: null }));
}
