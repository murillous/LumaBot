import type { Unsubscribe } from './types.ts';

type Handler<P> = (payload: P) => void | Promise<void>;

/** Destino dos erros de handlers: o emissor nunca os deixa subir para o adapter. */
export type EmitterErrorHandler<Events> = (error: unknown, event: keyof Events) => void;

/**
 * Emissor tipado por instância, para os adapters implementarem `Transport.on()` sem estado
 * global. Um handler que falha (síncrono ou rejeitando) não impede os demais: o erro vai para
 * `onError`, porque o adapter, que emite, não tem o que fazer com ele.
 */
export class TypedEmitter<Events extends object> {
  readonly #handlers = new Map<keyof Events, Set<Handler<never>>>();
  readonly #onError: EmitterErrorHandler<Events>;

  constructor(onError: EmitterErrorHandler<Events>) {
    this.#onError = onError;
  }

  on<E extends keyof Events>(event: E, handler: Handler<Events[E]>): Unsubscribe {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    // Wrapper próprio: o mesmo handler assinado duas vezes vira duas assinaturas independentes.
    const entry: Handler<never> = (payload) => handler(payload);
    set.add(entry);
    return () => {
      const current = this.#handlers.get(event);
      if (!current?.delete(entry)) return;
      // Remove o Set vazio para eventos sem assinante não acumularem entradas no Map.
      if (current.size === 0) this.#handlers.delete(event);
    };
  }

  emit<E extends keyof Events>(event: E, payload: Events[E]): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    // Cópia: handlers podem (des)assinar durante a emissão sem afetar esta rodada.
    for (const handler of [...set] as Handler<Events[E]>[]) {
      try {
        const result = handler(payload);
        if (result instanceof Promise) {
          result.catch((error: unknown) => this.#onError(error, event));
        }
      } catch (error) {
        this.#onError(error, event);
      }
    }
  }

  listenerCount(event: keyof Events): number {
    return this.#handlers.get(event)?.size ?? 0;
  }

  /** Remove todas as assinaturas (ex.: no `disconnect()` definitivo do adapter). */
  clear(): void {
    this.#handlers.clear();
  }
}
