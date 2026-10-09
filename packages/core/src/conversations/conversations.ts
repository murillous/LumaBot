// Resposta esperada (ADR 0060): o handler pergunta, registra qual passo trata a próxima mensagem
// daquela pessoa naquele chat e termina, sem segurar o chat na fila de entrada (ADR 0042). O
// estado fica em memória; o passo é nomeado e o `data` é JSON para que uma espera possa ir ao
// storage depois sem mudar a API.

import type { BotMessageContext } from '#context.ts';
import { ExecutionTimeoutError } from '#deadline.ts';
import type { JsonValue } from '#storage/types.ts';

/** Validade padrão de uma espera: 5 minutos. */
export const DEFAULT_REPLY_TTL_MS: number = 5 * 60_000;

/** Maior atraso que o `setTimeout` aceita; acima disso ele dispara na hora. */
const MAX_TTL_MS = 2_147_483_647;

export interface ExpectReplyOptions {
  /** Estado do fluxo, entregue ao passo em `ctx.data`. Padrão: `null`. */
  readonly data?: JsonValue;
  /** Validade da espera em ms. Padrão: 5 minutos. Expirada, some sem aviso. */
  readonly ttlMs?: number;
}

/**
 * Registra que a próxima mensagem do remetente, neste chat, vai para o passo `step` deste plugin.
 * Uma espera por (chat, remetente): registrar de novo, deste plugin ou de outro, troca a
 * anterior. Lança `TypeError` se o plugin não definiu o passo e `RangeError` com `ttlMs`
 * inválido.
 */
export type ExpectReply = (step: string, options?: ExpectReplyOptions) => void;

/** Contexto do passo: o da mensagem que respondeu, com o estado guardado na espera. */
export interface StepContext extends BotMessageContext {
  /** Nome do passo que está rodando. */
  readonly step: string;
  /** O `data` da espera; `null` se ela não trouxe nenhum. */
  readonly data: JsonValue;
  /**
   * Aborta quando o passo estoura o prazo (`timeouts.commandMs`), com `reason` =
   * `StepTimeoutError`, como o `signal` do comando.
   */
  readonly signal: AbortSignal;
  /** Encadeia a pergunta seguinte do fluxo (ver `ExpectReply`). */
  readonly expectReply: ExpectReply;
}

export type StepHandler = (ctx: StepContext) => unknown;

/** Passos de conversa do plugin (`ctx.conversations`). */
export interface Conversations {
  /**
   * Define o passo `step`, que trata a resposta registrada com `expectReply(step)`. Nome vazio ou
   * repetido no mesmo plugin lança `TypeError`. O passo e as esperas dele saem no
   * teardown/reload.
   */
  define(step: string, handler: StepHandler): void;
}

/** O passo estourou o prazo. Vai em `plugin.error` com `phase: 'step'` e `timedOut: true`. */
export class StepTimeoutError extends ExecutionTimeoutError {
  override readonly name: string = 'StepTimeoutError';
  readonly step: string;

  constructor(plugin: string, step: string, timeoutMs: number) {
    super(plugin, `passo "${step}"`, timeoutMs);
    this.step = step;
  }
}

/** Passo como o kernel o roda: já com prazo e visão do plugin, montados por quem o define. */
export type KernelStep<C> = (ctx: C, data: JsonValue) => unknown;

/** Espera consumida por `take`: o que o bot precisa para rodar o passo. */
export interface PendingReply<C> {
  readonly plugin: string;
  readonly step: string;
  readonly data: JsonValue;
  readonly run: KernelStep<C>;
}

interface Wait {
  readonly plugin: string;
  readonly step: string;
  readonly data: JsonValue;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Esperas e passos de todos os plugins de um bot (estado no closure do bot, ADR 0004). */
export class ConversationRegistry<C> {
  readonly #steps = new Map<string, Map<string, KernelStep<C>>>();
  readonly #waits = new Map<string, Wait>();
  #closed = false;

  define(plugin: string, step: string, run: KernelStep<C>): void {
    if (typeof step !== 'string' || step.length === 0) {
      throw new TypeError(`plugin "${plugin}": nome de passo vazio`);
    }
    let steps = this.#steps.get(plugin);
    if (steps === undefined) {
      steps = new Map();
      this.#steps.set(plugin, steps);
    }
    if (steps.has(step)) throw new TypeError(`plugin "${plugin}": passo "${step}" já definido`);
    steps.set(step, run);
  }

  expect(
    plugin: string,
    chatId: string,
    senderId: string,
    step: string,
    options: ExpectReplyOptions = {},
  ): void {
    if (!this.#steps.get(plugin)?.has(step)) {
      throw new TypeError(
        `plugin "${plugin}": expectReply("${step}") sem o passo; defina-o com ` +
          'ctx.conversations.define',
      );
    }
    const ttlMs = options.ttlMs ?? DEFAULT_REPLY_TTL_MS;
    if (!(Number.isFinite(ttlMs) && ttlMs > 0 && ttlMs <= MAX_TTL_MS)) {
      throw new RangeError(`plugin "${plugin}": ttlMs de expectReply inválido: ${ttlMs}`);
    }
    // Depois do shutdown não há quem responda, e o timer sobreviveria ao `stop()`.
    if (this.#closed) return;
    const key = waitKey(chatId, senderId);
    this.#drop(key);
    const timer = setTimeout(() => {
      if (this.#waits.get(key)?.timer === timer) this.#waits.delete(key);
    }, ttlMs);
    // A espera não mantém o processo vivo: ela só importa se chegar mensagem.
    timer.unref?.();
    this.#waits.set(key, { plugin, step, data: options.data ?? null, timer });
  }

  /**
   * Retira a espera do remetente no chat, se houver. Quem chama decide se roda o passo ou, com um
   * comando digitado, só a descarta. O mapa vazio sai sem montar a chave: o caminho de cada
   * mensagem não paga nada sem conversa aberta.
   */
  take(chatId: string, senderId: string): PendingReply<C> | undefined {
    if (this.#waits.size === 0) return undefined;
    const key = waitKey(chatId, senderId);
    const wait = this.#waits.get(key);
    if (wait === undefined) return undefined;
    this.#drop(key);
    // O passo existe: o `removePlugin` tira passos e esperas juntos.
    const run = this.#steps.get(wait.plugin)?.get(wait.step) as KernelStep<C>;
    return { plugin: wait.plugin, step: wait.step, data: wait.data, run };
  }

  /** Tira os passos e as esperas do plugin (teardown/reload), com os timers. */
  removePlugin(plugin: string): void {
    this.#steps.delete(plugin);
    for (const [key, wait] of this.#waits) {
      if (wait.plugin === plugin) this.#drop(key);
    }
  }

  /** Descarta tudo e recusa esperas novas: nenhum timer sobrevive ao shutdown. */
  close(): void {
    this.#closed = true;
    for (const key of [...this.#waits.keys()]) this.#drop(key);
    this.#steps.clear();
  }

  #drop(key: string): void {
    const wait = this.#waits.get(key);
    if (wait === undefined) return;
    clearTimeout(wait.timer);
    this.#waits.delete(key);
  }
}

// NUL não aparece em ID de chat nem de contato de nenhuma plataforma: a chave não colide.
const waitKey = (chatId: string, senderId: string): string => `${chatId}\u0000${senderId}`;
