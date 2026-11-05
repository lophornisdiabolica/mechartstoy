/**
 * Math that gives the same answer on every machine.
 *
 * The sim must play a seed out the same way everywhere: in any browser, in
 * the worker, and in Node for the sims. JavaScript only promises that the
 * basic operations (+, -, *, /, %, Math.sqrt, Math.floor and the like) are
 * exactly rounded. Math.sin, cos, atan2, exp, log, pow, hypot and `**` may
 * differ in the last bit between engines and versions, and over a battle
 * those bits add up to a different battle (Node 22 and Node 26 do). So the
 * sim (src/game, src/world, src/core, src/sim) uses these instead. They are
 * built only from the exactly rounded operations, after FreeBSD's msun
 * (fdlibm), so they're as accurate as Math's to within a bit or two.
 *
 * test/dmath.test.ts checks them against Math, and fails if sim code calls
 * the Math versions.
 */

/** x squared: x * x, which `x ** 2` isn't promised to be. */
export const sq = (x: number): number => x * x;

/** The length of (x, y) or (x, y, z), as Math.hypot (inputs this sim sees can't overflow). */
export function hypot(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z);
}

// sin and cos: reduce to [-pi/4, pi/4] by multiples of pi/2, then a polynomial.
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO4 = 7.85398163397448278999e-1;
/** Adding and taking away this rounds a double to an integer, the same everywhere (|x| < 2^51). */
const ROUNDER = 6755399441055744; // 1.5 * 2^52

/** sin of (x + y), |x + y| <= pi/4, y the small tail (iy 0 when there's none). */
function kSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6);
  const v = z * x;
  if (iy === 0) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos of (x + y), |x + y| <= pi/4. */
function kCos(x: number, y: number): number {
  const z = x * x;
  const w = z * z;
  const r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
  const hz = 0.5 * z;
  const v = 1 - hz;
  return v + (1 - v - hz + (z * r - x * y));
}

/** x as n * pi/2 + (y0 + y1); returns n. Accurate for the angles a battle sees (well past millions of radians). */
let y0 = 0;
let y1 = 0;
function reduce(x: number): number {
  const fn = x * INV_PIO2 + ROUNDER - ROUNDER;
  const r0 = x - fn * PIO2_1;
  const w0 = fn * PIO2_2;
  const r = r0 - w0;
  const w = fn * PIO2_2T - (r0 - r - w0);
  y0 = r - w;
  y1 = r - y0 - w;
  return fn;
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= PIO4) return kSin(x, 0, 0);
  const n = reduce(x) & 3;
  if (n === 0) return kSin(y0, y1, 1);
  if (n === 1) return kCos(y0, y1);
  if (n === 2) return -kSin(y0, y1, 1);
  return -kCos(y0, y1);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= PIO4) return kCos(x, 0);
  const n = reduce(x) & 3;
  if (n === 0) return kCos(y0, y1);
  if (n === 1) return -kSin(y0, y1, 1);
  if (n === 2) return -kCos(y0, y1);
  return kSin(y0, y1, 1);
}

// atan and atan2.
const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2,
  1.62858201153657823623e-2,
];
const PI = 3.14159265358979311600;
const PI_LO = 1.2246467991473531772e-16;

export function atan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const neg = x < 0;
  let a = Math.abs(x);
  if (a >= 7.3786976294838206464e19) return neg ? -(ATAN_HI[3] + ATAN_LO[3]) : ATAN_HI[3] + ATAN_LO[3];
  let id = -1;
  if (a < 0.4375) {
    if (a < 7.450580596923828e-9) return x;
    a = x;
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (a < 2.4375) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return a - a * (s1 + s2);
  const r = ATAN_HI[id] - (a * (s1 + s2) - ATAN_LO[id] - a);
  return neg ? -r : r;
}

/** The angle of (x, y) from the +x axis, in (-pi, pi], as Math.atan2(y, x). */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const yNeg = y < 0 || Object.is(y, -0);
  if (y === 0) {
    if (x > 0 || Object.is(x, 0)) return y;
    return yNeg ? -(PI + PI_LO) : PI + PI_LO;
  }
  if (x === 0) return yNeg ? -ATAN_HI[3] - ATAN_LO[3] : ATAN_HI[3] + ATAN_LO[3];
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      const q = x > 0 ? PIO4 : 3 * PIO4;
      return yNeg ? -q : q;
    }
    if (x > 0) return yNeg ? -0 : 0;
    return yNeg ? -(PI + PI_LO) : PI + PI_LO;
  }
  if (!Number.isFinite(y)) return yNeg ? -ATAN_HI[3] - ATAN_LO[3] : ATAN_HI[3] + ATAN_LO[3];
  const z = atan(Math.abs(y / x));
  if (x > 0) return yNeg ? -z : z;
  return yNeg ? z - PI_LO - PI : PI - (z - PI_LO);
}

// exp and log.
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** 2^k exactly, for an integer k (built from powers of two, which are exact). */
function twoPow(k: number): number {
  let r = 1;
  let b = k < 0 ? 0.5 : 2;
  let n = Math.abs(k);
  while (n > 0) {
    if (n & 1) r *= b;
    b *= b;
    n >>= 1;
  }
  return r;
}

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 7.09782712893383973096e2) return Infinity;
  if (x < -7.45133219101941108420e2) return 0;
  const a = Math.abs(x);
  if (a < 3.725290298461914e-9) return 1 + x;
  let k = 0;
  let hi = x;
  let lo = 0;
  if (a > 0.5 * LN2_HI) {
    k = Math.trunc(INV_LN2 * x + (x < 0 ? -0.5 : 0.5));
    hi = x - k * LN2_HI;
    lo = k * LN2_LO;
    x = hi - lo;
  }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((x * c) / (c - 2) - x);
  const y = 1 - (lo - (x * c) / (2 - c) - hi);
  // Scale in two steps far down, so a tiny result rounds once into the subnormals.
  return k < -1020 ? y * twoPow(k + 1000) * twoPow(-1000) : y * twoPow(k);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const bits = new DataView(new ArrayBuffer(8));

export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m * 2^k with m in [sqrt(1/2), sqrt(2)), read from the bits.
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54: lift subnormals into the normal range
    k = -54;
  }
  bits.setFloat64(0, x);
  const hi = bits.getUint32(0);
  k += ((hi >>> 20) & 0x7ff) - 1023;
  bits.setUint32(0, (hi & 0x000fffff) | 0x3ff00000);
  let m = bits.getFloat64(0);
  if (m > Math.SQRT2) {
    m *= 0.5;
    k++;
  }
  const f = m - 1;
  const hfsq = 0.5 * f * f;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  return k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f);
}

/**
 * x to the power y. Whole powers up to 64 multiply out; other powers of
 * positive x go through exp and log (accurate to a few bits, which the sim
 * doesn't notice). Negative x to a fraction is NaN, as Math.pow.
 */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let r = 1;
    let b = x;
    let n = Math.abs(y);
    while (n > 0) {
      if (n & 1) r *= b;
      b *= b;
      n >>= 1;
    }
    return y < 0 ? 1 / r : r;
  }
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) return NaN;
  return exp(y * log(x));
}
