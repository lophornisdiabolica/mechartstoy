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
 * The default sides, in the order they're added on the setup screen, which
 * is also the order of their default doctrines (see doctrines.ts): Cobalt
 * armour, Crimson raiders, Ashen legion, then the doctrines still to come. A battle
 * uses the first N (names and hull colours can be changed per battle; the
 * trim colour stays with the slot).
 */
export const FACTIONS: readonly FactionDef[] = [
  { id: 0, name: 'Cobalt Accord', primary: 0x4a78c2, secondary: 0xd9e2ec },
  { id: 1, name: 'Crimson Brigade', primary: 0x9c2440, secondary: 0xe9d6c4 },
  { id: 2, name: 'Ashen Mandate', primary: 0x8b9298, secondary: 0x3a2f2a },
  { id: 3, name: 'Gilded Directorate', primary: 0xd2a535, secondary: 0x2b2b33 },
  { id: 4, name: 'Violet Covenant', primary: 0x8a5cc4, secondary: 0xe4dcef },
  { id: 5, name: 'Ivory Compact', primary: 0xe4ddcc, secondary: 0x34495e },
  { id: 6, name: 'Teal Concord', primary: 0x2f9e9a, secondary: 0x1f2a30 },
  { id: 7, name: 'Ember Syndicate', primary: 0xe07a1f, secondary: 0x2e2a28 },
  // The canonical factions of the doctrines past the eighth: a side that picks one wears these colours
  // (see variety.ts), but a battle still has at most eight slots.
  { id: 8, name: 'Verdant Protectorate', primary: 0x4cb86a, secondary: 0xdcefff },
  { id: 9, name: 'Celeste Dominion', primary: 0xa9d6e6, secondary: 0x22304a },
  { id: 10, name: 'Onyx Order', primary: 0x3b3f46, secondary: 0xd8434a },
  { id: 11, name: 'Magenta Directive', primary: 0xa83c82, secondary: 0x5f9e92 },
  { id: 12, name: 'Obsidian Choir', primary: 0x3a2f4a, secondary: 0xb9a6e0 },
  { id: 13, name: 'Olive Ascendancy', primary: 0x7b8a3c, secondary: 0xeee6c8 },
  { id: 14, name: 'Chartreuse Collective', primary: 0xa8b832, secondary: 0x3b2a1e },
  { id: 15, name: 'Sienna Caravan', primary: 0xa0522d, secondary: 0xe8d8b0 },
  { id: 16, name: 'Imperial Senate', primary: 0xb3262e, secondary: 0xe0c070 },
  { id: 17, name: 'Tinplate Regiment', primary: 0x2f4fa8, secondary: 0xd8b04a },
  { id: 18, name: 'Opaline Court', primary: 0xc9d6e3, secondary: 0x6a4c93 },
  { id: 19, name: 'Moss Wardens', primary: 0x5a7a3a, secondary: 0xd8c8a0 },
  { id: 20, name: 'Ferrous Union', primary: 0x8a5a44, secondary: 0xc8ccd2 },
  { id: 21, name: 'Abyssal Cult', primary: 0x2a5a6a, secondary: 0xc8b070 },
];

/** Most sides a battle can have. */
export const MAX_FACTIONS = 8;
