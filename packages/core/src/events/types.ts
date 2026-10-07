// Contrato do barramento de eventos (M1-7, plano §6.4). O M1-7 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

import type { Logger } from '#logger/types.ts';
import type { Message, MessageOf, MessageType } from '#message/types.ts';
import type { Reply } from '#outbound/types.ts';
import type { TransportEvents, Unsubscribe } from '#transport/types.ts';

/** Falha isolada de um plugin; o kernel emite e segue rodando os demais (ADR 0005). */
export interface PluginErrorEvent {
  readonly plugin: string;
  /** Onde a falha aconteceu. `role`: a checagem de um papel custom que o plugin define. */
  readonly phase: 'listener' | 'command' | 'role' | 'setup' | 'teardown' | 'scheduler';
  /** Evento, comando, papel ou job em processamento, quando houver. */
  readonly event: string | null;
  readonly error: unknown;
  readonly timedOut: boolean;
}

/**
 * Comando que casou e consumiu a mensagem (ADR 0049). Só observação: a mensagem não vai a
 * `message`, então quem precisa ver toda mensagem (atividade, métricas) assina os dois.
 */
export interface CommandEvent {
  readonly plugin: string;
  readonly name: string;
  /** Token digitado, em minúsculas: o nome ou um dos aliases. */
  readonly invokedAs: string;
  /** `rejected`: papel ou `accepts` recusou. `failed`: o erro sai também em `plugin.error`. */
  readonly status: 'ran' | 'rejected' | 'failed';
  readonly message: Message;
}

/** `message:<type>`: a mesma mensagem de `message`, já estreitada pelo tipo. */
export type MessageTypeEvents = { readonly [K in MessageType as `message:${K}`]: MessageOf<K> };

/** Todos os eventos que plugins podem assinar. */
export interface BotEvents extends TransportEvents, MessageTypeEvents {
  command: CommandEvent;
  'plugin.error': PluginErrorEvent;
}

export type BotEventName = keyof BotEvents;

export interface ListenerOptions {
  /** Maior roda antes e vê o `claim()` primeiro. Empate: ordem de registro. Padrão: 0. */
  readonly priority?: number;
  /** Prazo do listener em ms antes de virar `plugin.error` com `timedOut`. Padrão: o do bus. */
  readonly timeoutMs?: number;
}

/** Filtro declarativo dos eventos cujo payload é uma `Message` (plano §6.3). */
export interface MessageFilter {
  /** Só mensagens que citam uma mensagem deste(s) tipo(s). */
  readonly quoted?: MessageType | readonly MessageType[];
}

/** Opções aceitas por `on()`: o filtro de mensagem só existe para eventos de mensagem. */
export type SubscribeOptions<E extends BotEventName> = ListenerOptions &
  (BotEvents[E] extends Message ? MessageFilter : unknown);

/**
 * Base do que um listener recebe. Todos os listeners de uma mesma emissão compartilham o mesmo
 * estado: o `claim()` de um aparece no `claimed` dos demais.
 */
export interface BaseListenerContext<E extends BotEventName> {
  readonly event: E;
  readonly payload: BotEvents[E];
  /**
   * Algum listener já reivindicou o evento. Os listeners começam em ordem de prioridade
   * decrescente, todos na mesma volta síncrona: quem lê e reivindica antes do primeiro `await`
   * vê o `claim()` dos de prioridade maior e esconde o seu dos de prioridade menor.
   */
  readonly claimed: boolean;
  /** Sinaliza aos listeners de prioridade menor que o evento já foi tratado. */
  claim(): void;
  /**
   * Aborta quando **este** listener estoura o prazo (`reason` = o erro de timeout). É por
   * listener: o de outro listener da mesma emissão não muda. Repasse a `fetch`/SDKs para parar
   * o trabalho a tempo (ADR 0033); depois do prazo, o `reply` deste contexto é recusado com
   * `ContextExpiredError`.
   */
  readonly signal: AbortSignal;
}

/**
 * Campos que o `Bot` acrescenta nos eventos cujo payload é uma `Message` (`message`,
 * `message:<tipo>`, `message.edited`), os mesmos do contexto de comando.
 */
export interface MessageListenerFields<M extends Message = Message> {
  /** A mesma mensagem de `payload`. */
  readonly message: M;
  /** Texto de trabalho (`ctx.text` depois dos middlewares; ver `BotMessageContext`). */
  readonly text: string | null;
  /** Responde no chat da mensagem, citando-a, pela fila de saída. */
  readonly reply: Reply;
  /** Reage à mensagem (ver `BotMessageContext.react`). */
  react(emoji: string | null): Promise<void>;
  /** Logger com `plugin` e `chatId` no contexto. */
  readonly log: Logger;
}

/**
 * O que um listener recebe: a base e, nos eventos de mensagem, os campos de
 * `MessageListenerFields`.
 */
export type ListenerContext<E extends BotEventName> = BaseListenerContext<E> &
  (BotEvents[E] extends Message ? MessageListenerFields<BotEvents[E]> : unknown);

/**
 * Campos do contexto além do que o barramento monta (`event`, `payload`, `claimed`, `claim`,
 * `signal`).
 * Quem emite os fornece — nos eventos de mensagem, o `Bot` entrega `MessageListenerFields` —
 * sem que o barramento precise conhecer a fila de saída.
 */
export type ListenerExtras<E extends BotEventName> = Omit<
  ListenerContext<E>,
  'event' | 'payload' | 'claimed' | 'claim' | 'signal'
>;

export type Listener<E extends BotEventName> = (ctx: ListenerContext<E>) => unknown;

/**
 * Assinatura de eventos exposta ao plugin (`ctx.events`). As opções podem vir no fim ou no
 * meio, como nos exemplos do plano: `on('message', { quoted: 'audio' }, listener)`.
 */
export interface EventSubscriber {
  on<E extends BotEventName>(
    event: E,
    listener: Listener<E>,
    options?: SubscribeOptions<E>,
  ): Unsubscribe;
  on<E extends BotEventName>(
    event: E,
    options: SubscribeOptions<E>,
    listener: Listener<E>,
  ): Unsubscribe;
}
