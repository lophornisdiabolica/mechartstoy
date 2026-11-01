/** Faction definitions are data so new sides or palettes are a one-line change. */
export interface FactionDef {
  id: number;
  name: string;
  /** Main hull colour. */
  primary: number;
  /** Trim and accent colour. */
  secondary: number;
}

/**
 * The default sides, in the order they're added on the setup screen. A battle
 * uses the first N (names and hull colours can be changed per battle; the
 * trim colour stays with the slot).
 */
export const FACTIONS: readonly FactionDef[] = [
  { id: 0, name: 'Cobalt Accord', primary: 0x4a78c2, secondary: 0xd9e2ec },
  { id: 1, name: 'Ember Syndicate', primary: 0xc4532f, secondary: 0x2e2a28 },
  { id: 2, name: 'Ivory Compact', primary: 0xe4ddcc, secondary: 0x34495e },
  { id: 3, name: 'Gilded Directorate', primary: 0xd2a535, secondary: 0x2b2b33 },
  { id: 4, name: 'Violet Covenant', primary: 0x8a5cc4, secondary: 0xe4dcef },
  { id: 5, name: 'Ashen Mandate', primary: 0x8b9298, secondary: 0x3a2f2a },
  { id: 6, name: 'Teal Concord', primary: 0x2f9e9a, secondary: 0x1f2a30 },
  { id: 7, name: 'Crimson Host', primary: 0x9c2440, secondary: 0xe9d6c4 },
];

/** Most sides a battle can have. */
export const MAX_FACTIONS = FACTIONS.length;
