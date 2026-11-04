import { hashSeed, Rng } from '../core/rng';
import { battlefieldConfig, BattleSettings, MapSpot } from '../game/settings';
import { Battlefield, generateBattlefield, OUTPOST_RADIUS } from '../world/battlefield';
import { groundPicture } from '../world/mapPicture';
import { el, hex } from './dom';

export type PlaceKind = 'bases' | 'towns' | 'outposts';

interface Marker {
  kind: PlaceKind;
  /** Side index for bases, else the town's or outpost's index. */
  index: number;
  x: number;
  z: number;
  radius: number;
  color: string;
}

/** Pixels per map cell in the preview image. */
const PX = 3;

/**
 * A top-down map of the battle the current settings make, with its bases,
 * towns and outposts, which can be dragged to new spots. Dropping one fixes
 * where every one of its kind goes (see Placements in settings.ts); the map
 * is generated again to show what that does to the ground round them.
 */
export class MapPreview {
  readonly root = el('div', { class: 'map-preview' });
  private readonly canvas = el('canvas', { 'aria-label': 'Map preview: drag bases, towns and outposts to place them' }) as HTMLCanvasElement;
  private readonly note = el('p', { class: 'hint' });
  private readonly ground = document.createElement('canvas');
  private field: Battlefield | null = null;
  private markers: Marker[] = [];
  private drag: Marker | null = null;
  /** Where the dragged marker started, to put it back if it's dropped on another. */
  private from = { x: 0, z: 0 };
  private timer: number | undefined;
  private settings: BattleSettings | null = null;

  constructor(private readonly onPlace: (kind: PlaceKind, spots: MapSpot[]) => void) {
    this.root.append(this.canvas, this.note);
    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.canvas.addEventListener('pointercancel', () => {
      this.drag = null;
      this.draw();
    });
  }

  /** Show the map for these settings (soon: generating a map takes a moment, so quick changes are batched). */
  update(settings: BattleSettings): void {
    this.settings = settings;
    if (this.drag) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.generate(), 150);
  }

  private generate(): void {
    const s = this.settings;
    if (!s || !this.root.isConnected || this.root.closest('details:not([open])')) return;
    const seed = s.seed || 'preview';
    const field = generateBattlefield(new Rng(hashSeed(seed)).fork(1), battlefieldConfig(s));
    this.field = field;
    this.note.textContent = s.seed
      ? `The map for seed “${s.seed}”. Drag the bases, towns and outposts to place them; the ground changes round where they go.`
      : 'With no seed, every battle gets a new map; this is one of them. Where you place things still applies.';
    this.paintGround(field);
    const sideColor = (f: number) => hex(s.factions[f]?.color ?? 0xffffff);
    this.markers = [
      ...field.baseSites.map((b) => ({ kind: 'bases' as const, index: b.faction, x: b.x, z: b.z, radius: b.radius, color: sideColor(b.faction) })),
      ...field.townSites.map((t, i) => ({ kind: 'towns' as const, index: i, x: t.x, z: t.z, radius: t.radius, color: '#d8d2c4' })),
      ...field.outpostSites.map((o, i) => ({ kind: 'outposts' as const, index: i, x: o.x, z: o.z, radius: OUTPOST_RADIUS, color: '#e8d27a' })),
    ];
    this.draw();
  }

  /** The ground as an image (see groundPicture). */
  private paintGround(field: Battlefield): void {
    const picture = groundPicture(field);
    this.ground.width = picture.width;
    this.ground.height = picture.height;
    const g = this.ground.getContext('2d')!;
    const image = g.createImageData(picture.width, picture.height);
    image.data.set(picture.data);
    g.putImageData(image, 0, 0);
  }

  private draw(): void {
    const field = this.field;
    if (!field) return;
    const { cols, rows, cellSize } = field.config;
    this.canvas.width = cols * PX;
    this.canvas.height = rows * PX;
    const c = this.canvas.getContext('2d')!;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.ground, 0, 0, cols * PX, rows * PX);
    const scale = PX / cellSize;
    for (const m of this.markers) {
      const px = (m.x - field.bounds.minX) * scale;
      const pz = (m.z - field.bounds.minZ) * scale;
      c.beginPath();
      c.arc(px, pz, m.radius * scale, 0, Math.PI * 2);
      c.fillStyle = m.color + (m.kind === 'bases' ? '88' : '66');
      c.fill();
      c.lineWidth = m === this.drag ? 3 : 1.5;
      c.strokeStyle = m === this.drag ? '#ffffff' : '#1a1d24';
      c.stroke();
      c.fillStyle = '#1a1d24';
      c.font = `bold ${Math.round(PX * 4)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(m.kind === 'bases' ? String(m.index + 1) : m.kind === 'towns' ? 'T' : '★', px, pz);
    }
  }

  /** World position under a pointer event. */
  private worldAt(e: PointerEvent): { x: number; z: number } {
    const f = this.field!;
    const r = this.canvas.getBoundingClientRect();
    return { x: f.bounds.minX + ((e.clientX - r.left) / r.width) * f.width, z: f.bounds.minZ + ((e.clientY - r.top) / r.height) * f.depth };
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.field) return;
    const p = this.worldAt(e);
    // The smallest marker under the pointer, so outposts and towns can be picked out of a base's circle.
    const under = this.markers.filter((m) => Math.hypot(m.x - p.x, m.z - p.z) <= Math.max(m.radius, 4)).sort((a, b) => a.radius - b.radius);
    if (under.length === 0) return;
    this.drag = under[0];
    this.from = { x: under[0].x, z: under[0].z };
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    this.draw();
  }

  private pointerMove(e: PointerEvent): void {
    if (!this.drag || !this.field) return;
    const f = this.field;
    const p = this.worldAt(e);
    const margin = this.drag.radius + (this.drag.kind === 'bases' ? 1 : 2);
    this.drag.x = Math.max(f.bounds.minX + margin, Math.min(f.bounds.maxX - margin, p.x));
    this.drag.z = Math.max(f.bounds.minZ + margin, Math.min(f.bounds.maxZ - margin, p.z));
    this.draw();
  }

  private pointerUp(e: PointerEvent): void {
    if (!this.drag || !this.field) return;
    const f = this.field;
    const dropped = this.drag;
    const kind = dropped.kind;
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    // Dropped on top of another (or hardly moved): back where it was.
    const clash = this.markers.some((m) => m !== dropped && Math.hypot(m.x - dropped.x, m.z - dropped.z) < (m.radius + dropped.radius) * 0.8);
    if (clash || Math.hypot(dropped.x - this.from.x, dropped.z - this.from.z) < 0.5) {
      dropped.x = this.from.x;
      dropped.z = this.from.z;
      this.draw();
      return;
    }
    const spots = this.markers
      .filter((m) => m.kind === kind)
      .sort((a, b) => a.index - b.index)
      .map((m) => ({ x: Math.round((m.x / (f.width / 2)) * 100) / 100, z: Math.round((m.z / (f.depth / 2)) * 100) / 100 }));
    this.onPlace(kind, spots);
  }
}
