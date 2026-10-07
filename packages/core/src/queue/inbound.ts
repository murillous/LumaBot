// Fila de entrada por chat (porta do JidQueue do legacy). Mesmo chat em série — sem race no
// histórico/estado da conversa —, chats distintos em paralelo, sem bloqueio global.

/** Trabalho de uma mensagem. Pode ser síncrono ou assíncrono. */
export type InboundTask = () => unknown;

/**
 * Resultado de `enqueue`. `'queued'`: aceita (iniciada ou na fila). `'full'`: o backlog do chat
 * está no limite e a tarefa foi descartada. `'closed'`: a fila foi fechada (shutdown).
 */
export type EnqueueResult = 'queued' | 'full' | 'closed';

export interface InboundQueueOptions {
  /** Destino de todo erro lançado por uma tarefa. A fila segue para a próxima tarefa do chat. */
  readonly onError: (error: unknown, chatId: string) => void;
  /**
   * Máximo de tarefas aguardando por chat, sem contar a que está rodando. Ao exceder, a nova
   * tarefa é rejeitada (`'full'`). Padrão: 100. `Infinity` desliga o limite.
   */
  readonly maxPendingPerChat?: number;
}

/** Fotografia das métricas da fila. Leitura O(1): os contadores são mantidos incrementalmente. */
export interface InboundQueueStats {
  /** Chats com tarefa rodando (e possivelmente outras aguardando). */
  readonly activeChats: number;
  /** Tarefas aguardando em todos os chats, sem contar as que estão rodando. */
  readonly pending: number;
  /** Tarefas concluídas, com sucesso ou erro. */
  readonly processed: number;
  /** Tarefas rejeitadas (`'full'` ou `'closed'`), nunca executadas. */
  readonly dropped: number;
  /** Tarefas que lançaram erro (subconjunto de `processed`). */
  readonly errors: number;
}

const DEFAULT_MAX_PENDING_PER_CHAT = 100;

export class InboundQueue {
  readonly #onError: (error: unknown, chatId: string) => void;
  readonly #maxPending: number;
  // Um chat só tem entrada enquanto há tarefa rodando; o runner a remove ao esvaziar, então o
  // Map nunca acumula chats ociosos (o vazamento do rateLimiter do legacy).
  readonly #chats = new Map<string, InboundTask[]>();
  #idleWaiters: (() => void)[] = [];
  #closed = false;
  #pending = 0;
  #processed = 0;
  #dropped = 0;
  #errors = 0;

  constructor(options: InboundQueueOptions) {
    const max = options.maxPendingPerChat ?? DEFAULT_MAX_PENDING_PER_CHAT;
    if (!(max === Number.POSITIVE_INFINITY || (Number.isInteger(max) && max >= 0))) {
      throw new RangeError(
        `maxPendingPerChat deve ser inteiro >= 0 ou Infinity (recebido: ${max})`,
      );
    }
    this.#onError = options.onError;
    this.#maxPending = max;
  }

  /**
   * Agenda `task` no chat. Se o chat está ocioso, a tarefa começa já, de forma síncrona; senão
   * aguarda as anteriores. Nunca lança nem rejeita: erros da tarefa vão para `onError`.
   */
  enqueue(chatId: string, task: InboundTask): EnqueueResult {
    if (this.#closed) {
      this.#dropped++;
      return 'closed';
    }
    const waiting = this.#chats.get(chatId);
    if (waiting === undefined) {
      const fresh: InboundTask[] = [];
      this.#chats.set(chatId, fresh);
      void this.#run(chatId, fresh, task);
      return 'queued';
    }
    if (waiting.length >= this.#maxPending) {
      this.#dropped++;
      return 'full';
    }
    waiting.push(task);
    this.#pending++;
    return 'queued';
  }

  /** Tarefas aguardando no chat, sem contar a que está rodando. */
  pendingFor(chatId: string): number {
    return this.#chats.get(chatId)?.length ?? 0;
  }

  stats(): InboundQueueStats {
    return {
      activeChats: this.#chats.size,
      pending: this.#pending,
      processed: this.#processed,
      dropped: this.#dropped,
      errors: this.#errors,
    };
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Resolve quando não há tarefa rodando nem aguardando. Não impede novas tarefas. */
  onIdle(): Promise<void> {
    if (this.#chats.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  /**
   * Shutdown gracioso: para de aceitar tarefas (novas viram `'closed'`) e resolve quando as já
   * aceitas terminarem. Com `drain: false`, descarta as que aguardam (contam em `dropped`); as
   * que já rodam terminam. Pode ser chamado de novo com `drain: false` para abortar uma drenagem.
   */
  close(options: { readonly drain?: boolean } = {}): Promise<void> {
    this.#closed = true;
    if (options.drain === false) {
      for (const waiting of this.#chats.values()) {
        this.#dropped += waiting.length;
        this.#pending -= waiting.length;
        waiting.length = 0;
      }
    }
    return this.onIdle();
  }

  async #run(chatId: string, waiting: InboundTask[], first: InboundTask): Promise<void> {
    let task: InboundTask | undefined = first;
    while (task !== undefined) {
      try {
        await task();
      } catch (error) {
        this.#errors++;
        this.#report(error, chatId);
      }
      this.#processed++;
      task = waiting.shift();
      if (task !== undefined) this.#pending--;
    }
    this.#chats.delete(chatId);
    if (this.#chats.size === 0 && this.#idleWaiters.length > 0) {
      const waiters = this.#idleWaiters;
      this.#idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  #report(error: unknown, chatId: string): void {
    try {
      this.#onError(error, chatId);
    } catch (handlerError) {
      // Bug no próprio onError: não há outro destino seguro sem logger, então vira exceção não
      // capturada (fora do runner, para não travar a fila do chat) em vez de sumir.
      queueMicrotask(() => {
        throw new AggregateError(
          [handlerError, error],
          `onError da InboundQueue lançou (chat ${chatId})`,
        );
      });
    }
  }
}
