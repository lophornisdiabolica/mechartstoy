import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Game } from '../src/game/game';
import { defaultSettings } from '../src/game/settings';
import { STRENGTH_CELL } from '../src/game/commander/strength';
import { FrontLines } from '../src/render/frontLines';
import { factionColors } from '../src/render/models';
import { Sample, turningPoint } from '../src/ui/battleChart';

function game(): Game {
  const s = defaultSettings();
  s.map.size = 'small';
  s.seed = 'fronts';
  return new Game(1234, { settings: s });
}

describe('front lines', () => {
  it('shades the ground round each base in its side’s colour', () => {
    const g = game();
    for (let i = 0; i < 30 * 20; i++) g.step(1 / 30);
    const fronts = new FrontLines(g);
    fronts.visible = true;
    const colors = (fronts.root.children[0] as THREE.Mesh).geometry.getAttribute('color');
    const cols = Math.ceil(g.field.width / STRENGTH_CELL);
    g.field.baseSites.forEach((b, f) => {
      const i = Math.floor((b.x - g.field.bounds.minX) / STRENGTH_CELL);
      const j = Math.floor((b.z - g.field.bounds.minZ) / STRENGTH_CELL);
      const k = j * cols + i;
      const side = new THREE.Color(factionColors(f).primary);
      const shown = new THREE.Color(colors.getX(k), colors.getY(k), colors.getZ(k));
      // Its own colour (not the other side's), and visibly there.
      const other = new THREE.Color(factionColors(1 - f).primary);
      expect(distance(shown, side)).toBeLessThan(distance(shown, other));
      expect(colors.getW(k)).toBeGreaterThan(0.1);
    });
    fronts.dispose();
  }, 60000);
});

function distance(a: THREE.Color, b: THREE.Color): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

describe('post-battle chart', () => {
  const fake = (winners: number[]) => ({ outcome: { winners, time: 100, team: 0 }, ctx: { sides: { teams: [0, 1] } } }) as unknown as Game;
  const s = (time: number, a: number, b: number): Sample => ({ time, strength: [a, b] });

  it('finds when the winners took the lead for good', () => {
    const samples = [s(0, 10, 10), s(5, 12, 8), s(10, 6, 9), s(15, 9, 7), s(20, 11, 3)];
    expect(turningPoint(fake([0]), samples)).toBe(15);
    expect(turningPoint(fake([1]), samples)).toBeNull();
  });

  it('says so when the winners led all along', () => {
    expect(turningPoint(fake([0]), [s(0, 5, 4), s(5, 9, 3)])).toBe(0);
  });
});
