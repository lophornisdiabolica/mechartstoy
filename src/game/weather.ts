import { Rng } from '../core/rng';
import { BiomeId } from '../world/biomes';

/**
 * The battle's weather: what's falling, how thick the fog is and how much
 * cloud hides the sun, at any moment of the battle.
 *
 * Looks only, for now: the renderer draws it (see render/weather.ts) and
 * nothing in the sim reads it. It lives here, with the game, so that rules
 * can later: a system can ask `ctx.weather.at(world.time)` for sight ranges
 * in fog, slower going in a blizzard, lightning strikes and so on. It's a
 * pure function of the seed, the settings and the time, on its own random
 * stream, so the page's copy of a battle played in the worker (see
 * sim/mirror.ts) gets the same weather without being sent it, and adding
 * it changed nothing the sim does.
 */

/** A kind of weather. */
export type WeatherKind = 'clear' | 'rain' | 'storm' | 'snow' | 'fog';
export const WEATHER_KINDS: WeatherKind[] = ['clear', 'rain', 'storm', 'snow', 'fog'];

/** The setting: one kind all battle, or `changing`, spells of weather that suit the biome. */
export type WeatherSetting = WeatherKind | 'changing';
export const WEATHER_SETTINGS: WeatherSetting[] = ['clear', 'changing', 'rain', 'storm', 'snow', 'fog'];

export const WEATHER_LABELS: Record<WeatherSetting, string> = {
  clear: 'Clear',
  changing: 'Changing',
  rain: 'Rain',
  storm: 'Storm',
  snow: 'Snow',
  fog: 'Fog',
};

export function isWeatherSetting(v: string): v is WeatherSetting {
  return (WEATHER_SETTINGS as string[]).includes(v);
}

/**
 * The weather at a moment, as amounts from 0 to 1 that blend smoothly from
 * one spell into the next (rain can be easing off while fog rolls in).
 */
export interface WeatherState {
  /** The main kind of weather now (the spell that's mostly in). */
  kind: WeatherKind;
  /** How hard it's raining. */
  rain: number;
  /** How hard it's snowing. */
  snow: number;
  /** How thick the fog is. */
  fog: number;
  /** How often lightning strikes. */
  lightning: number;
  /** How much cloud dims the sun and softens shadows. */
  cloud: number;
  /** Which way and how fast falling rain and snow drift, in world units a second. */
  windX: number;
  windZ: number;
}

/** A stretch of one kind of weather. */
interface Spell {
  kind: WeatherKind;
  start: number;
  /** 0.5 (light) to 1 (heavy). */
  strength: number;
  windX: number;
  windZ: number;
}

/** Seconds one spell takes to give way to the next. */
const TRANSITION = 40;

/** Chance of each kind of spell under `changing`, by biome: no snow in the desert, snow instead of rain on snow maps. */
const CLIMATES: Record<BiomeId, Partial<Record<WeatherKind, number>>> = {
  temperate: { clear: 40, rain: 24, storm: 10, fog: 16, snow: 10 },
  forest: { clear: 32, rain: 26, storm: 10, fog: 26, snow: 6 },
  desert: { clear: 72, rain: 8, storm: 12, fog: 8 },
  snow: { clear: 36, snow: 46, fog: 18 },
};

/** How long spells last, in seconds: clear spells longer, so weather comes and goes. */
const SPELL_LENGTH: Record<WeatherKind, [number, number]> = {
  clear: [180, 420],
  rain: [120, 300],
  storm: [90, 220],
  snow: [150, 320],
  fog: [120, 280],
};

/** How fast precipitation drifts, per kind, in world units a second. */
const WIND: Record<WeatherKind, [number, number]> = {
  clear: [0, 2],
  rain: [1.5, 5],
  storm: [7, 13],
  snow: [1, 4],
  fog: [0, 1.5],
};

const CLEAR: Omit<WeatherState, 'kind' | 'windX' | 'windZ'> = { rain: 0, snow: 0, fog: 0, lightning: 0, cloud: 0 };

