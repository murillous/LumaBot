import type { MessageContext } from '#context.ts';

/** Avança para o próximo middleware (ou para o fim do pipeline). Chamar duas vezes é erro. */
export type Next = () => Promise<void>;

/**
 * Estágio do pipeline em onion (estilo Koa). Para interromper, não chame `next()`. O código
 * depois de `await next()` roda na volta, depois dos middlewares internos.
 */
export type Middleware<C extends MessageContext = MessageContext> = (ctx: C, next: Next) => unknown;

export interface MiddlewareOptions {
  /** Maior prioridade roda antes (mais por fora). Empate: ordem de registro. Padrão `0`. */
  readonly priority?: number;
}

interface Entry<C extends MessageContext> {
  readonly middleware: Middleware<C>;
  readonly priority: number;
}

const RESOLVED: Promise<void> = Promise.resolve();

/**
 * Primeiro estágio do fluxo de mensagem (ADR 0012). A ordem é calculada em `use`/remoção,
 * não a cada mensagem: `run` só percorre um array pronto.
 */
export class MiddlewarePipeline<C extends MessageContext = MessageContext> {
  #entries: Entry<C>[] = [];
  #chain: readonly Middleware<C>[] = [];

  /** Registra um middleware; devolve a função que o remove (idempotente). */
  use(middleware: Middleware<C>, options: MiddlewareOptions = {}): () => void {
    const priority = options.priority ?? 0;
    // NaN quebraria a comparação do sort e embaralharia a cadeia inteira.
    if (!Number.isFinite(priority)) throw new RangeError(`Prioridade inválida: ${priority}`);
    const entry: Entry<C> = { middleware, priority };
    this.#entries.push(entry);
    this.#rebuild();
    return () => {
      const index = this.#entries.indexOf(entry);
      if (index === -1) return;
      this.#entries.splice(index, 1);
      this.#rebuild();
    };
  }

  get size(): number {
    return this.#chain.length;
  }

  /**
   * Passa o contexto pela cadeia. Resolve `true` se a mensagem atravessou até o fim (todos
   * chamaram `next()`) e `false` se algum middleware a interrompeu. Erros de middleware
   * rejeitam a promise: o destino deles é de quem executa o pipeline.
   */
  run(ctx: C): Promise<boolean> {
    // Snapshot: registrar/remover durante a execução não afeta a mensagem em andamento.
    const chain = this.#chain;
    const length = chain.length;
    if (length === 0) return Promise.resolve(true);

    let index = -1;
    let completed = false;
    const dispatch = (i: number): Promise<void> => {
      if (i <= index) return Promise.reject(new Error('next() chamado mais de uma vez'));
      index = i;
      if (i === length) {
        completed = true;
        return RESOLVED;
      }
      // biome-ignore lint/style/noNonNullAssertion: 0 <= i < length
      const middleware = chain[i]!;
      try {
        // O valor devolvido pelo middleware é ignorado; o cast evita um `.then` por estágio.
        return Promise.resolve(middleware(ctx, () => dispatch(i + 1))) as Promise<void>;
      } catch (error) {
        // Middleware síncrono que lança vira rejeição, como no caso assíncrono.
        return Promise.reject(error);
      }
    };
    return dispatch(0).then(() => completed);
  }

  #rebuild(): void {
    // Maior prioridade primeiro. O sort é estável e a entrada nova chega no fim do array já
    // ordenado, então o empate preserva a ordem de registro.
    this.#entries.sort((a, b) => b.priority - a.priority);
    this.#chain = this.#entries.map((entry) => entry.middleware);
  }
}
