import { SoundCategory } from './prefs';
import { SoundId } from './synth';

/**
 * The thinking behind the sound, kept free of Web Audio so it can be tested:
 * how loud something is from where the camera is looking, which of a
 * frame's many sounds get a voice, and how busy the war is overall.
 */

/** Where the camera is looking, on the ground. */
export interface Listener {
  x: number;
  z: number;
  /** Ground distance from the view's centre to its corner (CameraRig.viewRadius). */
  radius: number;
  /** The screen's rightward direction on the ground, unit length. */
  rightX: number;
  rightZ: number;
  /** 0 zoomed all the way in, 1 all the way out. */
  zoomOut: number;
}

export interface Placement {
  /** 0 to 1. */
  gain: number;
  /** How much of it goes through the muffled "far away" path, 0 to 1. */
  far: number;
  /** How much of it to send to the outdoor reverb, 0 to 1. */
  wet: number;
  /** Stereo position, -1 left to 1 right. */
  pan: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * How a sound at (x, z) is heard. Distance is measured in view radii, so
 * zooming in narrows what's close and zooming out takes in more of the map.
 * `focus` (0 to 1) sets how fast sound falls away past the edge of the
 * screen: at 0 the whole battle is about equally loud; at 1 what's off
 * screen drops to a murmur.
 */
export function place(x: number, z: number, l: Listener, focus: number): Placement {
  const dx = x - l.x;
  const dz = z - l.z;
  const d = Math.hypot(dx, dz) / Math.max(1, l.radius);
  // Where it starts falling off, in view radii, and how steeply.
  const reach = lerp(8, 0.7, focus);
  const steep = lerp(1.2, 3, focus);
  const gain = 1 / (1 + Math.pow(d / reach, steep));
  // The camera is always some way up, higher the further out it's zoomed, so even what's in
  // the middle of the screen is heard from a distance: somewhat muffled, with the space around it.
  const height = 0.2 + 0.25 * l.zoomOut;
  const far = clamp01(height + (d / reach) * 0.55);
  const wet = clamp01(0.3 + far * 0.55);
  const side = (dx * l.rightX + dz * l.rightZ) / Math.max(1, l.radius);
  // Far things are harder to place, so they pan less.
  const pan = Math.max(-1, Math.min(1, side)) * 0.75 * (1 - far * 0.5);
  return { gain, far, wet, pan };
}

/** A sound that wants a voice this frame. */
export interface Cue {
  sound: SoundId;
  category: SoundCategory;
  gain: number;
  far: number;
  wet: number;
  pan: number;
  /** Playback rate (pitch); 1 is as rendered. */
  rate: number;
}

/** At most this many sounds of a category start in one frame, and play at once. */
export const BUDGET: Record<SoundCategory, { perFrame: number; playing: number }> = {
  gunfire: { perFrame: 3, playing: 10 },
  cannons: { perFrame: 2, playing: 6 },
  explosions: { perFrame: 2, playing: 6 },
  buildings: { perFrame: 1, playing: 3 },
  alerts: { perFrame: 1, playing: 2 },
  ambience: { perFrame: 0, playing: 0 },
};
/** Voices playing at once across everything. */
export const MAX_VOICES = 28;
/** Quieter than this (before the master volume) isn't worth a voice. */
export const INAUDIBLE = 0.02;

/**
 * Which of this frame's cues get a voice: the loudest first, within each
 * category's budget and the overall one. A big battle fires hundreds of shots
 * a second; the ones that don't make it are only heard in the beds (see
 * Activity), which is also how a crowd of distant guns really sounds.
 */
export function choose(cues: readonly Cue[], playing: Record<SoundCategory, number>, total: number): Cue[] {
  const started: Record<string, number> = {};
  const out: Cue[] = [];
  const sorted = cues.filter((c) => c.gain >= INAUDIBLE).sort((a, b) => b.gain - a.gain);
  for (const c of sorted) {
    if (total + out.length >= MAX_VOICES) break;
    const b = BUDGET[c.category];
    const n = started[c.category] ?? 0;
    if (n >= b.perFrame || playing[c.category] + n >= b.playing) continue;
    started[c.category] = n + 1;
    out.push(c);
  }
  return out;
}

/**
 * How busy the war is: a level that every shot and blast anywhere pushes up,
 * and that dies away over a few seconds. The ambient beds (distant gunfire,
 * a rolling rumble) follow it, so a zoomed-out view of a big battle hears a
 * roar rather than a thousand separate shots.
 */
export class Activity {
  private energy = 0;

  constructor(
    /** Seconds for the level to fall by about two thirds. */
    private readonly settle = 2.5,
    /** Energy that reads as "about as busy as it gets". */
    private readonly full = 40,
  ) {}

  add(amount: number): void {
    this.energy += amount;
  }

  update(dt: number): void {
    this.energy *= Math.exp(-dt / this.settle);
  }

  /** 0 (quiet) to 1 (a roar), saturating gently. */
  get level(): number {
    return 1 - Math.exp(-this.energy / this.full);
  }
}
