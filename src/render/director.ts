import { Entity } from '../core/ecs';
import { Armed, Building, Collider, Faction, Health, Transform, Unit, Wreck } from '../game/components';
import { Game } from '../game/game';
import { CameraRig } from './cameraRig';

/** Size of a scoring cell, world units; a fight is scored over the 3x3 cells round one. */
const CELL = 14;
/** Seconds between scorings. */
const LOOK_EVERY = 1;
/** Seconds for activity to fade to about a third: roughly "the last 10 seconds". */
const MEMORY = 8;
/** Seconds a shot is held before the director will cut to a better fight. */
const HOLD = 7;
/** How much better another fight must score to cut to it. */
const BETTER = 1.5;
/** A big event (a super unit arriving or dying, an HQ falling) can cut in once a shot is this old. */
const EARLY_CUT = 2.5;
/** Below this score nothing is worth a shot. */
const DULL = 1.5;
/** How far round a shot's centre units count as in its fight. */
const REACH = 22;
/** Seconds since a unit was hurt or fired for it to count as fighting. */
const ENGAGED = 5;
/** Zoom range for shots: wide for a sprawling battle, close for a duel. */
const WIDE = 0.85;
const CLOSE = 2.6;
/** Tilt above the horizon: more top-down when wide, lower and side-on when close. */
const HIGH_TILT = 0.95;
const LOW_TILT = 0.42;
/** Seconds the camera takes to get most of the way to a new shot's centre. */
const GLIDE = 2.2;
/** Turns smaller than this (radians) aren't worth making while a shot is held. */
const TURN_SLACK = 0.45;

/** How much each event says "this fight is worth watching". */
const ACTIVITY = { impact: 1, unitDestroyed: 6, buildingDamaged: 2, buildingDestroyed: 12 };

export interface Shot {
  x: number;
  z: number;
  azimuth: number;
  elevation: number;
  zoom: number;
}

/** Elevation for a zoom: lower when close in, higher when wide. */
export function tiltFor(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - WIDE) / (CLOSE - WIDE)));
  return HIGH_TILT + (LOW_TILT - HIGH_TILT) * t;
}

/** Zoom that fits a fight `spread` units across (radius) on screen, given the rig shows `viewHeight` units at zoom 1. */
export function zoomFor(spread: number, viewHeight: number): number {
  return Math.max(WIDE, Math.min(CLOSE, viewHeight / (2.8 * Math.max(5, spread))));
}

/** How even a fight is, 0 (a rout, or one side alone) to 1 (dead even). */
export function evenness(a: number, b: number): number {
  return a + b > 0 ? 1 - Math.abs(a - b) / (a + b) : 0;
}

/** The camera direction at right angles to the line from one side's centre to the other's, nearest to `near`. */
export function acrossAzimuth(ax: number, az: number, bx: number, bz: number, near: number): [number, number] {
  const line = Math.atan2(bz - az, bx - ax);
  const one = line + Math.PI / 2;
  const two = line - Math.PI / 2;
  return turnBetween(near, one) <= turnBetween(near, two) ? [one, two] : [two, one];
}

