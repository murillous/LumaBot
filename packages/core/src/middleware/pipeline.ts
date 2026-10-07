import type { MessageContext } from '#context.ts';
import { isThenable } from '#deadline.ts';

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

export interface MiddlewarePipelineOptions {
  /**
   * Prazo de cada middleware, contado só no tempo dele: o que passa dentro do `next()` (os
   * middlewares internos, comando e listeners) não conta, porque cada um tem o próprio prazo.
   * Sem ele, middleware não tem prazo.
   */
  readonly timeoutMs?: number;
  /** Rejeição de um middleware que já estourou o prazo (o `run` já rejeitou por ele). */
  readonly onLateError?: (error: unknown) => void;
}

/** Um middleware estourou o prazo. A mensagem é descartada (o `run` rejeita com este erro). */
export class MiddlewareTimeoutError extends Error {
  override readonly name = 'MiddlewareTimeoutError';
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`middleware excedeu ${timeoutMs} ms`);
    this.timeoutMs = timeoutMs;
  }
}

/** O pipeline foi encerrado (`close`) com o middleware ainda em andamento. */
export class MiddlewareAbandonedError extends Error {
  override readonly name = 'MiddlewareAbandonedError';

  constructor() {
    super('middleware abandonado: o pipeline foi encerrado');
  }
}

interface Entry<C extends MessageContext> {
  readonly middleware: Middleware<C>;
  readonly priority: number;
}

const RESOLVED: Promise<void> = Promise.resolve();
const NOOP = (): void => undefined;

/**
 * Primeiro estágio do fluxo de mensagem (ADR 0012). A ordem é calculada em `use`/remoção,
 * não a cada mensagem: `run` só percorre um array pronto.
 */
export class MiddlewarePipeline<C extends MessageContext = MessageContext> {
  #entries: Entry<C>[] = [];
  #chain: readonly Middleware<C>[] = [];
  readonly #timeoutMs: number | undefined;
  readonly #onLateError: (error: unknown) => void;
  // Abandono dos estágios com timer armado, para o `close` não deixar timer vivo.
  readonly #active = new Set<() => void>();

