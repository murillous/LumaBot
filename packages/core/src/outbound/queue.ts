// Fila de saída anti-ban (ADR 0019). Todo envio do bot passa por aqui: intervalo mínimo global
// e por chat, prioridade (comando > broadcast), retry com backoff e humanização opcional.

import { assertCanSend, hasCapability, UnsupportedError } from '#transport/capabilities.ts';
import type {
  MessageKey,
  OutgoingContent,
  Presence,
  SendOptions,
  Transport,
} from '#transport/types.ts';
import type { OutboundSendOptions, Sender, SendPriority } from './types.ts';

/** O que a fila usa do transport. */
export type OutboundTransport = Pick<Transport, 'name' | 'capabilities' | 'send' | 'sendPresence'>;

export interface RetryOptions {
  /** Tentativas no total, contando a primeira. Padrão: 3. `1` desliga o retry. */
  readonly maxAttempts?: number;
  /** Espera antes da primeira re-tentativa, em ms; dobra a cada falha. Padrão: 1000. */
  readonly baseDelayMs?: number;
  /** Teto da espera, em ms. Padrão: 30000. */
  readonly maxDelayMs?: number;
  /**
   * Decide se a falha é transitória. Padrão: tudo, exceto `UnsupportedError` e erros com
   * `retryable: false` (convenção para o transport marcar falha permanente).
   */
  readonly isRetryable?: (error: unknown) => boolean;
}

export interface HumanizeOptions {
  /** Tempo "digitando" por caractere do texto, em ms. Padrão: 50. */
  readonly msPerChar?: number;
  /** Piso do tempo de presença, em ms. Padrão: 500. */
  readonly minMs?: number;
  /** Teto do tempo de presença, em ms; voz usa o teto. Padrão: 3000. */
  readonly maxMs?: number;
}

export interface OutboundQueueOptions {
  readonly transport: OutboundTransport;
  /** Intervalo mínimo entre dois envios quaisquer, em ms. Padrão: 300. */
  readonly globalIntervalMs?: number;
  /** Intervalo mínimo entre dois envios ao mesmo chat, em ms. Padrão: 1000. */
  readonly chatIntervalMs?: number;
  /**
   * Máximo de mensagens aguardando em cada prioridade, somando os chats. Padrão: 1000.
   * `Infinity` desliga. Por prioridade para um broadcast que encheu a fila não recusar respostas.
   */
  readonly maxPending?: number;
  readonly retry?: RetryOptions;
  /**
   * Presença `composing`/`recording` antes de texto/voz, se o transport tiver a capability
   * `presence`. Padrão: desligada.
   */
  readonly humanize?: boolean | HumanizeOptions;
  /**
   * Destino das falhas de presença, que não impedem o envio. Sem ele, a falha é descartada:
   * presença é cosmética e quem chamou `send` só se importa com a mensagem.
   */
  readonly onPresenceError?: (error: unknown, chatId: string) => void;
  /** Relógio em ms. Padrão: `performance.now` (monotônico). */
  readonly clock?: () => number;
  /** Fonte do jitter do backoff, em [0, 1). Padrão: `Math.random`. */
  readonly random?: () => number;
}

export interface OutboundQueueStats {
  /** Mensagens aguardando, inclusive as em espera de re-tentativa. */
  readonly pending: { readonly high: number; readonly normal: number; readonly low: number };
  /** Envios em andamento (presença + transport). */
  readonly inFlight: number;
  /** Chats com mensagem aguardando ou em andamento. */
  readonly activeChats: number;
  readonly sent: number;
  /** Envios que rejeitaram com o erro final. */
  readonly failed: number;
  readonly retries: number;
  /** Recusadas (fila cheia ou fechada) ou descartadas no `close({ drain: false })`. */
  readonly dropped: number;
}

export interface OutboundCloseOptions {
  /**
   * `true` (padrão): envia tudo o que já foi aceito antes de resolver. `false`: rejeita o que
   * aguarda e só espera os envios em andamento.
   */
  readonly drain?: boolean;
}

/** `send` recusado pela fila: backlog cheio ou fila fechada. */
export class OutboundQueueError extends Error {
  override readonly name = 'OutboundQueueError';
  readonly reason: 'full' | 'closed';

