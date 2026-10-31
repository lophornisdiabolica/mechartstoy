/** Faction definitions are data so new sides or palettes are a one-line change. */
export interface FactionDef {
  id: number;
  name: string;
  /** Main hull colour. */
  primary: number;
  /** Trim and accent colour. */
  secondary: number;
}

export const FACTIONS: readonly FactionDef[] = [
  { id: 0, name: 'Cobalt Accord', primary: 0x4a78c2, secondary: 0xd9e2ec },
  { id: 1, name: 'Ember Syndicate', primary: 0xc4532f, secondary: 0x2e2a28 },
];
