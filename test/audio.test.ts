import { describe, expect, it } from 'vitest';
import { Activity, BUDGET, choose, Cue, INAUDIBLE, Listener, MAX_VOICES, place } from '../src/audio/mixer';
import { CATEGORIES, defaultAudioPrefs, MIX_MAX, parseAudioPrefs, SoundCategory } from '../src/audio/prefs';
import { LOOP_IDS, renderLoop, renderSound, SOUND_IDS, variantsOf } from '../src/audio/synth';

const RATE = 22050;
const listener: Listener = { x: 0, z: 0, radius: 40, rightX: 1, rightZ: 0, zoomOut: 0.5 };
const idle = (): Record<SoundCategory, number> => ({ gunfire: 0, cannons: 0, explosions: 0, buildings: 0, alerts: 0, ambience: 0 });

describe('sound synthesis', () => {
  it('renders every sound and loop as finite samples within range', () => {
    for (const id of SOUND_IDS) {
      for (let v = 0; v < variantsOf(id); v++) {
        const s = renderSound(id, RATE, v);
        expect(s.length, id).toBeGreaterThan(RATE * 0.1);
        let peak = 0;
        let finite = true;
        for (const x of s) {
          finite &&= Number.isFinite(x);
          peak = Math.max(peak, Math.abs(x));
        }
        expect(finite, id).toBe(true);
        expect(peak, id).toBeGreaterThan(0.3);
        expect(peak, id).toBeLessThanOrEqual(1);
        // Ends in silence, so a voice never clicks off.
        expect(Math.abs(s[s.length - 1]), id).toBeLessThan(0.01);
      }
    }
    for (const id of LOOP_IDS) {
      const s = renderLoop(id, RATE);
      expect(s.length, id).toBeGreaterThan(RATE * 5);
      // The seam: the end runs into the start without a jump.
      expect(Math.abs(s[s.length - 1] - s[0]), id).toBeLessThan(0.05);
    }
  }, 30_000);

  it('renders the same samples every time, and different variants differ', () => {
    expect(renderSound('blast', RATE, 1)).toEqual(renderSound('blast', RATE, 1));
    expect(renderSound('rifle', RATE, 0)).not.toEqual(renderSound('rifle', RATE, 1));
  });
});

describe('placing sounds', () => {
  it('is loudest where the camera looks and fades with distance', () => {
    const centre = place(0, 0, listener, 0.5);
    const edge = place(40, 0, listener, 0.5);
    const far = place(200, 0, listener, 0.5);
    expect(centre.gain).toBeCloseTo(1);
    expect(edge.gain).toBeLessThan(centre.gain);
    expect(far.gain).toBeLessThan(edge.gain);
    expect(far.far).toBeGreaterThan(edge.far);
  });

  it('focus narrows what is heard: far things are quieter and more muffled at high focus', () => {
    const wide = place(160, 0, listener, 0);
    const tight = place(160, 0, listener, 1);
    expect(wide.gain).toBeGreaterThan(0.6);
    expect(tight.gain).toBeLessThan(0.05);
    expect(tight.far).toBeGreaterThan(wide.far);
  });

  it('zooming in (a smaller view) makes the same spot sound further away', () => {
    const out = place(60, 0, { ...listener, radius: 80 }, 0.5);
    const zoomedIn = place(60, 0, { ...listener, radius: 20 }, 0.5);
    expect(zoomedIn.gain).toBeLessThan(out.gain);
  });

  it('pans to the side of the screen the sound is on', () => {
    expect(place(30, 0, listener, 0.5).pan).toBeGreaterThan(0.3);
    expect(place(-30, 0, listener, 0.5).pan).toBeLessThan(-0.3);
    expect(place(0, 30, listener, 0.5).pan).toBeCloseTo(0);
    // Turned the other way round, right is left.
    expect(place(30, 0, { ...listener, rightX: -1 }, 0.5).pan).toBeLessThan(-0.3);
  });
});

describe('choosing voices', () => {
  const cue = (category: SoundCategory, gain: number): Cue => ({ sound: 'rifle', category, gain, far: 0, pan: 0, rate: 1 });

  it('keeps the loudest within each category’s budget', () => {
    const cues = Array.from({ length: 50 }, (_, i) => cue('gunfire', 0.1 + i * 0.01));
    const picked = choose(cues, idle(), 0);
    expect(picked.length).toBe(BUDGET.gunfire.perFrame);
    expect(Math.min(...picked.map((c) => c.gain))).toBeCloseTo(0.1 + 47 * 0.01);
  });

  it('skips inaudible cues, full categories and a full mixer', () => {
    expect(choose([cue('cannons', INAUDIBLE / 2)], idle(), 0)).toEqual([]);
    expect(choose([cue('cannons', 1)], { ...idle(), cannons: BUDGET.cannons.playing }, 0)).toEqual([]);
    expect(choose([cue('cannons', 1)], idle(), MAX_VOICES)).toEqual([]);
    // A quiet gunshot still gets a voice when the loud ones are cannon fire with no room left.
    const mixed = choose([cue('cannons', 1), cue('gunfire', 0.2)], { ...idle(), cannons: BUDGET.cannons.playing }, 0);
    expect(mixed.map((c) => c.category)).toEqual(['gunfire']);
  });
});

describe('war level', () => {
  it('rises with activity, saturates below 1 and dies away', () => {
    const a = new Activity(2, 10);
    expect(a.level).toBe(0);
    for (let i = 0; i < 100; i++) a.add(1);
    expect(a.level).toBeGreaterThan(0.9);
    expect(a.level).toBeLessThan(1);
    for (let i = 0; i < 100; i++) a.update(0.1);
    expect(a.level).toBeLessThan(0.3);
  });
});

describe('sound settings', () => {
  it('reads saved settings, clamping and ignoring garbage', () => {
    expect(parseAudioPrefs(null)).toEqual(defaultAudioPrefs());
    expect(parseAudioPrefs('nonsense')).toEqual(defaultAudioPrefs());
    const p = parseAudioPrefs({ muted: true, volume: 7, focus: -1, mix: { gunfire: 0.2, alerts: 99, bogus: 1, ambience: 'loud' } });
    expect(p.muted).toBe(true);
    expect(p.volume).toBe(1);
    expect(p.focus).toBe(0);
    expect(p.mix.gunfire).toBe(0.2);
    expect(p.mix.alerts).toBe(MIX_MAX);
    expect(p.mix.ambience).toBe(defaultAudioPrefs().mix.ambience);
    expect(Object.keys(p.mix).sort()).toEqual(CATEGORIES.map((c) => c.id).sort());
  });
});
