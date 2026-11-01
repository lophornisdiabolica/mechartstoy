import { BattleSettings, defaultFaction, defaultSettings, LIMITS, MAP_SIZES, MapSize, MAX_FACTIONS, UNIT_IDS } from '../game/settings';

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
  { key: 'cap', limit: 'unitCap', get: (s) => s.armies.unitCap, set: (s, v) => (s.armies.unitCap = Math.round(v)) },
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
  { key: 'ohold', limit: 'outpostHold', get: (s) => s.armies.outpostHold, set: (s, v) => (s.armies.outpostHold = v) },
  { key: 'obonus', limit: 'outpostBonus', get: (s) => s.armies.outpostBonus, set: (s, v) => (s.armies.outpostBonus = v) },
  { key: 'bhp', limit: 'buildingHp', get: (s) => s.armies.buildingHp, set: (s, v) => (s.armies.buildingHp = v) },
];

const UNIT_STATS = ['hp', 'damage', 'speed', 'range'] as const;

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
  if (s.map.size !== d.map.size) p.set('size', s.map.size);
  if (s.map.town !== d.map.town) p.set('town', s.map.town ? '1' : '0');
  if (s.map.outposts !== d.map.outposts) p.set('outposts', String(s.map.outposts));
  for (const n of NUMBERS) if (n.get(s) !== n.get(d)) p.set(n.key, fmt(n.get(s)));
  for (const id of UNIT_IDS) {
    const t = s.units[id];
    if (UNIT_STATS.some((k) => t[k] !== 1)) p.set(id, UNIT_STATS.map((k) => fmt(t[k])).join(','));
  }
  if (s.armies.evenTeams !== d.armies.evenTeams) p.set('even', s.armies.evenTeams ? '1' : '0');
  // Sides: how many (if not two), then each one's changes from its slot's defaults. Teams are written 1-based.
  if (s.factions.length !== d.factions.length) p.set('sides', String(s.factions.length));
  s.factions.forEach((f, i) => {
    const def = defaultFaction(i);
    if (f.name !== def.name) p.set(`name${i + 1}`, f.name);
    if (f.color !== def.color) p.set(`color${i + 1}`, hexColor(f.color));
    if (f.team !== def.team) p.set(`team${i + 1}`, String(f.team + 1));
  });
  return p;
}

export function settingsFromParams(p: URLSearchParams): BattleSettings {
  const s = defaultSettings();
  s.seed = (p.get('seed') ?? '').slice(0, 40);
  const mode = p.get('mode');
  if (mode === 'eternal' || mode === 'conquest') s.mode = mode;
  const size = p.get('size');
  if (size && size in MAP_SIZES) s.map.size = size as MapSize;
  const town = p.get('town');
  if (town === '0' || town === '1') s.map.town = town === '1';
  const outposts = p.get('outposts');
  if (outposts !== null && outposts !== 'auto' && outposts.trim() !== '' && Number.isFinite(Number(outposts))) {
    s.map.outposts = Math.round(clamp(Number(outposts), 'outposts'));
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
  const even = p.get('even');
  if (even === '0' || even === '1') s.armies.evenTeams = even === '1';
  const sides = Math.round(Number(p.get('sides')));
  if (Number.isFinite(sides) && sides >= 2) s.factions = Array.from({ length: Math.min(MAX_FACTIONS, sides) }, (_, i) => defaultFaction(i));
  s.factions.forEach((f, i) => {
    const team = Math.round(Number(p.get(`team${i + 1}`)));
    if (Number.isFinite(team) && team >= 1 && team <= s.factions.length) f.team = team - 1;
    const name = p.get(`name${i + 1}`);
    if (name !== null && name.trim()) f.name = name.trim().slice(0, 32);
    const color = p.get(`color${i + 1}`);
    if (color && /^[0-9a-f]{6}$/i.test(color)) f.color = parseInt(color, 16);
  });
  return s;
}
