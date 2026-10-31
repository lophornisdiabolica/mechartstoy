/**
 * Typed event bus for decoupling systems, e.g. combat emits "unitDestroyed" and
 * the effects layer spawns an explosion without either knowing about the other.
 */
export class EventBus<Events extends Record<string, unknown>> {
  private readonly handlers: { [K in keyof Events]?: ((payload: Events[K]) => void)[] } = {};

  on<K extends keyof Events>(type: K, handler: (payload: Events[K]) => void): () => void {
    const list = (this.handlers[type] ??= []);
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.handlers[type];
    if (list) for (const h of list.slice()) h(payload);
  }
}
