import { Entity } from '../core/ecs';
import { Armed, Building, Collider, Faction, Health, Mover, Transform, Unit, Wreck } from '../game/components';
import { Game } from '../game/game';
import { CameraRig } from './cameraRig';

/** Size of a scoring cell, world units; a fight is scored over the 3x3 cells round one. */
const CELL = 14;
/** Seconds between scorings. */
const LOOK_EVERY = 1;
/** Seconds for activity to fade to about a third: roughly "the last 10 seconds". */
const MEMORY = 8;
/** Seconds a shot is held before the director will cut to a better fight. */
const HOLD = 14;
/** How much better another fight must score to cut to it. */
const BETTER = 1.8;
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
/** While a shot is held, the camera turns only if the fight's line has swung round more than this (radians). */
const TURN_SLACK = 1.0;
/** Height of the picture at zoom 1, world units (as the rig has it). */
const VIEW_HEIGHT = 70;
/** Room left round a fight's edge, world units, so the outermost units aren't on the frame. */
const MARGIN = 4;
/** While a shot is held, it moves only once the fight's middle has drifted this share of the view from it... */
const DRIFT = 0.35;
/** ...and zooms out only when the fight needs this much more room, or in when it needs this much less. */
const ROOM_OUT = 1.2;
const ROOM_IN = 0.6;
/** Share of each side's fighting units, nearest the other side, that make up its front. */
const FRONT = 0.35;
/** Ground this many units higher or lower across a shot is worth showing side-on, and buildings in it too. */
const RELIEF = 6;
/** How far (radians) the camera will turn away from straight across the fight to show a slope better. */
const SWING = [0, 0.35, -0.35, 0.7, -0.7];

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

/**
 * Where a fight is happening between two sides: the middle of the gap
 * between their fronts, each front being the FRONT share of a side's units
 * nearest the other side. That's where the shots and blows cross, rather
 * than the middle of either army.
 */
