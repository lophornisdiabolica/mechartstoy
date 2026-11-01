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
