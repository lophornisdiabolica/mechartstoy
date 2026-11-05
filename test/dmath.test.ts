import { describe, expect, it } from 'vitest';
import * as D from '../src/core/dmath';

/** Relative difference, with a floor so values near zero compare absolutely. */
const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** A spread of inputs from a fixed seed: small, medium and large, both signs. */
function samples(n: number, scale: number): number[] {
  let s = 12345;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out.push(((s / 2 ** 32) * 2 - 1) * scale);
  }
  return out;
}

describe('deterministic math', () => {
  it('matches Math to within a couple of bits', () => {
    for (const scale of [1e-6, 0.5, 3.2, 100, 1e5]) {
      for (const x of samples(2000, scale)) {
        expect(close(D.sin(x), Math.sin(x), 4e-16)).toBe(true);
        expect(close(D.cos(x), Math.cos(x), 4e-16)).toBe(true);
        expect(close(D.atan(x), Math.atan(x), 4e-16)).toBe(true);
        const y = x * 0.37 - 0.11;
        expect(close(D.atan2(y, x), Math.atan2(y, x), 4e-16)).toBe(true);
        expect(close(D.hypot(x, y), Math.hypot(x, y), 4e-16)).toBe(true);
      }
    }
    for (const x of samples(4000, 700)) expect(close(D.exp(x), Math.exp(x), 4e-16)).toBe(true);
    for (const x of samples(4000, 1)) {
      const v = Math.abs(x) * 10 ** ((x * 1e6) % 30);
      expect(close(D.log(v), Math.log(v), 4e-16)).toBe(true);
    }
    for (const x of samples(1000, 8)) {
      const b = Math.abs(x);
      expect(close(D.pow(b, 1.5), Math.pow(b, 1.5), 1e-14)).toBe(true);
      expect(close(D.pow(b, 4), b * b * b * b, 4e-16)).toBe(true);
      expect(D.sq(x)).toBe(x * x);
    }
  });

  it('handles the edges as Math does', () => {
    expect(D.sin(0)).toBe(0);
    expect(D.cos(0)).toBe(1);
    expect(D.sin(NaN)).toBeNaN();
    expect(D.cos(Infinity)).toBeNaN();
    expect(D.atan2(0, 1)).toBe(0);
    expect(D.atan2(0, -1)).toBe(Math.PI);
    expect(D.atan2(-0, -1)).toBe(-Math.PI);
    expect(D.atan2(1, 0)).toBe(Math.PI / 2);
    expect(D.atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(D.atan2(1, -1)).toBe(Math.atan2(1, -1));
    expect(D.exp(0)).toBe(1);
    expect(D.exp(1000)).toBe(Infinity);
    expect(D.exp(-1000)).toBe(0);
    expect(D.log(1)).toBe(0);
    expect(D.log(0)).toBe(-Infinity);
    expect(D.log(-1)).toBeNaN();
    expect(D.log(5e-324)).toBe(Math.log(5e-324));
    expect(D.pow(2, 0)).toBe(1);
    expect(D.pow(0, 1.5)).toBe(0);
  });

  it('gives fixed answers, whatever engine runs it', () => {
    // Pinned from the exact operations these are built from: if any of these
    // change, the sim no longer plays a seed the same way everywhere.
    const pins = [D.sin(1), D.cos(1), D.sin(1234.5678), D.atan2(0.3, -0.7), D.exp(2.5), D.log(10), D.pow(3.7, 1.5)];
    expect(pins).toEqual(PINNED);
  });
});

// Worked out once (Node 22). Only exactly rounded operations make them, so every engine gets the same.
const PINNED = [0.8414709848078965, 0.5403023058681398, 0.07803344920002027, 2.7367008673047097, 12.182493960703473, 2.302585092994046, 7.117092102818399];

describe('sim code', () => {
  it('uses the deterministic math, not Math.sin and the like', () => {
    const banned = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|expm1|log|log2|log10|log1p|pow|hypot|cbrt)\(|\*\*/;
    const offenders: string[] = [];
    // Every sim source file, as text (Vite reads them at test time).
    const sources = import.meta.glob(['../src/game/**/*.ts', '../src/world/**/*.ts', '../src/core/**/*.ts', '../src/sim/**/*.ts', '!../src/core/dmath.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    for (const [path, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, i) => {
        // Comments may say ** (doc comments open with it); code may not.
        const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/^\s*\/?\*.*$/, '');
        if (banned.test(code)) offenders.push(`${path}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