export function between(a: readonly { x: number; z: number }[], b: readonly { x: number; z: number }[]): { x: number; z: number } {
  const mid = (list: readonly { x: number; z: number }[]) => ({
    x: list.reduce((s, p) => s + p.x, 0) / list.length,
    z: list.reduce((s, p) => s + p.z, 0) / list.length,
  });
  const front = (own: readonly { x: number; z: number }[], toward: { x: number; z: number }) => {
    const near = [...own].sort((p, q) => Math.hypot(p.x - toward.x, p.z - toward.z) - Math.hypot(q.x - toward.x, q.z - toward.z));
    return mid(near.slice(0, Math.max(1, Math.ceil(near.length * FRONT))));
  };
  const fa = front(a, mid(b));
  const fb = front(b, mid(a));
  return { x: (fa.x + fb.x) / 2, z: (fa.z + fb.z) / 2 };
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
 * Each shot centres on the gap between the two sides' fronts, where the
 * fighting is, with both armies in the picture, one to the left and one to
 * the right. It's composed once, when the director cuts to it: the angle
 * that shows the slopes and buildings in the fight side-on without them
 * hiding it, tilted lower where there's high ground to show and the closer
 * it is. It then holds still, moving, zooming or turning only when the
 * fight clearly outgrows it. The rig glides between shots, never cutting.
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
  /** The picture's width over its height, as the rig last had it. */
  private aspect = 1.6;
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
   * Frame the fight round (x, z). The shot centres on the gap between the
   * two biggest sides' fronts (see between), zoomed out far enough to keep
   * both armies on screen, and looks across the line between them so one
   * army is on the left and the other on the right.
   *
   * On a cut it composes the shot afresh: the angle that best shows the
   * slopes and buildings in the fight side-on, without them hiding it (see
   * compose), and a lower tilt where there's high ground or buildings to
   * show. Then it holds still: while the shot lasts it moves only if the
   * fight drifts well off centre, zooms only if the fight outgrows the
   * picture or shrinks well inside it, and turns only if the line between
   * the sides swings right round.
   */
  private frame(x: number, z: number, cut: boolean): void {
    const { world } = this.game;
    const now = world.time;
    const cast: Entity[] = [];
    const all: { x: number; z: number }[] = [];
    const bySide = new Map<number, { x: number; z: number }[]>();
    for (const e of world.query(Unit, Transform, Faction)) {
      if (world.has(e, Wreck)) continue;
      const t = world.get(e, Transform)!;
      if (Math.abs(t.x - x) > REACH || Math.abs(t.z - z) > REACH || (t.x - x) ** 2 + (t.z - z) ** 2 > REACH * REACH) continue;
      const h = world.get(e, Health);
      const a = world.get(e, Armed);
      const fighting = (h && now - h.hurtAt < ENGAGED) || (a && a.target !== null && now - a.firedAt < ENGAGED);
      if (!fighting) continue;
      cast.push(e);
      const p = { x: t.x, z: t.z };
      all.push(p);
      const f = world.get(e, Faction)!.id;
      const list = bySide.get(f) ?? [];
      list.push(p);
      bySide.set(f, list);
    }
    this.cast = cast;
    const sides = [...bySide.values()].sort((a, b) => b.length - a.length);
    let focus = { x, z };
    if (sides.length >= 2) focus = between(sides[0], sides[1]);
    else if (all.length > 0) focus = { x: all.reduce((s, p) => s + p.x, 0) / all.length, z: all.reduce((s, p) => s + p.z, 0) / all.length };
    // Room for (nearly) all of both armies round the gap between them.
    const shot = this.shot;
    const dists = all.map((p) => Math.hypot(p.x - focus.x, p.z - focus.z)).sort((a, b) => a - b);
    const spread = (dists.length ? dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.9))] : 10) * 1.1;
    const fit = this.fitZoom(all, focus, sides, shot?.azimuth ?? Math.PI / 4);

    if (cut || !shot) {
      this.shot = this.compose(focus.x, focus.z, fit, spread, sides, shot?.azimuth ?? Math.PI / 4);
      return;
    }
    // Held: stay put unless the fight has clearly moved, grown or shrunk, or turned.
    // Half the picture's width, in ground units.
    const view = (0.5 * VIEW_HEIGHT * this.aspect) / shot.zoom;
    let { x: sx, z: sz, zoom, azimuth, elevation } = shot;
    if (Math.hypot(focus.x - sx, focus.z - sz) > view * DRIFT) {
      sx = focus.x;
      sz = focus.z;
    }
    const need = (0.5 * VIEW_HEIGHT * this.aspect) / fit;
    if (need > view * ROOM_OUT || need < view * ROOM_IN) zoom = fit;
    if (sides.length >= 2) {
      const [one, two] = sides.map((list) => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, z: list.reduce((s, p) => s + p.z, 0) / list.length }));
      const across = acrossAzimuth(one.x, one.z, two.x, two.z, shot.azimuth)[0];
      if (turnBetween(shot.azimuth, across) > TURN_SLACK) {
        this.shot = this.compose(sx, sz, zoom, spread, sides, shot.azimuth);
        return;
      }
    }
    if (zoom !== shot.zoom && elevation > tiltFor(zoom) + 0.05) elevation = tiltFor(zoom);
    this.shot = { x: sx, z: sz, azimuth, elevation, zoom };
  }

  /**
   * The closest zoom that keeps (nearly) all of the fight on screen, looking
   * across the line between the two biggest sides: they spread along the
   * screen's width, and the low tilt stretches the screen's height over a
   * lot of ground, so it's the width that sets how close the camera comes.
   * The odd straggler (the farthest tenth each way) may fall off the edge.
   */
  private fitZoom(all: { x: number; z: number }[], focus: { x: number; z: number }, sides: { x: number; z: number }[][], was: number): number {
    if (all.length === 0) return zoomFor(10, VIEW_HEIGHT);
    let az = was;
    if (sides.length >= 2) {
      const [one, two] = sides.slice(0, 2).map((list) => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, z: list.reduce((s, p) => s + p.z, 0) / list.length }));
      az = acrossAzimuth(one.x, one.z, two.x, two.z, was)[0];
    }
    // Screen-right and screen-up on the ground, as the rig sees them.
    const rx = Math.sin(az);
    const rz = -Math.cos(az);
    const across = all.map((p) => Math.abs((p.x - focus.x) * rx + (p.z - focus.z) * rz)).sort((a, b) => a - b);
    const deep = all.map((p) => Math.abs((p.x - focus.x) * rz - (p.z - focus.z) * rx)).sort((a, b) => a - b);
    const at = Math.min(all.length - 1, Math.floor(all.length * 0.9));
    const halfWidth = across[at] * 1.15 + MARGIN;
    const halfDepth = deep[at] * 1.15 + MARGIN;
    const byWidth = (0.5 * VIEW_HEIGHT * this.aspect) / halfWidth;
    let zoom = Math.max(WIDE, Math.min(CLOSE, byWidth));
    // Screen-up covers 1/sin(tilt) as much ground; make sure it reaches too.
    const byDepth = (0.5 * VIEW_HEIGHT) / (halfDepth * Math.sin(tiltFor(zoom)));
    zoom = Math.max(WIDE, Math.min(zoom, byDepth));
    return zoom;
  }

  /**
   * Pick the angle and tilt for a shot of the fight at (x, z): across the
   * line between the two biggest sides, swung a little either way (SWING)
   * if that shows the ground's rise and fall better, and never from where
   * the hills or buildings hide the middle. With high ground or buildings
   * in the fight the camera comes down lower, so a hill the fight is
   * running up stands out in profile rather than being flattened.
   */
  private compose(x: number, z: number, zoom: number, spread: number, sides: { x: number; z: number }[][], was: number): Shot {
    const field = this.game.field;
    const reach = Math.max(8, spread);
    // How much the ground rises and falls, and how many buildings stand, in the fight.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const h = field.heightAt(x + (i / 3) * reach, z + (j / 3) * reach);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    }
    let buildings = 0;
    const { world } = this.game;
    for (const e of world.query(Building, Transform)) {
      const t = world.get(e, Transform)!;
      if (Math.hypot(t.x - x, t.z - z) < reach) buildings++;
    }
    const relief = Math.min(1, (hi - lo) / RELIEF + Math.min(0.6, buildings * 0.15));
    const flat = tiltFor(zoom);
    let tilt = Math.max(LOW_TILT * 0.85, flat - 0.4 * relief);

    let bases: number[];
    if (sides.length >= 2) {
      const [one, two] = sides.map((list) => ({ x: list.reduce((s, p) => s + p.x, 0) / list.length, z: list.reduce((s, p) => s + p.z, 0) / list.length }));
      bases = acrossAzimuth(one.x, one.z, two.x, two.z, was);
    } else bases = [was, was + Math.PI];
    // Each candidate: how much the ground rises and falls across the picture (left to right, where it
    // shows as a skyline), less a little for swinging away from straight across, and a little for turning far.
    const score = (az: number, swing: number) => {
      const hx = -Math.sin(az);
      const hz = Math.cos(az);
      let min = Infinity;
      let max = -Infinity;
      for (let k = -4; k <= 4; k++) {
        const h = field.heightAt(x + hx * (k / 4) * reach, z + hz * (k / 4) * reach);
        min = Math.min(min, h);
        max = Math.max(max, h);
      }
      return max - min - Math.abs(swing) * 2 - turnBetween(was, az) * 0.6;
    };
    for (let tries = 0; tries < 5; tries++) {
      let best: number | null = null;
      let bestScore = -Infinity;
      for (const base of bases) {
        for (const swing of SWING) {
          const az = base + swing;
          if (this.blocked(x, z, az, tilt, zoom)) continue;
          const sc = score(az, swing);
          if (sc > bestScore) {
            bestScore = sc;
            best = az;
          }
        }
      }
      if (best !== null) return { x, z, azimuth: best, elevation: tilt, zoom };
      // Everything's hidden from this low: come up higher and try again.
      tilt = Math.min(HIGH_TILT, tilt + 0.15);
    }
    return { x, z, azimuth: bases[0], elevation: Math.max(tilt, flat), zoom };
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
    this.aspect = rig.shape;
    const far = Math.hypot(s.x - rig.target.x, s.z - rig.target.z) > rig.viewRadius * 0.9;
    const zoom = far ? Math.min(s.zoom, WIDE) : s.zoom;
    rig.setView(s.azimuth, far ? Math.max(s.elevation, tiltFor(zoom)) : s.elevation, zoom);
    rig.glideTo(s.x, s.z, frameSeconds, GLIDE);
  }
}

