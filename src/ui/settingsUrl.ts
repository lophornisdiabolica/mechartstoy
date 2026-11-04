import { isStyle } from '../game/commander/advice';
import { DOCTRINE_IDS, isDoctrine } from '../game/doctrines';
import { VARIETY_AFTER, VARIETY_KEYS } from '../game/variety';
import { BattleSettings, MapSpot, defaultFaction, defaultSettings, LIMITS, MAP_SIZES, MapSize, MAX_FACTIONS, TOWN_SIZES, TownSize, UNIT_IDS } from '../game/settings';
import { isBiome } from '../world/biomes';
import { OUTPOST_KIND_IDS } from '../world/battlefield';

/**
 * Settings <-> URL query string. Only values that differ from the defaults are
 * written, so a plain link stays plain and a shared link carries just what
 * was changed. Parsing is forgiving: unknown or broken values fall back to
 * the defaults and numbers are clamped to the UI's ranges.
 */

/** Short URL names for the numeric settings. */
const NUMBERS: { key: string; limit: keyof typeof LIMITS; get: (s: BattleSettings) => number; set: (s: BattleSettings, v: number) => void }[] = [
  { key: 'water', limit: 'water', get: (s) => s.map.water, set: (s, v) => (s.map.water = v) },
  { key: 'hills', limit: 'hills', get: (s) => s.map.hills, set: (s, v) => (s.map.hills = v) },
  { key: 'shape', limit: 'shape', get: (s) => s.map.shape, set: (s, v) => (s.map.shape = v) },
  { key: 'forest', limit: 'forest', get: (s) => s.map.forest, set: (s, v) => (s.map.forest = v) },
  { key: 'towns', limit: 'towns', get: (s) => s.map.towns, set: (s, v) => (s.map.towns = Math.round(v)) },
  { key: 'icap', limit: 'infantryCap', get: (s) => s.armies.caps.infantry, set: (s, v) => (s.armies.caps.infantry = Math.round(v)) },
  { key: 'vcap', limit: 'vehicleCap', get: (s) => s.armies.caps.vehicle, set: (s, v) => (s.armies.caps.vehicle = Math.round(v)) },
  { key: 'acap', limit: 'airCap', get: (s) => s.armies.caps.air, set: (s, v) => (s.armies.caps.air = Math.round(v)) },
  { key: 'scap', limit: 'superCap', get: (s) => s.armies.caps.super, set: (s, v) => (s.armies.caps.super = Math.round(v)) },
  { key: 'prod', limit: 'production', get: (s) => s.armies.production, set: (s, v) => (s.armies.production = v) },
  { key: 'army', limit: 'startingArmy', get: (s) => s.armies.startingArmy, set: (s, v) => (s.armies.startingArmy = Math.round(v)) },
  { key: 'tide', limit: 'tideStrength', get: (s) => s.armies.tideStrength, set: (s, v) => (s.armies.tideStrength = v) },
  { key: 'tidelen', limit: 'tidePeriod', get: (s) => s.armies.tidePeriod, set: (s, v) => (s.armies.tidePeriod = v) },
  { key: 'flank', limit: 'flanking', get: (s) => s.armies.flanking, set: (s, v) => (s.armies.flanking = v) },
  // Ramps: plain keys for Conquest, e-prefixed for Eternal.
  { key: 'ramp', limit: 'ramp', get: (s) => s.armies.ramp.conquest.tide, set: (s, v) => (s.armies.ramp.conquest.tide = v) },
  { key: 'siege', limit: 'ramp', get: (s) => s.armies.ramp.conquest.siege, set: (s, v) => (s.armies.ramp.conquest.siege = v) },
  { key: 'eramp', limit: 'ramp', get: (s) => s.armies.ramp.eternal.tide, set: (s, v) => (s.armies.ramp.eternal.tide = v) },
  { key: 'esiege', limit: 'ramp', get: (s) => s.armies.ramp.eternal.siege, set: (s, v) => (s.armies.ramp.eternal.siege = v) },
  { key: 'advice', limit: 'advice', get: (s) => s.armies.advice, set: (s, v) => (s.armies.advice = v) },
  { key: 'eng', limit: 'engineers', get: (s) => s.armies.engineers, set: (s, v) => (s.armies.engineers = Math.round(v)) },
  { key: 'tforce', limit: 'taskForces', get: (s) => s.armies.taskForces, set: (s, v) => (s.armies.taskForces = v) },
  { key: 'ohold', limit: 'outpostHold', get: (s) => s.armies.outpostHold, set: (s, v) => (s.armies.outpostHold = v) },
  { key: 'even', limit: 'evenTeams', get: (s) => s.armies.evenTeams, set: (s, v) => (s.armies.evenTeams = v) },
  { key: 'obonus', limit: 'outpostBonus', get: (s) => s.armies.outpostBonus, set: (s, v) => (s.armies.outpostBonus = v) },
  { key: 'bhp', limit: 'buildingHp', get: (s) => s.armies.buildingHp, set: (s, v) => (s.armies.buildingHp = v) },
];

