import * as D from '../core/dmath';
import { Rng } from '../core/rng';
import type { BiomeId } from '../world/biomes';
import { BIOMES } from '../world/biomes';
import type { DoctrineId } from './doctrines';
import { FACTIONS } from './factions';

/**
 * Procedural faction identities: a name and colours for a side that doesn't
 * wear its doctrine's canonical faction (a second Legion in a re-rolled
 * battle, or every side when variety asks for generated identities).
 *
 * The hull colour comes from a curated palette of named colours, picked to be
 * as far as possible (as the eye sees it, in OKLab, with the deterministic math so every browser picks alike) from every side already in
 * the battle and from the map's ground, so no white sides on snow. The name is
 * that colour's word plus an organisation word: one that suits the doctrine
 * when its pool has one left, else a generic political or military one.
 */

/** Named hull colours for generated sides. None of them is a canonical faction's colour word. */
export const IDENTITY_COLORS: readonly { word: string; color: number }[] = [
  { word: 'Jade', color: 0x4f9a4a },
  { word: 'Rust', color: 0xa0522d },
  { word: 'Slate', color: 0x5a6b7d },
  { word: 'Rose', color: 0xd46a8c },
  { word: 'Azure', color: 0x3ab0e0 },
  { word: 'Olive', color: 0x7d8a3a },
  { word: 'Sable', color: 0x3d3d48 },
  { word: 'Copper', color: 0xb87333 },
  { word: 'Saffron', color: 0xe8b830 },
  { word: 'Plum', color: 0x7a3e6e },
  { word: 'Coral', color: 0xe0705a },
  { word: 'Indigo', color: 0x4b3fa0 },
  { word: 'Bronze', color: 0x8c6d32 },
  { word: 'Mint', color: 0x6fcfa5 },
  { word: 'Scarlet', color: 0xd02a2a },
  { word: 'Lime', color: 0x9cc23a },
  { word: 'Magenta', color: 0xc0369a },
  { word: 'Umber', color: 0x6e4a2e },
  { word: 'Lilac', color: 0xb39ad8 },
  { word: 'Maroon', color: 0x6a1e2e },
  { word: 'Pine', color: 0x2f5e45 },
  { word: 'Orchid', color: 0xb05ab8 },
  { word: 'Cerulean', color: 0x2a6fc0 },
  { word: 'Ochre', color: 0xc28a2e },
];

/** Organisation words that suit each doctrine, besides the canonical faction's own. */
export const DOCTRINE_WORDS: Record<DoctrineId, readonly string[]> = {
  armour: ['Combine', 'Consortium', 'Union', 'Bulwark', 'Concern'],
  raiders: ['Brigade', 'Outriders', 'Rovers', 'Marauders', 'Band', 'Clans', 'Freebooters'],
  legion: ['Cohort', 'Levy', 'Phalanx', 'Horde', 'Muster', 'Multitude'],
  bastion: ['Citadel', 'Garrison', 'Battery', 'Bureau', 'Ministry'],
  talon: ['Brood', 'Pack', 'Coven', 'Clutch'],
  skyline: ['Wing', 'Squadron', 'Aerie', 'Ascendancy'],
  tidewater: ['Flotilla', 'Fleet', 'Armada', 'Admiralty'],
  firestorm: ['Cartel', 'Crucible', 'Furnace'],
};

/** Generic political and military organisation words, for when a doctrine's own pool runs out (or for variety). */
export const GENERIC_WORDS: readonly string[] = [
  'Accord', 'Pact', 'Compact', 'Concord', 'Covenant', 'Mandate', 'Directorate', 'Syndicate', 'League', 'Assembly',
  'Order', 'Dominion', 'Coalition', 'Republic', 'Federation', 'Alliance', 'Collective', 'Front', 'Council',
  'Commonwealth', 'Protectorate', 'Hegemony', 'Conclave', 'Vanguard', 'Watch', 'Authority',
];

/** A side's generated identity. */
export interface Identity {
  name: string;
  color: number;
}

