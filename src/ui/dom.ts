/** Tiny DOM helpers shared by the UI panels. */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text) node.textContent = text;
  return node;
}

/** A row of mutually exclusive buttons. */
export function segmented<T>(options: { label: string; value: T; title?: string }[], onPick: (v: T) => void) {
  const row = el('div', { class: 'seg' });
  const buttons = options.map((o) => {
    const b = el('button', { type: 'button', title: o.title ?? o.label }, o.label);
    b.addEventListener('click', () => onPick(o.value));
    row.append(b);
    return { b, value: o.value };
  });
  return {
    row,
    set(value: T) {
      for (const { b, value: v } of buttons) b.classList.toggle('on', v === value);
    },
  };
}

/** A drop-down list with the same shape as `segmented`, for when there are too many options for buttons. */
export function dropdown<T>(options: { label: string; value: T }[], onPick: (v: T) => void, ariaLabel: string) {
  const row = el('select', { 'aria-label': ariaLabel });
  options.forEach((o, i) => row.append(el('option', { value: String(i) }, o.label)));
  row.addEventListener('change', () => onPick(options[Number(row.value)].value));
  return {
    row,
    set(value: T) {
      const i = options.findIndex((o) => o.value === value);
      if (i >= 0) row.value = String(i);
    },
  };
}

/** 0xRRGGBB to a CSS colour. */
export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** WCAG relative luminance of 0xRRGGBB, 0 (black) to 1 (white). */
function luminance(c: number): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((c >> 16) & 255) + 0.7152 * lin((c >> 8) & 255) + 0.0722 * lin(c & 255);
}

/** Lightest a side's colour has to be for its name to read on the dark panels (about 5:1 against them). */
const MIN_TEXT_LUMINANCE = 0.2;

/**
 * A side's colour for text and lines on the dark UI: its own colour, or for
 * a dark one the same hue lifted toward white just enough to read (a navy
 * side's name shows as a mid blue). Swatches and models keep the true colour.
 */
export function readable(c: number): number {
  if (luminance(c) >= MIN_TEXT_LUMINANCE) return c;
  const mix = (t: number) => {
    const ch = (s: number) => Math.round(((c >> s) & 255) + (255 - ((c >> s) & 255)) * t);
    return (ch(16) << 16) | (ch(8) << 8) | ch(0);
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(mix(mid)) >= MIN_TEXT_LUMINANCE) hi = mid;
    else lo = mid;
  }
  return mix(hi);
}

/** readable() as a CSS colour. */
export function textHex(c: number): string {
  return hex(readable(c));
}
