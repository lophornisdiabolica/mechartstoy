/**
 * Sound settings. Like the view settings they belong to this browser, not
 * the battle, so they're remembered locally and stay out of the shared link.
 */

/** What the mix panel can turn up or down on its own. */
export type SoundCategory = 'gunfire' | 'cannons' | 'explosions' | 'buildings' | 'alerts' | 'ambience';

export const CATEGORIES: { id: SoundCategory; label: string; title: string }[] = [
  { id: 'gunfire', label: 'Gunfire', title: 'Rifles, machine guns and flamers, and the crackle of distant firefights' },
  { id: 'cannons', label: 'Cannons', title: 'Tank guns, rocket launches and shells landing' },
  { id: 'explosions', label: 'Artillery', title: 'Artillery firing, heavy shells and bombs landing, vehicles going up, earthquakes' },
  { id: 'buildings', label: 'Buildings', title: 'Buildings collapsing, construction starting, engineers digging and bridging' },
  { id: 'alerts', label: 'Chimes', title: 'Outposts changing hands, super units falling, bases razed, sides knocked out, god powers, the end of the battle' },
  { id: 'ambience', label: 'Ambience', title: 'Wind, and the rumble of the war as a whole' },
];

export interface AudioPrefs {
  muted: boolean;
  /** Master volume, 0 to 1. */
  volume: number;
  /**
   * How much the sound follows the camera, 0 to 1: at 0 the whole battlefield
   * is heard about equally; at 1 only what's on screen is clear, and the rest
   * is a muffled distance away.
   */
  focus: number;
  /** Per-category volume, 0 to MIX_MAX (1 is as designed). */
  mix: Record<SoundCategory, number>;
  /** Alerts are heard wherever they happen (true), or follow the focus like everything else. */
  alertsEverywhere: boolean;
}

export const MIX_MAX = 1.5;
const KEY = 'mbt.audio';

export function defaultAudioPrefs(): AudioPrefs {
  return {
    muted: false,
    volume: 0.6,
    focus: 0.5,
    mix: { gunfire: 1, cannons: 1, explosions: 1, buildings: 1, alerts: 0.8, ambience: 1 },
    alertsEverywhere: true,
  };
}

const clamp = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);

/** Read saved settings over the defaults, ignoring anything missing or garbled. */
export function parseAudioPrefs(saved: unknown): AudioPrefs {
  const prefs = defaultAudioPrefs();
  if (!saved || typeof saved !== 'object') return prefs;
  const s = saved as Partial<Record<keyof AudioPrefs, unknown>>;
  if (typeof s.muted === 'boolean') prefs.muted = s.muted;
  if (typeof s.alertsEverywhere === 'boolean') prefs.alertsEverywhere = s.alertsEverywhere;
  prefs.volume = clamp(s.volume, 0, 1, prefs.volume);
  prefs.focus = clamp(s.focus, 0, 1, prefs.focus);
  if (s.mix && typeof s.mix === 'object') {
    const m = s.mix as Record<string, unknown>;
    for (const { id } of CATEGORIES) prefs.mix[id] = clamp(m[id], 0, MIX_MAX, prefs.mix[id]);
  }
  return prefs;
}

export function loadAudioPrefs(): AudioPrefs {
  try {
    return parseAudioPrefs(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return defaultAudioPrefs();
  }
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