  constructor(options: MiddlewarePipelineOptions = {}) {
    const { timeoutMs } = options;
    // setTimeout trata Infinity/NaN como 1 ms: todo middleware assíncrono estouraria na hora.
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      throw new RangeError(`Prazo inválido: ${timeoutMs}`);
    }
    this.#timeoutMs = timeoutMs;
    this.#onLateError = options.onLateError ?? NOOP;
  }

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
   *
   * `terminal` é o estágio mais interno: roda quando o último middleware chama `next()`, e a
   * volta da cebola espera por ele. É onde o kernel põe comando e listeners (ADR 0012).
   *
   * Com `timeoutMs`, um middleware que estoura o prazo rejeita o `run` com
   * `MiddlewareTimeoutError`, e a mensagem para ali: um `next()` chamado depois disso rejeita
   * com o mesmo erro, sem rodar o resto da cadeia.
   */
  run(ctx: C, terminal?: (ctx: C) => Promise<void>): Promise<boolean> {
    // Snapshot: registrar/remover durante a execução não afeta a mensagem em andamento.
    const chain = this.#chain;
    const length = chain.length;
    if (length === 0) {
      return terminal === undefined ? Promise.resolve(true) : terminal(ctx).then(() => true);
    }

    let index = -1;
    let completed = false;
    let expired: MiddlewareTimeoutError | undefined;
    const expire = (error: MiddlewareTimeoutError): void => {
      expired = error;
    };
    const dispatch = (i: number): Promise<void> => {
      if (expired !== undefined) return Promise.reject(expired);
      if (i <= index) return Promise.reject(new Error('next() chamado mais de uma vez'));
      index = i;
      if (i === length) {
        completed = true;
        return terminal === undefined ? RESOLVED : terminal(ctx);
      }
      // biome-ignore lint/style/noNonNullAssertion: 0 <= i < length
      const middleware = chain[i]!;
      const next = (): Promise<void> => dispatch(i + 1);
      if (this.#timeoutMs !== undefined) return this.#timed(middleware, ctx, next, expire);
      try {
        // O valor devolvido pelo middleware é ignorado; o cast evita um `.then` por estágio.
        return Promise.resolve(middleware(ctx, next)) as Promise<void>;
      } catch (error) {
        // Middleware síncrono que lança vira rejeição, como no caso assíncrono.
        return Promise.reject(error);
      }
    };
    return dispatch(0).then(() => completed);
  }

  /**
   * Abandona os middlewares ainda em andamento (rejeitam com `MiddlewareAbandonedError`) e
   * desarma os timers deles. É o fim do shutdown: depois dele nenhum timer do pipeline fica vivo.
   */
  close(): void {
    for (const abandon of [...this.#active]) abandon();
  }

  /**
   * Roda um estágio com prazo. O relógio só corre fora do `next()`: para ao chamá-lo e volta,
   * com o que sobrou, quando ele termina. Middleware síncrono, ou que só devolve o `next()`,
   * não arma timer: o caminho quente não paga nada (plano §7).
   */
  #timed(
    middleware: Middleware<C>,
    ctx: C,
    next: () => Promise<void>,
    expire: (error: MiddlewareTimeoutError) => void,
  ): Promise<void> {
    // biome-ignore lint/style/noNonNullAssertion: só é chamado com prazo
    const timeoutMs = this.#timeoutMs!;
    let settled = false;
    let async = false;
    let inside = false;
    let lastNext: Promise<void> | undefined;
    let remaining = timeoutMs;
    let startedAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fail: (error: unknown) => void = NOOP;

    const pause = (): void => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
      remaining -= performance.now() - startedAt;
    };
    const finish = (): void => {
      settled = true;
      pause();
      this.#active.delete(abandon);
    };
    const resume = (): void => {
      startedAt = performance.now();
      timer = setTimeout(
        () => {
          timer = undefined;
          const error = new MiddlewareTimeoutError(timeoutMs);
          expire(error);
          finish();
          fail(error);
        },
        Math.max(0, remaining),
      );
    };
    const abandon = (): void => {
      if (settled) return;
      finish();
      fail(new MiddlewareAbandonedError());
    };
    const back = (): void => {
      inside = false;
      if (async && !settled) resume();
    };
    const timedNext = (): Promise<void> => {
      const pending = next();
      if (settled) return pending;
      pause();
      inside = true;
      lastNext = pending;
      // `back` não lança: esta derivada nunca rejeita. O erro do `next()` é de quem o chamou.
      pending.then(back, back);
      return pending;
    };

    let result: unknown;
    try {
      result = middleware(ctx, timedNext);
    } catch (error) {
      settled = true;
      return Promise.reject(error);
    }
    // Síncrono, ou devolveu o próprio `next()`: não sobra tempo do middleware para medir.
    if (!isThenable(result) || result === lastNext) {
      settled = true;
      return Promise.resolve(result) as Promise<void>;
    }
    async = true;
    if (!inside) resume();
    this.#active.add(abandon);
    const promise = result;
    return new Promise<void>((resolve, reject) => {
      fail = reject;
      promise.then(
        () => {
          if (settled) return;
          finish();
          resolve();
        },
        (error: unknown) => {
          if (settled) {
            this.#onLateError(error);
            return;
          }
          finish();
          reject(error);
        },
      );
    });
  }

  #rebuild(): void {
    // Maior prioridade primeiro. O sort é estável e a entrada nova chega no fim do array já
    // ordenado, então o empate preserva a ordem de registro.
    this.#entries.sort((a, b) => b.priority - a.priority);
    this.#chain = this.#entries.map((entry) => entry.middleware);
  }
}
