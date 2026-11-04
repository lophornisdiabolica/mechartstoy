import { hashSeed, Rng } from '../core/rng';
import { battlefieldConfig, BattleSettings, defaultSettings } from '../game/settings';
import { applyParams } from '../ui/settingsUrl';
import { generateBattlefield } from '../world/battlefield';
import { mapPicture, Picture } from '../world/mapPicture';
import { parseSeed, scenarioSettings } from './simulate';

/**
 * `npm run map` (see scripts/map.mjs): the map a battle would be played on,
 * as a picture, without starting the battle. Generates exactly what the game
 * does for the same settings and seed.
 */

/**
 * Settings from what's typed: a battle's link or query string (with or
 * without the address in front), or a sims battle seed such as 1v1-7 (with
 * `extra`, a query string, on top).
 */
export function settingsFor(spec: string, extra = ''): BattleSettings {
  const found = parseSeed(spec);
  if (found) return scenarioSettings(found.scenario, found.battle, extra);
  const query = spec.includes('?') ? spec.slice(spec.indexOf('?') + 1) : spec;
  const s = defaultSettings();
  applyParams(s, new URLSearchParams(query));
  if (extra) applyParams(s, new URLSearchParams(extra));
  return s;
}

/** The picture of the map for these settings (its seed, or `seed` if it has none). */
export function pictureFor(settings: BattleSettings, seed: string, scale: number): Picture {
  const field = generateBattlefield(new Rng(hashSeed(settings.seed || seed)).fork(1), battlefieldConfig(settings));
  return mapPicture(field, settings.factions.map((f) => f.color), scale);
}