  constructor(reason: 'full' | 'closed', message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Índice nas estruturas por prioridade: 0 é a mais alta. */
type PriorityIndex = 0 | 1 | 2;

// Map e não objeto: prioridade vinda de JS sem tipos (ex.: `'toString'`) não casa por engano.
const PRIORITY_INDEX: ReadonlyMap<string, PriorityIndex> = new Map<SendPriority, PriorityIndex>([
  ['high', 0],
  ['normal', 1],
  ['low', 2],
]);

const DEFAULTS = {
  globalIntervalMs: 300,
  chatIntervalMs: 1000,
  maxPending: 1000,
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  msPerChar: 50,
  minMs: 500,
  maxMs: 3000,
} as const;

/** FIFO com remoção O(1) na frente; `Array.shift` é O(n) e o backlog pode ter milhares. */
class Fifo<T> {
  #items: (T | undefined)[] = [];
  #head = 0;

  get size(): number {
    return this.#items.length - this.#head;
  }

  push(item: T): void {
    this.#items.push(item);
  }

  peek(): T | undefined {
    return this.#items[this.#head];
  }

  shift(): T | undefined {
    if (this.#head >= this.#items.length) return undefined;
    const item = this.#items[this.#head];
    this.#items[this.#head] = undefined;
    this.#head++;
    if (this.#head === this.#items.length) {
      this.#items = [];
      this.#head = 0;
    } else if (this.#head >= 1024 && this.#head * 2 >= this.#items.length) {
      // Compacta só quando a parte consumida domina: custo amortizado O(1).
      this.#items = this.#items.slice(this.#head);
      this.#head = 0;
    }
    return item;
  }

  clear(): void {
    this.#items = [];
    this.#head = 0;
  }
}

interface Job {
  readonly content: OutgoingContent;
  readonly options: SendOptions | undefined;
  readonly priority: PriorityIndex;
  /** Tentativas já feitas. */
  attempts: number;
  readonly resolve: (key: MessageKey) => void;
  readonly reject: (error: unknown) => void;
}

interface ChatState {
  readonly id: string;
  readonly jobs: readonly [Fifo<Job>, Fifo<Job>, Fifo<Job>];
  /** Mensagem em espera de re-tentativa: sai antes das outras do chat, para não embaralhar. */
  retry: Job | null;
  pending: number;
  busy: boolean;
  /** Antes disso o chat não envia (intervalo por chat ou backoff). */
  readyAt: number;
  /** Senha da entrada válida numa lista de prontos; 0 = fora das listas. */
  ticket: number;
  listedPriority: PriorityIndex | -1;
  timer: NodeJS.Timeout | undefined;
}

interface ReadyEntry {
  readonly chat: ChatState;
  readonly ticket: number;
}

/**
 * Fila de saída de uma instância do bot. Chats diferentes enviam em paralelo, limitados só
 * pelo intervalo global; dentro do chat, uma mensagem por vez, em ordem por prioridade.
 */
export class OutboundQueue implements Sender {
  readonly #transport: OutboundTransport;
  readonly #globalIntervalMs: number;
  readonly #chatIntervalMs: number;
  readonly #maxPending: number;
  readonly #maxAttempts: number;
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #isRetryable: (error: unknown) => boolean;
  readonly #humanize: Required<HumanizeOptions> | null;
  readonly #onPresenceError: ((error: unknown, chatId: string) => void) | undefined;
  readonly #clock: () => number;
  readonly #random: () => number;

  // Só chats com mensagem aguardando ou em andamento: ao esvaziar, saem (o vazamento do
  // rateLimiter do legacy).
  readonly #chats = new Map<string, ChatState>();
  // Fim do intervalo por chat, em ordem de envio. Como o intervalo é fixo, a ordem de inserção
  // é a de vencimento e a limpeza para na primeira entrada válida.
  readonly #cooldowns = new Map<string, number>();
  // Chats prontos para enviar, um FIFO por prioridade. Remoção preguiçosa: entradas cujo
  // ticket não bate mais são descartadas ao chegar na frente.
  readonly #ready: readonly [Fifo<ReadyEntry>, Fifo<ReadyEntry>, Fifo<ReadyEntry>] = [
    new Fifo(),
    new Fifo(),
    new Fifo(),
  ];
  readonly #pendingBy: Record<PriorityIndex, number> = [0, 0, 0];
  #nextTicket = 1;
  #globalReadyAt = Number.NEGATIVE_INFINITY;
  #globalTimer: NodeJS.Timeout | undefined;
  #pumping = false;
  #idleWaiters: (() => void)[] = [];
  #closed = false;
  #discarding = false;
  #inFlight = 0;
  #sent = 0;
  #failed = 0;
  #retries = 0;
  #dropped = 0;

  constructor(options: OutboundQueueOptions) {
    const retry = options.retry ?? {};
    this.#transport = options.transport;
    this.#globalIntervalMs = nonNegative(
      'globalIntervalMs',
      options.globalIntervalMs ?? DEFAULTS.globalIntervalMs,
    );
    this.#chatIntervalMs = nonNegative(
      'chatIntervalMs',
      options.chatIntervalMs ?? DEFAULTS.chatIntervalMs,
    );
    const maxPending = options.maxPending ?? DEFAULTS.maxPending;
    if (
      !(
        maxPending === Number.POSITIVE_INFINITY ||
        (Number.isInteger(maxPending) && maxPending >= 0)
      )
    ) {
      throw new RangeError(
        `maxPending deve ser inteiro >= 0 ou Infinity (recebido: ${maxPending})`,
      );
    }
    this.#maxPending = maxPending;
    const maxAttempts = retry.maxAttempts ?? DEFAULTS.maxAttempts;
    if (!(Number.isInteger(maxAttempts) && maxAttempts >= 1)) {
      throw new RangeError(`retry.maxAttempts deve ser inteiro >= 1 (recebido: ${maxAttempts})`);
    }
    this.#maxAttempts = maxAttempts;
    this.#baseDelayMs = nonNegative('retry.baseDelayMs', retry.baseDelayMs ?? DEFAULTS.baseDelayMs);
    this.#maxDelayMs = nonNegative('retry.maxDelayMs', retry.maxDelayMs ?? DEFAULTS.maxDelayMs);
    this.#isRetryable = retry.isRetryable ?? isTransient;
    this.#humanize = resolveHumanize(options.humanize, options.transport);
    this.#onPresenceError = options.onPresenceError;
    this.#clock = options.clock ?? (() => performance.now());
    this.#random = options.random ?? Math.random;
  }