export const UNIT_STATS = ['hp', 'damage', 'speed', 'range'] as const;

function clamp(v: number, limit: keyof typeof LIMITS): number {
  const { min, max } = LIMITS[limit];
  return Math.max(min, Math.min(max, v));
}

/** Trim float noise so URLs read 1.25, not 1.2500000001. */
function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function hexColor(c: number): string {
  return c.toString(16).padStart(6, '0');
}

export function settingsToParams(s: BattleSettings): URLSearchParams {
  const d = defaultSettings();
  const p = new URLSearchParams();
  if (s.seed) p.set('seed', s.seed);
  if (s.mode !== d.mode) p.set('mode', s.mode);
  if (s.armies.attackTiming !== d.armies.attackTiming) p.set('attacks', s.armies.attackTiming);
  if (s.armies.superGrowth !== d.armies.superGrowth) p.set('sgrow', s.armies.superGrowth);
  if (s.armies.superGate !== d.armies.superGate) p.set('sgate', s.armies.superGate ? '1' : '0');
  if (s.map.size !== d.map.size) p.set('size', s.map.size);
  if (s.map.biome !== d.map.biome) p.set('biome', s.map.biome);
  if (s.map.layout !== d.map.layout) p.set('layout', s.map.layout);
  if (s.map.townSize !== d.map.townSize) p.set('tsize', s.map.townSize);
  if (s.map.waterways !== d.map.waterways) p.set('ways', s.map.waterways ? '1' : '0');
  if (s.map.scrap !== d.map.scrap) p.set('scrap', s.map.scrap ? '1' : '0');
  if (s.map.outposts !== d.map.outposts) p.set('outposts', String(s.map.outposts));
  if (s.map.outpostKinds.join(',') !== d.map.outpostKinds.join(',')) p.set('okinds', s.map.outpostKinds.join(',') || 'supply');
  // Hand-placed spots: "x,z;x,z", in fractions of the map's half-width and half-depth.
  const spots = (list: MapSpot[]) => list.map((q) => `${fmt(round2(q.x))},${fmt(round2(q.z))}`).join(';');
  if (s.map.placed.bases) p.set('bpos', spots(s.map.placed.bases));
  if (s.map.placed.towns) p.set('tpos', spots(s.map.placed.towns));
  if (s.map.placed.outposts) p.set('opos', spots(s.map.placed.outposts));
  for (const n of NUMBERS) if (n.get(s) !== n.get(d)) p.set(n.key, fmt(n.get(s)));
  for (const id of UNIT_IDS) {
    const t = s.units[id];
    if (UNIT_STATS.some((k) => t[k] !== 1)) p.set(id, UNIT_STATS.map((k) => fmt(t[k])).join(','));
  }
  // Sides: how many (if not two), then each one's changes from its slot's defaults. Teams are written 1-based.
  if (s.factions.length !== d.factions.length) p.set('sides', String(s.factions.length));
  s.factions.forEach((f, i) => {
    const def = defaultFaction(i);
    if (f.name !== def.name) p.set(`name${i + 1}`, f.name);
    if (f.color !== def.color) p.set(`color${i + 1}`, hexColor(f.color));
    if (f.team !== def.team) p.set(`team${i + 1}`, String(f.team + 1));
    if (f.doctrine !== def.doctrine) p.set(`doc${i + 1}`, f.doctrine);
    if (f.style !== def.style) p.set(`style${i + 1}`, f.style);
  });
  // Variety between battles: vary=size,biome,... and its options.
  const v = s.variety;
  const dv = d.variety;
  const rolled = VARIETY_KEYS.filter((k) => v.roll[k]);
  if (rolled.length) p.set('vary', rolled.join(','));
  if (v.sidesMin !== dv.sidesMin || v.sidesMax !== dv.sidesMax) p.set('vsides', `${v.sidesMin}-${v.sidesMax}`);
  if (v.teams !== dv.teams) p.set('vteams', v.teams);
  if (v.doctrines.join(',') !== dv.doctrines.join(',')) p.set('vdocs', v.doctrines.join(','));
  if (v.after !== dv.after) p.set('vafter', String(v.after));
  return p;
}

