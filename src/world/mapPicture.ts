import { Battlefield } from './battlefield';
import { BIOMES } from './biomes';
import { GROUND_IDS } from './ground';
import * as D from '../core/dmath';

/**
 * Top-down pictures of a battlefield as plain RGBA pixels, so the setup
 * screen's map and `npm run map` (which writes PNGs headlessly) draw the
 * same thing.
 */

export interface Picture {
  width: number;
  height: number;
  /** RGBA, row by row from the north-west corner. */
  data: Uint8ClampedArray;
}

/** The ground, one pixel per map cell: height-shaded land, water, dense forest, scrap, roads and bridges. */
export function groundPicture(field: Battlefield): Picture {
  const { cols, rows, cellSize } = field.config;
  const data = new Uint8ClampedArray(cols * rows * 4);
  const biome = BIOMES[field.config.biome];
  const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  const [low, high, water, shore, rock] = [biome.ground.low, biome.ground.high, biome.water, biome.ground.shore, biome.ground.rock].map(rgb);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = field.bounds.minX + (i + 0.5) * cellSize;
      const z = field.bounds.minZ + (j + 0.5) * cellSize;
      const h = field.heightAt(x, z);
      let c: number[];
      if (h < field.seaLevel) c = water.map((v) => v * 0.85);
      else if (h < field.seaLevel + 0.35) c = shore;
      else {
        const t = Math.min(1, (h - field.seaLevel) / (field.config.maxHeight * 0.8));
        c = low.map((v, k) => v + (high[k] - v) * t);
        if (field.slopeAt(x, z) > 0.7) c = c.map((v, k) => (v + rock[k]) / 2);
      }
      const ground = GROUND_IDS[field.ground[j * cols + i]];
      if (ground === 'thicket') c = c.map((v) => v * 0.55);
      else if (ground === 'road') c = [150, 144, 132];
      if (field.deckAt(x, z) !== null) c = [170, 165, 155];
      data.set([c[0], c[1], c[2], 255], (j * cols + i) * 4);
    }
  }
  return { width: cols, height: rows, data };
}

/** Letters for outpost kinds on the picture. */
const KIND_LETTERS: Record<string, string> = { supply: 'S', airstrip: 'A', gun: 'G', relay: 'R', fuel: 'F', factory: 'M' };

/** A 3×5 pixel font, just the characters the picture needs. */
const FONT: Record<string, string> = {
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  T: '111010010010010',
  S: '111100111001111',
  A: '010101111101101',
  G: '111100101101111',
  R: '110101110101101',
  F: '111100110100100',
  M: '101111111101101',
};

/**
 * The whole map at `scale` pixels per cell: the ground, and over it each
 * base (in its side's colour, numbered), town (T) and outpost (lettered by
 * kind: Supply, Airstrip, Gun, Relay, Fuel, factory M).
 */
export function mapPicture(field: Battlefield, sideColors: number[], scale = 4): Picture {
  const ground = groundPicture(field);
  const width = ground.width * scale;
  const height = ground.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / scale) * ground.width + Math.floor(x / scale)) * 4;
      data.set(ground.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  const px = scale / field.config.cellSize;
  const at = (wx: number, wz: number) => [(wx - field.bounds.minX) * px, (wz - field.bounds.minZ) * px];
  const blend = (x: number, y: number, c: number, alpha: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const k = (y * width + x) * 4;
    const rgb = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    for (let n = 0; n < 3; n++) data[k + n] = data[k + n] * (1 - alpha) + rgb[n] * alpha;
  };
  const disc = (wx: number, wz: number, radius: number, color: number, alpha: number) => {
    const [cx, cy] = at(wx, wz);
    const r = radius * px;
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = D.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r - 1.5) blend(x, y, color, alpha);
        else if (d <= r) blend(x, y, 0x1a1d24, 0.9);
      }
    }
  };
  const label = (wx: number, wz: number, text: string) => {
    const glyph = FONT[text];
    if (!glyph) return;
    const size = Math.max(1, Math.round(scale / 2));
    const [cx, cy] = at(wx, wz);
    const x0 = Math.round(cx - 1.5 * size);
    const y0 = Math.round(cy - 2.5 * size);
    for (let i = 0; i < 15; i++) {
      if (glyph[i] !== '1') continue;
      for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) blend(x0 + (i % 3) * size + dx, y0 + Math.floor(i / 3) * size + dy, 0x1a1d24, 1);
    }
  };
  for (const b of field.baseSites) {
    disc(b.x, b.z, b.radius, sideColors[b.faction] ?? 0xffffff, 0.55);
    label(b.x, b.z, String(b.faction + 1));
  }
  for (const t of field.townSites) {
    disc(t.x, t.z, t.radius, 0xd8d2c4, 0.45);
    label(t.x, t.z, 'T');
  }
  for (const o of field.outpostSites) {
    disc(o.x, o.z, o.radius, 0xe8d27a, 0.5);
    label(o.x, o.z, KIND_LETTERS[o.kind] ?? '');
  }
  return { width, height, data };
}