/** Seconds the unit camera lingers on a unit's wreck before moving to another. */
const MOURN = 3;
/** Units ahead of a unit going nowhere that the camera looks at. */
const LEAD = 6;
/** How far toward what the unit is doing the picture's middle sits (0 on the unit, 1 on the thing). */
const TOWARD = 0.6;
/** Furthest the unit sits from the middle, as a share of the way to the picture's edge: on screen, toward the bottom. */
const OFF_CENTRE = 0.55;
/** Zoom range for the unit camera: close on a unit at work nearby, a bit wider when its target is a way off. */
const UNIT_CLOSE = 3.4;
const UNIT_WIDE = 2;
/** The unit camera's tilt above the horizon. */
const UNIT_TILT = 0.42;
/** Beyond this, what the unit is doing is too far off to fit in: the camera stays close and just looks that way. */
const UNIT_REACH = 30;
/** How far the camera stands off to one side of the line from the unit to what it's doing (radians), so the unit isn't hidden behind itself. */
const SIDE_ON = 0.35;
/** Turns of the line to what the unit is doing smaller than this (radians) don't move the camera. */
const UNIT_SLACK = 0.3;
/** A goal nearer than this doesn't count: the unit has as good as arrived. */
const ARRIVED = 3;

/**
 * The unit camera: rides with one unit, looking at what it's doing. The
 * middle of the picture sits between the unit and what it's shooting at
 * (or, when it isn't shooting, where it's headed), nearer the thing, with
 * the unit on screen toward one side and the camera behind it, so you look
 * over its shoulder at its fight. It zooms out a little when its target is
 * a way off, but stays close for a far goal. It follows the selected unit, or picks a strong one in the
 * director's fight. When its unit dies it holds on the wreck for MOURN
 * seconds, then moves to another unit nearby.
 */