export function settingsFromParams(p: URLSearchParams): BattleSettings {
  const s = defaultSettings();
  applyParams(s, p);
  return s;
}

/** Apply the settings a query string carries on top of `s`, leaving everything it doesn't mention alone. */
export function applyParams(s: BattleSettings, p: URLSearchParams): void {
  const seed = p.get('seed');
  if (seed !== null) s.seed = seed.slice(0, 40);
  const mode = p.get('mode');
  if (mode === 'eternal' || mode === 'conquest') s.mode = mode;
  const attacks = p.get('attacks');
  if (attacks === 'readiness' || attacks === 'tide') s.armies.attackTiming = attacks;
  const grow = p.get('sgrow');
  if (grow === 'none' || grow === 'tide' || grow === 'outposts') s.armies.superGrowth = grow;
  const gate = p.get('sgate');
  if (gate === '0' || gate === '1') s.armies.superGate = gate === '1';
  const size = p.get('size');
  if (size && size in MAP_SIZES) s.map.size = size as MapSize;
  // Links from before there could be several towns say town=0 or town=1.
  const town = p.get('town');
  if (town === '0' || town === '1') s.map.towns = Number(town);
  const biome = p.get('biome');
  if (biome && isBiome(biome)) s.map.biome = biome;
  const layout = p.get('layout');
  if (layout === 'ring' || layout === 'apart' || layout === 'lines') s.map.layout = layout;
  const tsize = p.get('tsize');
  if (tsize && tsize in TOWN_SIZES) s.map.townSize = tsize as TownSize;
  const ways = p.get('ways');
  if (ways === '0' || ways === '1') s.map.waterways = ways === '1';
  const scrap = p.get('scrap');
  if (scrap === '0' || scrap === '1') s.map.scrap = scrap === '1';
  const outposts = p.get('outposts');
  if (outposts !== null && outposts !== 'auto' && outposts.trim() !== '' && Number.isFinite(Number(outposts))) {
    s.map.outposts = Math.round(clamp(Number(outposts), 'outposts'));
  }
  const spots = (key: string): MapSpot[] | null => {
    const raw = p.get(key);
    if (!raw) return null;
    const list = raw.split(';').map((pair) => pair.split(',').map(Number));
    if (list.some((q) => q.length !== 2 || !q.every(Number.isFinite))) return null;
    return list.map(([x, z]) => ({ x: Math.max(-1, Math.min(1, x)), z: Math.max(-1, Math.min(1, z)) }));
  };
  if (p.has('bpos')) s.map.placed.bases = spots('bpos');
  if (p.has('tpos')) s.map.placed.towns = spots('tpos');
  if (p.has('opos')) s.map.placed.outposts = spots('opos');
  // Outpost kinds as a list, e.g. okinds=supply,gun (kept in the standard order).
  const okinds = p.get('okinds');
  if (okinds !== null) {
    const listed = okinds.split(',').map((k) => k.trim());
    const kinds = OUTPOST_KIND_IDS.filter((k) => listed.includes(k));
    if (kinds.length > 0) s.map.outpostKinds = kinds;
  }
  for (const n of NUMBERS) {
    const raw = p.get(n.key);
    const v = raw === null ? NaN : Number(raw);
    if (Number.isFinite(v)) n.set(s, clamp(v, n.limit));
  }
  for (const id of UNIT_IDS) {
    const parts = (p.get(id) ?? '').split(',').map(Number);
    UNIT_STATS.forEach((k, i) => {
      if (Number.isFinite(parts[i]) && parts[i] > 0) s.units[id][k] = clamp(parts[i], 'unitStat');
    });
  }
  const sides = Math.round(Number(p.get('sides')));
  if (Number.isFinite(sides) && sides >= 2) s.factions = Array.from({ length: Math.min(MAX_FACTIONS, sides) }, (_, i) => defaultFaction(i));
  s.factions.forEach((f, i) => {
    const team = Math.round(Number(p.get(`team${i + 1}`)));
    if (Number.isFinite(team) && team >= 1 && team <= s.factions.length) f.team = team - 1;
    const name = p.get(`name${i + 1}`);
    if (name !== null && name.trim()) f.name = name.trim().slice(0, 32);
    const color = p.get(`color${i + 1}`);
    if (color && /^[0-9a-f]{6}$/i.test(color)) f.color = parseInt(color, 16);
    const doctrine = p.get(`doc${i + 1}`);
    if (isDoctrine(doctrine)) f.doctrine = doctrine;
    const style = p.get(`style${i + 1}`);
    if (isStyle(style)) f.style = style;
  });
  const vary = p.get('vary');
  if (vary !== null) {
    const listed = vary.split(',').map((k) => k.trim());
    for (const k of VARIETY_KEYS) s.variety.roll[k] = listed.includes(k);
  }
  const vsides = p.get('vsides')?.match(/^(\d+)-(\d+)$/);
  if (vsides) {
    const [lo, hi] = [Number(vsides[1]), Number(vsides[2])].map((n) => Math.max(2, Math.min(MAX_FACTIONS, n)));
    s.variety.sidesMin = Math.min(lo, hi);
    s.variety.sidesMax = Math.max(lo, hi);
  }
  const vteams = p.get('vteams');
  if (vteams === 'ffa' || vteams === 'two' || vteams === 'either') s.variety.teams = vteams;
  const vdocs = p.get('vdocs');
  if (vdocs !== null) {
    const listed = vdocs.split(',').map((k) => k.trim());
    const docs = DOCTRINE_IDS.filter((d) => listed.includes(d));
    if (docs.length > 0) s.variety.doctrines = docs;
  }
  const vafter = p.get('vafter');
  if (vafter !== null && VARIETY_AFTER.includes(Number(vafter))) s.variety.after = Number(vafter);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * The `at` URL option: open the battle fast-forwarded to this point, in
 * seconds. Written as minutes ("25" or "25m"), seconds ("90s") or
 * minutes and seconds ("12:30"). Null if missing or unreadable.
 */
export function parseAt(value: string | null): number | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  let seconds: number;
  const mmss = v.match(/^(\d+):(\d{1,2})$/);
  if (mmss) seconds = Number(mmss[1]) * 60 + Number(mmss[2]);
  else if (/^\d+(\.\d+)?s$/.test(v)) seconds = Number(v.slice(0, -1));
  else if (/^\d+(\.\d+)?m?$/.test(v)) seconds = Number(v.replace('m', '')) * 60;
  else return null;
  return seconds > 0 && Number.isFinite(seconds) ? seconds : null;
}
