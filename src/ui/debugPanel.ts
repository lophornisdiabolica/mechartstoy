import { COST_CLASSES, DEBUG_LAYERS } from '../render/debugOverlay';
import { Stage } from '../render/stage';
import { MoveClass } from '../world/moveClasses';
import { el } from './dom';

/**
 * The debug overlays' switches (O toggles the panel; see DebugOverlay):
 * a checkbox per layer, and which movement class the route-cost layer
 * shows. The layers stay on across battles until switched off.
 */
export class DebugPanel {
  readonly root = el('div', { id: 'debug', hidden: '' });

  constructor(private readonly stage: Stage) {
    document.body.append(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    this.root.hidden = !this.root.hidden;
    if (this.visible) this.build();
  }

  /** A new battle loaded: show its state. */
  refresh(): void {
    if (this.visible) this.build();
  }

  private build(): void {
    const overlay = this.stage.debugOverlay;
    this.root.replaceChildren(el('div', { class: 'title' }, 'Debug overlays (O)'));
    for (const { id, label } of DEBUG_LAYERS) {
      const box = el('input', { type: 'checkbox' });
      box.checked = overlay.isShown(id);
      box.addEventListener('change', () => overlay.show(id, box.checked));
      const row = el('label');
      row.append(box, ` ${label}`);
      this.root.append(row);
      if (id === 'cost') {
        const pick = el('select');
        for (const m of COST_CLASSES) pick.append(el('option', { value: m }, m));
        pick.value = overlay.costClass;
        pick.addEventListener('change', () => (overlay.costClass = pick.value as MoveClass));
        row.append(' for ', pick);
      }
    }
  }
}