export class UnitCam {
  unit: Entity | null = null;
  /**
   * Where a unit is headed, from the sim worker (see RemoteSim.goal); null
   * when the battle runs on the page, and the unit's own Mover says.
   */
  goalSource: ((e: Entity | null) => { x: number; z: number } | null) | null = null;
  private lostFor = 0;
  private last: { x: number; z: number; heading: number } | null = null;
  /** The way the camera looks now, and how far it zooms (kept steady while what the unit does barely moves). */
  private look: { azimuth: number; zoom: number } | null = null;

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

  /** Stop asking the sim where the unit is headed (the camera's off). */
  stop(): void {
    this.goalSource?.(null);
    this.look = null;
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

  /** What the unit is doing, as a place: what it's shooting at, else where it's headed, else just ahead of it. */
  private doing(e: Entity, at: { x: number; z: number; heading: number }): { x: number; z: number } {
    const { world } = this.game;
    const target = world.get(e, Armed)?.target ?? null;
    if (target !== null && world.isAlive(target)) {
      const t = world.get(target, Transform);
      if (t) return { x: t.x, z: t.z };
    }
    const goal = this.goalSource ? this.goalSource(e) : (() => {
      const m = world.get(e, Mover);
      return m && m.targetX !== null && m.targetZ !== null ? { x: m.targetX, z: m.targetZ } : null;
    })();
    if (goal && Math.hypot(goal.x - at.x, goal.z - at.z) > ARRIVED) return goal;
    return { x: at.x + Math.cos(at.heading) * LEAD, z: at.z - Math.sin(at.heading) * LEAD };
  }

  /**
   * Move the rig to look over the unit's shoulder at what it's doing.
   * `alpha` is how far between sim ticks the picture is, so the camera
   * moves with the drawn unit. Returns false when it has no unit and none
   * to pick.
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
    let thing: { x: number; z: number } | null = null;
    if (this.fit(this.unit)) {
      const t = world.get(this.unit, Transform)!;
      let dh = t.heading - t.pheading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      this.last = { x: t.px + (t.x - t.px) * alpha, z: t.pz + (t.z - t.pz) * alpha, heading: t.pheading + dh * alpha };
      thing = this.doing(this.unit, this.last);
    }
    const at = this.last;
    if (!at) return false;
    rig.gentle = true;
    if (!thing) {
      // Its wreck: hold where it fell.
      if (this.look) rig.setView(this.look.azimuth, UNIT_TILT, this.look.zoom);
      rig.glideTo(at.x, at.z, frameSeconds, 0.8);
      return true;
    }
    const dx = thing.x - at.x;
    const dz = thing.z - at.z;
    const d = Math.hypot(dx, dz);
    // Looking from behind the unit toward the thing, a little off to one side.
    const facing = d > 0.5 ? Math.atan2(-dz, dx) : at.heading;
    const azimuth = Math.PI - facing + SIDE_ON;
    // The line to the thing runs up the screen, and the tilt stretches the
    // screen's height over ground, so fit the unit and the thing in that
    // way; a far goal doesn't pull the camera out, it just sets the way to look.
    const sinTilt = Math.sin(UNIT_TILT);
    const zoom = Math.max(UNIT_WIDE, Math.min(UNIT_CLOSE, (0.5 * VIEW_HEIGHT) / ((Math.min(d, UNIT_REACH) * 0.7 + 8) * sinTilt)));
    if (!this.look || turnBetween(this.look.azimuth, azimuth) > UNIT_SLACK || Math.abs(this.look.zoom - zoom) > 0.35) this.look = { azimuth, zoom };
    // The middle sits most of the way to the thing, but never so far that the unit leaves the picture.
    const halfDepth = (0.5 * VIEW_HEIGHT) / (this.look.zoom * sinTilt);
    const off = Math.min(d * TOWARD, halfDepth * OFF_CENTRE);
    const k = d > 0 ? off / d : 0;
    rig.setView(this.look.azimuth, UNIT_TILT, this.look.zoom);
    rig.glideTo(at.x + dx * k, at.z + dz * k, frameSeconds, 0.6);
    return true;
  }
}