/** What one kind of weather amounts to at a strength. */
function amounts(kind: WeatherKind, s: number): Omit<WeatherState, 'kind' | 'windX' | 'windZ'> {
  switch (kind) {
    case 'clear':
      return CLEAR;
    case 'rain':
      return { rain: s, snow: 0, fog: 0.15 * s, lightning: 0, cloud: 0.45 + 0.35 * s };
    case 'storm':
      return { rain: 1, snow: 0, fog: 0.2, lightning: s, cloud: 0.95 };
    case 'snow':
      return { rain: 0, snow: s, fog: 0.25 * s, lightning: 0, cloud: 0.4 + 0.35 * s };
    case 'fog':
      return { rain: 0, snow: 0, fog: 0.55 + 0.45 * s, lightning: 0, cloud: 0.4 };
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * This file is sim code (src/game), so it keeps to the operations every
 * engine rounds the same (see core/dmath.ts): no Math.sin or Math.cos.
 */

/** A random direction, scaled to length `w`: a point picked in the unit disc, then normalised. */
function windFrom(rng: Rng, w: number): { windX: number; windZ: number } {
  for (;;) {
    const x = rng.range(-1, 1);
    const z = rng.range(-1, 1);
    const d = Math.sqrt(x * x + z * z);
    if (d > 0.05 && d <= 1) return { windX: (x / d) * w, windZ: (z / d) * w };
  }
}

/** A smooth wave between -1 and 1 with period 2 pi, like sin but built from exact operations. */
function wave(x: number): number {
  const p = x / (Math.PI * 2);
  const f = p - Math.floor(p);
  const tri = f < 0.5 ? f * 2 : 2 - f * 2;
  return 2 * smooth(tri) - 1;
}

export class Weather {
  private readonly spells: Spell[] = [];
  private readonly rng: Rng;
  /** Where the spells drawn so far run out. */
  private until = 0;

  constructor(
    seed: number,
    readonly setting: WeatherSetting,
    private readonly biome: BiomeId,
  ) {
    this.rng = new Rng((seed ^ 0x77656174) >>> 0);
    if (setting !== 'changing') {
      // One spell all battle, heavy enough to see, with its own wind.
      const [w0, w1] = WIND[setting];
      this.spells.push({ kind: setting, start: 0, strength: 0.85, ...windFrom(this.rng, (w0 + w1) / 2) });
      this.until = Infinity;
    }
  }

  /** The weather at sim time `t` (seconds since the battle began). */
  at(t: number): WeatherState {
    if (this.setting !== 'changing') return this.state(this.spells[0], this.spells[0], 1, t);
    while (this.until <= t + TRANSITION) this.draw();
    // Spells are in order of start; find the one t falls in.
    let i = this.spells.length - 1;
    while (i > 0 && this.spells[i].start > t) i--;
    const cur = this.spells[i];
    const into = t - cur.start;
    if (i === 0 || into >= TRANSITION) return this.state(cur, cur, 1, t);
    return this.state(this.spells[i - 1], cur, smooth(into / TRANSITION), t);
  }

  /** The spells' start times and kinds up to `t`, for the ticker or a timeline. */
  spellsUntil(t: number): { start: number; kind: WeatherKind }[] {
    if (this.setting === 'changing') while (this.until <= t) this.draw();
    return this.spells.filter((s) => s.start <= t).map((s) => ({ start: s.start, kind: s.kind }));
  }

  private draw(): void {
    const climate = CLIMATES[this.biome];
    const prev = this.spells.at(-1)?.kind;
    // No spell follows one of its own kind, and weather spells go back to clear more often than not.
    const kinds = (Object.keys(climate) as WeatherKind[]).filter((k) => k !== prev);
    const weights = kinds.map((k) => (climate[k] ?? 0) * (prev && prev !== 'clear' && k === 'clear' ? 1.6 : 1));
    let r = this.rng.next() * weights.reduce((a, b) => a + b, 0);
    let k = 0;
    while (k < kinds.length - 1 && (r -= weights[k]) > 0) k++;
    const kind = kinds[k];
    const [l0, l1] = SPELL_LENGTH[kind];
    const [w0, w1] = WIND[kind];
    const w = this.rng.range(w0, w1);
    const strength = this.rng.range(0.5, 1);
    this.spells.push({ kind, start: this.until, strength, ...windFrom(this.rng, w) });
    this.until += this.rng.range(l0, l1);
  }

  private state(from: Spell, to: Spell, k: number, t: number): WeatherState {
    // A slow swell, so even a steady spell comes in heavier and lighter bursts.
    const swell = (s: Spell) => Math.min(1, s.strength * (0.88 + 0.12 * wave(t / 23 + s.start)));
    const a = amounts(from.kind, swell(from));
    const b = amounts(to.kind, swell(to));
    const mix = (x: number, y: number) => x + (y - x) * k;
    return {
      kind: k < 0.5 ? from.kind : to.kind,
      rain: mix(a.rain, b.rain),
      snow: mix(a.snow, b.snow),
      fog: mix(a.fog, b.fog),
      lightning: mix(a.lightning, b.lightning),
      cloud: mix(a.cloud, b.cloud),
      windX: mix(from.windX, to.windX),
      windZ: mix(from.windZ, to.windZ),
    };
  }
}

/** The weather a kind gives on its own, steady (photo mode's override). */
export function steadyWeather(kind: WeatherKind, strength = 0.9): WeatherState {
  const [w0, w1] = WIND[kind];
  const w = (w0 + w1) / 2;
  return { kind, ...amounts(kind, strength), windX: w * 0.8, windZ: w * 0.6 };
}
