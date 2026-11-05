import { FixedLoop } from '../core/loop';
import { Stage } from '../render/stage';
import { el } from './dom';
import { WEATHER_KINDS, WEATHER_LABELS, WeatherKind } from '../game/weather';

/** The camera's usual tilt, and the range photo mode allows (radians above the horizon). */
const TILT_MIN = (12 * Math.PI) / 180;
const TILT_MAX = (85 * Math.PI) / 180;
/** How far photo mode lets the camera zoom in. */
const PHOTO_ZOOM = 9;

/**
 * Photo mode (H): hides the interface, frees the camera (tilt it from
 * nearly flat to straight down, and zoom in much closer), and puts a small
 * bar at the bottom with the tilt, the time of day, the tilt-shift blur,
 * focus and colour, pause, and a button that saves the picture as a PNG.
 * Leaving (H or Esc) puts the camera's tilt, zoom limit and the light back;
 * the tilt-shift settings stay as set, like the panel's.
 */
export class PhotoMode {
  readonly bar = el('div', { id: 'photo', hidden: '' });
  private saved: { elevation: number; maxZoom: number } | null = null;
  private readonly sync: (() => void)[] = [];

  constructor(
    private readonly stage: Stage,
    private readonly loop: FixedLoop,
  ) {
    this.build();
    document.body.append(this.bar);
  }

  get active(): boolean {
    return this.saved !== null;
  }

  toggle(): void {
    if (this.active) this.leave();
    else this.enter();
  }

  enter(): void {
    if (this.active) return;
    const rig = this.stage.rig;
    this.saved = { elevation: rig.elevation, maxZoom: rig.maxZoom };
    rig.maxZoom = PHOTO_ZOOM;
    document.body.classList.add('photo');
    this.bar.hidden = false;
    for (const s of this.sync) s();
  }

  leave(): void {
    if (!this.saved) return;
    const rig = this.stage.rig;
    rig.elevation = this.saved.elevation;
    rig.maxZoom = this.saved.maxZoom;
    rig.jumpTo(rig.target.x, rig.target.z, Math.min(rig.zoom, this.saved.maxZoom));
    this.stage.daylight = null;
    this.stage.weatherOverride = null;
    this.saved = null;
    document.body.classList.remove('photo');
    this.bar.hidden = true;
  }

  private build(): void {
    const ts = this.stage.tiltShift;
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, title = '') => {
      const wrap = el('label', { class: 'slider', title });
      const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
      input.addEventListener('input', () => set(Number(input.value)));
      wrap.append(el('span', {}, label), input);
      this.bar.append(wrap);
      this.sync.push(() => (input.value = String(get())));
    };
    slider('Tilt', TILT_MIN, TILT_MAX, 0.01, () => this.stage.rig.elevation, (v) => (this.stage.rig.elevation = v), 'How steeply the camera looks down');
    slider('Time of day', 5, 19, 0.25, () => this.stage.daylight ?? 13, (v) => (this.stage.daylight = v), 'Where the sun is: dawn on the left, dusk on the right');
    // The weather: the battle's as it comes, or one kind, steady, for the picture.
    const weatherWrap = el('label', { class: 'slider', title: 'The battle’s own weather, or pick one for the picture' });
    const weather = el('select', {});
    weather.append(el('option', { value: '' }, 'Battle’s'), ...WEATHER_KINDS.map((k) => el('option', { value: k }, WEATHER_LABELS[k])));
    weather.addEventListener('change', () => (this.stage.weatherOverride = (weather.value || null) as WeatherKind | null));
    weatherWrap.append(el('span', {}, 'Weather'), weather);
    this.bar.append(weatherWrap);
    this.sync.push(() => (weather.value = this.stage.weatherOverride ?? ''));
    slider('Blur', 0, 14, 0.5, () => ts.settings.maxBlur, (v) => {
      ts.settings.maxBlur = v;
      ts.settings.enabled = v > 0;
      ts.apply();
    });
    slider('Focus', 0.2, 0.8, 0.01, () => ts.settings.focus, (v) => {
      ts.settings.focus = v;
      ts.apply();
    });
    slider('Colour', 0.6, 1.8, 0.05, () => ts.settings.saturation, (v) => {
      ts.settings.saturation = v;
      ts.apply();
    });
    const pause = el('button', { type: 'button' });
    let lastSpeed = 1;
    pause.addEventListener('click', () => {
      if (this.loop.timeScale > 0) {
        lastSpeed = this.loop.timeScale;
        this.loop.timeScale = 0;
      } else this.loop.timeScale = lastSpeed;
      pause.textContent = this.loop.timeScale > 0 ? 'Pause' : 'Play';
    });
    this.sync.push(() => (pause.textContent = this.loop.timeScale > 0 ? 'Pause' : 'Play'));
    const save = el('button', { type: 'button', class: 'primary' }, 'Save picture');
    save.addEventListener('click', () => {
      const a = el('a', { download: `battle-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`, href: this.stage.capture() });
      a.click();
    });
    const done = el('button', { type: 'button', title: 'Leave photo mode (H or Esc)' }, 'Done');
    done.addEventListener('click', () => this.leave());
    const buttons = el('div', { class: 'buttons' });
    buttons.append(pause, save, done);
    this.bar.append(buttons);
  }
}