function turnBetween(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * The director camera: watches the whole battle and picks the fight most
 * worth watching, the way a sports broadcast would. Every second it scores
 * each patch of the map by how much is happening there (hits, kills,
 * buildings under fire), how even the fight is (an even fight beats a rout)
 * and whether super units are in it. It holds a shot for at least HOLD
 * seconds and cuts only to a fight that scores BETTER times as much, unless
 * a big event (a super unit arriving or dying, an HQ falling) happens.
 *
 * Each shot is framed to fit the units fighting in it, turned so the fight
 * runs across the screen (the camera looks along the front, not down it),
 * from whichever side the hills and buildings don't hide, and tilted lower
 * the closer it is. The rig glides between shots, never cutting.
 *
 * Reads events and the page's copy of the world only, so it can't affect the battle.
 */
export class Director {
  private readonly cols: number;
  private readonly rows: number;
  private readonly activity: Float32Array;
  private readonly supers: Uint16Array;
  /** Units per cell for each side seen, rebuilt each scoring. */
  private sides = new Map<number, Uint16Array>();
  private sinceLook = LOOK_EVERY;
  /** Seconds the current shot has been held. */
  held = 0;
  /** The shot being shown, or null before the first fight. */
  shot: Shot | null = null;
  /** Score of the fight being shown at the last look. */
  score = 0;
  /** A big event the director may cut to early. */
  private cue: { x: number; z: number } | null = null;
  /** Units fighting in the current shot, for the unit camera to pick from. */
  cast: Entity[] = [];

  constructor(private readonly game: Game) {
    const b = game.field.bounds;
    this.cols = Math.max(1, Math.ceil((b.maxX - b.minX) / CELL));
    this.rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / CELL));
    this.activity = new Float32Array(this.cols * this.rows);
    this.supers = new Uint16Array(this.cols * this.rows);
    const { events } = game;
    for (const kind of Object.keys(ACTIVITY) as (keyof typeof ACTIVITY)[]) {
      events.on(kind, (e) => this.add(e.x, e.z, ACTIVITY[kind]));
    }
    events.on('unitDestroyed', (e) => {
      if (e.def.category === 'super') this.cue = { x: e.x, z: e.z };
    });
    events.on('buildingDestroyed', (e) => {
      if (e.def.id === 'hq') this.cue = { x: e.x, z: e.z };
    });
    events.on('spawned', (e) => {
      if (e.def.category !== 'super') return;
      const t = game.world.get(e.entity, Transform);
      if (t) this.cue = { x: t.x, z: t.z };
    });
  }

  private cellAt(x: number, z: number): number {
    const b = this.game.field.bounds;
    const c = Math.floor((x - b.minX) / CELL);
    const r = Math.floor((z - b.minZ) / CELL);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  private add(x: number, z: number, amount: number): void {
    const i = this.cellAt(x, z);
    if (i >= 0) this.activity[i] += amount;
  }

  /** Advance by `dt` seconds of sim time: fade old activity and, once a second, pick and frame the shot. */
  update(dt: number): void {
    if (dt <= 0) return;
    this.held += dt;
    this.sinceLook += dt;
    if (this.sinceLook < LOOK_EVERY) return;
    const fade = Math.exp(-this.sinceLook / MEMORY);
    this.sinceLook = 0;
    for (let i = 0; i < this.activity.length; i++) this.activity[i] *= fade;
    this.census();

    // The fight being shown scores as its best cell near the shot; the
    // others compete only from beyond it, so the director doesn't "cut" to
    // the far end of the same fight.
    let best = -1;
    let bestScore = 0;
    this.score = 0;
    for (let i = 0; i < this.activity.length; i++) {
      const s = this.scoreAt(i);
      if (s <= 0) continue;
      const c = this.centreOf(i);
      if (this.shot && Math.hypot(c.x - this.shot.x, c.z - this.shot.z) < REACH) this.score = Math.max(this.score, s);
      else if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    let cutTo: { x: number; z: number } | null = null;
    if (this.cue && (this.held >= EARLY_CUT || !this.shot)) cutTo = this.cue;
    else if (best >= 0 && bestScore >= DULL) {
      const over = this.score < DULL * 0.5;
      if (!this.shot || (this.held >= HOLD && bestScore > this.score * BETTER) || (over && this.held >= EARLY_CUT)) cutTo = this.centreOf(best);
    }
    this.cue = null;
    if (cutTo) {
      this.frame(cutTo.x, cutTo.z, true);
      this.held = 0;
    } else if (this.shot) this.frame(this.shot.x, this.shot.z, false);
  }

  /** Count each side's units and the super units in each cell. */
  private census(): void {
    const { world } = this.game;
    this.supers.fill(0);
    for (const counts of this.sides.values()) counts.fill(0);
    for (const e of world.query(Unit, Transform, Faction)) {
      if (world.has(e, Wreck)) continue;
      const t = world.get(e, Transform)!;
      const i = this.cellAt(t.x, t.z);
      if (i < 0) continue;
      const f = world.get(e, Faction)!.id;
      let counts = this.sides.get(f);
      if (!counts) {
        counts = new Uint16Array(this.activity.length);
        this.sides.set(f, counts);
      }
      counts[i]++;
      if (world.get(e, Unit)!.def.category === 'super') this.supers[i]++;
    }
  }

  /** How worth watching the fight round cell `i` is. */
  private scoreAt(i: number): number {
    const c0 = i % this.cols;
    const r0 = Math.floor(i / this.cols);
    let act = 0;
    let sup = 0;
    const near: number[] = [];
    for (const counts of this.sides.values()) {
      let n = 0;
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        for (let c = c0 - 1; c <= c0 + 1; c++) {
          if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) n += counts[r * this.cols + c];
        }
      }
      if (n > 0) near.push(n);
    }
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      for (let c = c0 - 1; c <= c0 + 1; c++) {
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
        const j = r * this.cols + c;
        // The centre cell counts for more, so the shot sits on the fight rather than beside it.
        act += this.activity[j] * (j === i ? 1.5 : 1);
        sup += this.supers[j];
      }
    }
    if (act <= 0) return 0;
    near.sort((a, b) => b - a);
    const even = near.length >= 2 ? evenness(near[0], near[1]) : 0;
    return act * (0.4 + 0.6 * even) + (sup > 0 ? 10 * Math.min(sup, 3) : 0);
  }

  private centreOf(i: number): { x: number; z: number } {
    const b = this.game.field.bounds;
    return { x: b.minX + ((i % this.cols) + 0.5) * CELL, z: b.minZ + (Math.floor(i / this.cols) + 0.5) * CELL };
  }

  /**
   * Frame the fight round (x, z): centre on the units fighting there, zoom
   * to fit them, and turn across the line between the two biggest sides in
   * it. A held shot turns only for a clear change, so it doesn't wander.
   */
  private frame(x: number, z: number, cut: boolean): void {
    const { world } = this.game;
    const now = world.time;
    const cast: Entity[] = [];
    const px: number[] = [];
    const pz: number[] = [];
    const bySide = new Map<number, { x: number; z: number; n: number }>();
    for (const e of world.query(Unit, Transform, Faction)) {
      if (world.has(e, Wreck)) continue;
      const t = world.get(e, Transform)!;
      if (Math.abs(t.x - x) > REACH || Math.abs(t.z - z) > REACH || (t.x - x) ** 2 + (t.z - z) ** 2 > REACH * REACH) continue;
      const h = world.get(e, Health);
      const a = world.get(e, Armed);
      const fighting = (h && now - h.hurtAt < ENGAGED) || (a && a.target !== null && now - a.firedAt < ENGAGED);
      if (!fighting) continue;
      cast.push(e);
      px.push(t.x);
      pz.push(t.z);
      const f = world.get(e, Faction)!.id;
      const s = bySide.get(f) ?? { x: 0, z: 0, n: 0 };
      s.x += t.x;
      s.z += t.z;
      s.n++;
      bySide.set(f, s);
    }
    this.cast = cast;
    let cx = x;
    let cz = z;
    if (cast.length > 0) {
      cx = px.reduce((s, v) => s + v, 0) / px.length;
      cz = pz.reduce((s, v) => s + v, 0) / pz.length;
    }
    const dists = px.map((v, i) => Math.hypot(v - cx, pz[i] - cz)).sort((a, b) => a - b);
    const spread = dists.length ? dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.85))] : 10;
    const zoom = zoomFor(spread, 70);
    const elevation = tiltFor(zoom);

    const was = this.shot?.azimuth ?? Math.PI / 4;
    let azimuth = was;
    const sides = [...bySide.values()].sort((a, b) => b.n - a.n);
    if (sides.length >= 2) {
      const [a, b] = sides;
      const options = acrossAzimuth(a.x / a.n, a.z / a.n, b.x / b.n, b.z / b.n, was);
      // The nearer way round unless the hills or buildings hide it.
      const pick = this.blocked(cx, cz, options[0], elevation, zoom) && !this.blocked(cx, cz, options[1], elevation, zoom) ? options[1] : options[0];
      if (cut || turnBetween(was, pick) > TURN_SLACK) azimuth = pick;
    } else if (cut && this.blocked(cx, cz, was, elevation, zoom)) {
      for (const turn of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
        if (!this.blocked(cx, cz, was + turn, elevation, zoom)) {
          azimuth = was + turn;
          break;
        }
      }
    }
    this.shot = { x: cx, z: cz, azimuth, elevation, zoom };
  }

  /**
   * Whether the ground or a building would hide (x, z) from a camera looking
   * from `azimuth` at `elevation`: step along the sight line from the target
   * back toward the camera, as far as the view reaches, and see if anything
   * rises above it.
   */
  blocked(x: number, z: number, azimuth: number, elevation: number, zoom: number): boolean {
    const field = this.game.field;
    const y0 = field.surfaceAt(x, z) + 1;
    const ca = Math.cos(azimuth);
    const sa = Math.sin(azimuth);
    const rise = Math.tan(elevation);
    const reach = 35 / zoom / Math.sin(elevation);
    for (let s = 2; s <= reach; s += 1.5) {
      const sx = x + ca * s;
      const sz = z + sa * s;
      if (field.heightAt(sx, sz) > y0 + s * rise) return true;
    }
    const { world } = this.game;
    for (const e of world.query(Building, Transform, Collider)) {
      const t = world.get(e, Transform)!;
      const r = world.get(e, Collider)!.radius;
      const along = (t.x - x) * ca + (t.z - z) * sa;
      if (along < 1 || along > reach) continue;
      const off = Math.abs(-(t.x - x) * sa + (t.z - z) * ca);
      if (off > r) continue;
      // Buildings are roughly as tall as they are wide.
      if (field.surfaceAt(t.x, t.z) + r * 1.4 > y0 + along * rise) return true;
    }
    return false;
  }

  /**
   * Move the rig toward the shot, gently. A far jump glides at height: the
   * camera zooms out while it travels and back in when it arrives, so the
   * picture never cuts or flashes.
   */
  drive(rig: CameraRig, frameSeconds: number): void {
    const s = this.shot;
    if (!s) return;
    rig.gentle = true;
    const far = Math.hypot(s.x - rig.target.x, s.z - rig.target.z) > rig.viewRadius * 0.9;
    const zoom = far ? Math.min(s.zoom, WIDE) : s.zoom;
    rig.setView(s.azimuth, far ? Math.max(s.elevation, tiltFor(zoom)) : s.elevation, zoom);
    rig.glideTo(s.x, s.z, frameSeconds, GLIDE);
  }
}

