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

/** 0xRRGGBB to a CSS colour. */
export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