/** What's already in the battle, for picking an identity apart from it. */
export interface IdentityContext {
  /** Hull colours of the other sides. */
  colors: readonly number[];
  /** Names of the other sides. */
  names: readonly string[];
  /** The map's biome, whose ground colours are avoided. */
  biome?: BiomeId;
}

/**
 * A fresh identity for a side of `doctrine`. Deterministic for a given rng
 * state and context.
 */
export function generateIdentity(doctrine: DoctrineId, ctx: IdentityContext, rng: Rng): Identity {
  const used = ctx.colors.map(toLab);
  const ground = ctx.biome ? groundColors(ctx.biome).map(toLab) : [];
  const usedWords = new Set(ctx.names.map((n) => n.trim().split(/\s+/)[0]));
  const free = IDENTITY_COLORS.filter((c) => !ctx.colors.includes(c.color) && !usedWords.has(c.word));
  const pool = free.length > 0 ? free : IDENTITY_COLORS;
  // Score each colour by its distance to the nearest side or patch of ground
  // (ground counts a little less: a side only has to stand out from it, not
  // from every other side), rounded so tiny float differences can't flip a pick.
  const scored = pool.map((c) => {
    const lab = toLab(c.color);
    let d = Infinity;
    for (const u of used) d = Math.min(d, dist(lab, u));
    for (const g of ground) d = Math.min(d, dist(lab, g) * 1.4);
    return { c, score: Math.round(d * 1e4) };
  });
  const best = Math.max(...scored.map((s) => s.score));
  // Any colour close to the best will do; pick among them so repeats vary.
  const near = scored.filter((s) => s.score >= best * 0.8);
  const color = rng.pick(near).c;
  return { name: `${color.word} ${pickWord(doctrine, ctx.names, rng)}`, color: color.color };
}

/** An organisation word: the doctrine's own most of the time, generic otherwise or once its pool runs dry. */
function pickWord(doctrine: DoctrineId, names: readonly string[], rng: Rng): string {
  const taken = new Set(names.map((n) => n.trim().split(/\s+/).slice(1).join(' ')));
  const own = DOCTRINE_WORDS[doctrine].filter((w) => !taken.has(w));
  const generic = GENERIC_WORDS.filter((w) => !taken.has(w));
  if (own.length > 0 && (generic.length === 0 || rng.chance(0.6))) return rng.pick(own);
  return rng.pick(generic.length > 0 ? generic : GENERIC_WORDS);
}

/** Whether a side's name and colour are a generated identity (so a re-roll may replace them). */
export function isGeneratedIdentity(name: string, color: number): boolean {
  const c = IDENTITY_COLORS.find((d) => d.color === color);
  return c !== undefined && name.trim().startsWith(`${c.word} `);
}

/**
 * The trim colour that goes with a hull colour: a canonical faction's own
 * trim, else one worked out from the hull (dark trim on a light hull, light
 * trim on a dark one, tinted toward the hull).
 */
export function trimFor(color: number): number {
  const canon = FACTIONS.find((d) => d.primary === color);
  if (canon) return canon.secondary;
  const [r, g, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const light = toLab(color)[0] > 0.68;
  const target = light ? [0x2b, 0x2b, 0x33] : [0xe8, 0xe2, 0xd6];
  const mix = (a: number, t: number) => Math.round(a * 0.2 + t * 0.8);
  return (mix(r, target[0]) << 16) | (mix(g, target[1]) << 8) | mix(b, target[2]);
}

function groundColors(biome: BiomeId): number[] {
  const g = BIOMES[biome]?.ground;
  return g ? [g.low, g.high, g.shore] : [];
}

/** sRGB hex to OKLab. */
function toLab(hex: number): [number, number, number] {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : D.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = lin((hex >> 16) & 255);
  const g = lin((hex >> 8) & 255);
  const b = lin(hex & 255);
  const cbrt = (v: number) => (v <= 0 ? 0 : D.pow(v, 1 / 3));
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return D.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