/** Seconds the unit camera lingers on a unit's wreck before moving to another. */
const MOURN = 3;
/** Units ahead of the unit the camera looks at, so the unit sits low on screen with what it faces above. */
const LEAD = 4;

/**
 * The unit camera: rides close behind one unit, turning as it turns. It
 * follows the selected unit, or picks a strong one in the director's fight.
 * When its unit dies it holds on the wreck for MOURN seconds, then moves to
 * another unit nearby.
 */
export class UnitCam {
  unit: Entity | null = null;
  private lostFor = 0;
  private last: { x: number; z: number; heading: number } | null = null;

  constructor(private readonly game: Game) {}

  /** Whether `e` is a unit worth riding with: alive, not a wreck. */
  private fit(e: Entity | null): e is Entity {
    const { world } = this.game;
    return e !== null && world.isAlive(e) && world.has(e, Unit) && world.has(e, Transform) && !world.has(e, Wreck);
  }

  /** Ride with `e` (the player picked it). */
  follow(e: Entity | null): void {
    if (this.fit(e)) {
      this.unit = e;
      this.lostFor = 0;
    }
  }

  /** The strongest unit near (x, z), preferring ones in the fight. */
  pick(near: { x: number; z: number } | null, cast: Entity[]): Entity | null {
    const { world } = this.game;
    let best: Entity | null = null;
    let bestValue = -Infinity;
    const pool = cast.filter((e) => this.fit(e));
    const from = pool.length ? pool : [...world.query(Unit, Transform, Faction)].filter((e) => this.fit(e) && world.get(e, Faction)!.id >= 0);
    for (const e of from) {
      const def = world.get(e, Unit)!.def;
      if (def.category === 'air') continue;
      const t = world.get(e, Transform)!;
      const d = near ? Math.hypot(t.x - near.x, t.z - near.z) : 0;
      const value = def.hp * (def.category === 'super' ? 1.5 : 1) - d * 20;
      if (value > bestValue) {
        bestValue = value;
        best = e;
      }
    }
    return best;
  }

