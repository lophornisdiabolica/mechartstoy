import { ShadowQuality } from '../render/stage';

/**
 * Display preferences: how the battle looks and where the camera goes,
 * not how it plays. They belong to this browser rather than the battle,
 * so they're remembered locally instead of going in the shared link.
 */
export interface ViewPrefs {
  shadows: ShadowQuality;
  /** Spectator camera that follows the fighting. */
  follow: boolean;
  /** Draw each side's plan on the map. */
  plans: boolean;
  /** Shade who holds which ground (see FrontLines). */
  fronts: boolean;
  /** The battle ticker's feed (see Ticker). */
  ticker: boolean;
  /** Held Q / E turn the camera smoothly to any angle, instead of in 90 degree steps. */
  smoothTurn: boolean;
}

const KEY = 'mbt.view';
const SHADOWS: ShadowQuality[] = ['high', 'low', 'off'];

export function loadViewPrefs(): ViewPrefs {
  const prefs: ViewPrefs = { shadows: 'high', follow: false, plans: false, fronts: false, ticker: true, smoothTurn: false };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ViewPrefs>;
    if (SHADOWS.includes(saved.shadows as ShadowQuality)) prefs.shadows = saved.shadows!;
    if (typeof saved.follow === 'boolean') prefs.follow = saved.follow;
    if (typeof saved.plans === 'boolean') prefs.plans = saved.plans;
    if (typeof saved.fronts === 'boolean') prefs.fronts = saved.fronts;
    if (typeof saved.ticker === 'boolean') prefs.ticker = saved.ticker;
    if (typeof saved.smoothTurn === 'boolean') prefs.smoothTurn = saved.smoothTurn;
  } catch {
    // Storage blocked or garbled: use the defaults.
  }
  return prefs;
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}