  /**
   * Enfileira o envio. Resolve com a chave da mensagem criada ou rejeita com o erro final
   * (capability ausente, fila cheia/fechada ou falha do transport após as re-tentativas).
   */
  send(
    chatId: string,
    content: OutgoingContent,
    options?: OutboundSendOptions,
  ): Promise<MessageKey> {
    if (this.#closed) {
      this.#dropped++;
      return Promise.reject(
        new OutboundQueueError('closed', `fila de saída fechada: envio para ${chatId} recusado`),
      );
    }
    const priority = PRIORITY_INDEX.get(options?.priority ?? 'normal');
    if (priority === undefined) {
      return Promise.reject(new TypeError(`prioridade inválida: ${String(options?.priority)}`));
    }
    let sendOptions: SendOptions | undefined;
    if (options !== undefined) {
      const { priority: _priority, ...rest } = options;
      sendOptions = rest;
    }
    try {
      // Capability ausente nunca vira tentativa: falha já, sem ocupar a fila.
      assertCanSend(this.#transport, content, sendOptions);
    } catch (error) {
      return Promise.reject(error);
    }
    // Limite por prioridade: `low`/`normal` acumulados nunca tiram a vaga de uma `high`.
    if (this.#pendingBy[priority] >= this.#maxPending) {
      this.#dropped++;
      return Promise.reject(
        new OutboundQueueError(
          'full',
          `fila de saída cheia (${this.#maxPending} aguardando com prioridade ${String(options?.priority ?? 'normal')}): envio para ${chatId} recusado`,
        ),
      );
    }

    return new Promise<MessageKey>((resolve, reject) => {
      const job: Job = { content, options: sendOptions, priority, attempts: 0, resolve, reject };
      const chat = this.#chatFor(chatId);
      chat.jobs[priority].push(job);
      chat.pending++;
      this.#pendingBy[priority]++;
      this.#wake(chat, this.#clock());
      this.#pump();
    });
  }

  stats(): OutboundQueueStats {
    return {
      pending: {
        high: this.#pendingBy[0],
        normal: this.#pendingBy[1],
        low: this.#pendingBy[2],
      },
      inFlight: this.#inFlight,
      activeChats: this.#chats.size,
      sent: this.#sent,
      failed: this.#failed,
      retries: this.#retries,
      dropped: this.#dropped,
    };
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** Resolve quando não há mensagem aguardando nem em andamento. Não impede novos envios. */
  onIdle(): Promise<void> {
    if (this.#chats.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  /**
   * Para de aceitar envios (novos rejeitam com `OutboundQueueError` `'closed'`) e resolve quando
   * a fila esvaziar. Pode ser chamado de novo com `drain: false` para abortar uma drenagem.
   */
  close(options: OutboundCloseOptions = {}): Promise<void> {
    this.#closed = true;
    if (options.drain === false) this.#discard();
    return this.onIdle();
  }

  #chatFor(chatId: string): ChatState {
    const existing = this.#chats.get(chatId);
    if (existing !== undefined) return existing;
    const chat: ChatState = {
      id: chatId,
      jobs: [new Fifo(), new Fifo(), new Fifo()],
      retry: null,
      pending: 0,
      busy: false,
      readyAt: this.#cooldowns.get(chatId) ?? Number.NEGATIVE_INFINITY,
      ticket: 0,
      listedPriority: -1,
      timer: undefined,
    };
    this.#chats.set(chatId, chat);
    return chat;
  }

  /** Coloca o chat na lista de prontos ou agenda quando ele ficará pronto. */
  #wake(chat: ChatState, now: number): void {
    if (chat.busy || chat.pending === 0) return;
    if (now < chat.readyAt) {
      chat.timer ??= setTimeout(() => {
        chat.timer = undefined;
        this.#wake(chat, this.#clock());
        this.#pump();
      }, chat.readyAt - now);
      return;
    }
    const priority = chat.retry !== null ? chat.retry.priority : firstNonEmpty(chat.jobs);
    if (priority === -1 || (chat.ticket !== 0 && chat.listedPriority === priority)) return;
    // Nova senha invalida a entrada antiga (ex.: chegou mensagem de prioridade maior).
    chat.ticket = this.#nextTicket++;
    chat.listedPriority = priority;
    this.#ready[priority].push({ chat, ticket: chat.ticket });
  }

  #pump(): void {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      for (;;) {
        const list = this.#peekReady();
        if (list === undefined) return;
        const now = this.#clock();
        if (now < this.#globalReadyAt) {
          this.#globalTimer ??= setTimeout(() => {
            this.#globalTimer = undefined;
            this.#pump();
          }, this.#globalReadyAt - now);
          return;
        }
        const entry = list.shift();
        if (entry !== undefined) this.#dispatch(entry.chat, now);
      }
    } finally {
      this.#pumping = false;
    }
  }

  /** Lista de maior prioridade com entrada válida na frente; descarta as obsoletas. */
  #peekReady(): Fifo<ReadyEntry> | undefined {
    for (const list of this.#ready) {
      for (let entry = list.peek(); entry !== undefined; entry = list.peek()) {
        if (entry.ticket === entry.chat.ticket) return list;
        list.shift();
      }
    }
    return undefined;
  }

  #dispatch(chat: ChatState, now: number): void {
    let job = chat.retry;
    if (job !== null) {
      chat.retry = null;
    } else {
      const priority = firstNonEmpty(chat.jobs);
      job = priority === -1 ? null : (chat.jobs[priority].shift() ?? null);
      // Inalcançável: só chat com mensagem entra na lista de prontos.
      if (job === null) return;
    }
    chat.ticket = 0;
    chat.busy = true;
    chat.pending--;
    this.#pendingBy[job.priority]--;
    this.#inFlight++;
    this.#globalReadyAt = now + this.#globalIntervalMs;
    chat.readyAt = now + this.#chatIntervalMs;
    this.#rememberCooldown(chat.id, chat.readyAt, now);
    void this.#execute(chat, job);
  }

  #rememberCooldown(chatId: string, readyAt: number, now: number): void {
    for (const [id, until] of this.#cooldowns) {
      if (until > now) break;
      this.#cooldowns.delete(id);
    }
    this.#cooldowns.delete(chatId);
    this.#cooldowns.set(chatId, readyAt);
  }

  async #execute(chat: ChatState, job: Job): Promise<void> {
    job.attempts++;
    try {
      if (this.#humanize !== null) await this.#simulate(chat.id, job.content, this.#humanize);
      const key = await this.#transport.send(chat.id, job.content, job.options);
      this.#sent++;
      job.resolve(key);
    } catch (error) {
      this.#handleFailure(chat, job, error);
    }
    this.#inFlight--;
    chat.busy = false;
    if (chat.pending === 0) {
      clearTimeout(chat.timer);
      this.#chats.delete(chat.id);
      this.#notifyIdle();
    } else {
      this.#wake(chat, this.#clock());
    }
    this.#pump();
  }

  #handleFailure(chat: ChatState, job: Job, error: unknown): void {
    let retryable: boolean;
    try {
      retryable = !this.#discarding && job.attempts < this.#maxAttempts && this.#isRetryable(error);
    } catch (hookError) {
      this.#failed++;
      job.reject(new AggregateError([hookError, error], 'retry.isRetryable lançou'));
      return;
    }
    if (!retryable) {
      this.#failed++;
      job.reject(error);
      return;
    }
    this.#retries++;
    chat.retry = job;
    chat.pending++;
    this.#pendingBy[job.priority]++;
    chat.readyAt = Math.max(chat.readyAt, this.#clock() + this.#backoff(job.attempts));
  }

  /** Exponencial com teto e jitter "igual": metade fixa, metade aleatória. */
  #backoff(failures: number): number {
    const capped = Math.min(this.#maxDelayMs, this.#baseDelayMs * 2 ** (failures - 1));
    return capped / 2 + (capped / 2) * this.#random();
  }

  async #simulate(
    chatId: string,
    content: OutgoingContent,
    humanize: Required<HumanizeOptions>,
  ): Promise<void> {
    let presence: Presence;
    let ms: number;
    if (content.type === 'text') {
      presence = 'composing';
      ms = Math.min(
        humanize.maxMs,
        Math.max(humanize.minMs, content.text.length * humanize.msPerChar),
      );
    } else if (content.type === 'voice') {
      presence = 'recording';
      ms = humanize.maxMs;
    } else {
      return;
    }
    try {
      await this.#transport.sendPresence(chatId, presence);
    } catch (error) {
      // Presença é cosmética: a falha vai para o destino configurado e o envio segue já.
      this.#onPresenceError?.(error, chatId);
      return;
    }
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  #discard(): void {
    this.#discarding = true;
    const error = (): OutboundQueueError =>
      new OutboundQueueError('closed', 'fila de saída fechada sem drenar: envio descartado');
    for (const chat of this.#chats.values()) {
      const waiting: Job[] = chat.retry === null ? [] : [chat.retry];
      for (const fifo of chat.jobs) {
        for (let job = fifo.shift(); job !== undefined; job = fifo.shift()) waiting.push(job);
      }
      for (const job of waiting) {
        this.#dropped++;
        job.reject(error());
      }
      chat.retry = null;
      chat.pending = 0;
      chat.ticket = 0;
      clearTimeout(chat.timer);
      chat.timer = undefined;
      if (!chat.busy) this.#chats.delete(chat.id);
    }
    this.#pendingBy[0] = 0;
    this.#pendingBy[1] = 0;
    this.#pendingBy[2] = 0;
    for (const list of this.#ready) list.clear();
    clearTimeout(this.#globalTimer);
    this.#globalTimer = undefined;
    this.#notifyIdle();
  }

  #notifyIdle(): void {
    if (this.#chats.size > 0 || this.#idleWaiters.length === 0) return;
    const waiters = this.#idleWaiters;
    this.#idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}

function firstNonEmpty(jobs: ChatState['jobs']): PriorityIndex | -1 {
  if (jobs[0].size > 0) return 0;
  if (jobs[1].size > 0) return 1;
  return jobs[2].size > 0 ? 2 : -1;
}

function nonNegative(name: string, value: number): number {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} deve ser um número finito >= 0 (recebido: ${value})`);
  }
  return value;
}

function isTransient(error: unknown): boolean {
  if (error instanceof UnsupportedError) return false;
  return !(
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error &&
    error.retryable === false
  );
}

function resolveHumanize(
  option: boolean | HumanizeOptions | undefined,
  transport: OutboundTransport,
): Required<HumanizeOptions> | null {
  // Capabilities são fixas na vida do transport: decide uma vez, não a cada envio.
  if (option === undefined || option === false || !hasCapability(transport, 'presence')) {
    return null;
  }
  const custom = option === true ? {} : option;
  return {
    msPerChar: nonNegative('humanize.msPerChar', custom.msPerChar ?? DEFAULTS.msPerChar),
    minMs: nonNegative('humanize.minMs', custom.minMs ?? DEFAULTS.minMs),
    maxMs: nonNegative('humanize.maxMs', custom.maxMs ?? DEFAULTS.maxMs),
  };
}