  /**
   * Move the rig behind the unit. `alpha` is how far between sim ticks the
   * picture is, so the camera moves with the drawn unit. Returns false when
   * it has no unit and none to pick.
   */
  drive(rig: CameraRig, frameSeconds: number, simSeconds: number, alpha: number, director: Director): boolean {
    const { world } = this.game;
    if (!this.fit(this.unit)) {
      this.lostFor += simSeconds;
      if (this.lostFor >= MOURN || !this.last) {
        this.unit = this.pick(this.last ?? director.shot, this.last ? [] : director.cast);
        this.lostFor = 0;
      }
    }
    if (this.fit(this.unit)) {
      const t = world.get(this.unit, Transform)!;
      let dh = t.heading - t.pheading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.last = { x: t.px + (t.x - t.px) * alpha, z: t.pz + (t.z - t.pz) * alpha, heading: t.pheading + dh * alpha };
    }
    const at = this.last;
    if (!at) return false;
    rig.gentle = true;
    rig.setView(Math.PI - at.heading, 0.4, 3.4);
    const ahead = this.fit(this.unit) ? LEAD : 0;
    rig.glideTo(at.x + Math.cos(at.heading) * ahead, at.z - Math.sin(at.heading) * ahead, frameSeconds, 0.35);
    return true;
  }
}
