// Contrato do barramento de eventos (M1-7, plano §6.4). O M1-7 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

import type { Message, MessageOf, MessageType } from '#message/types.ts';
import type { TransportEvents, Unsubscribe } from '#transport/types.ts';

/** Falha isolada de um plugin; o kernel emite e segue rodando os demais (ADR 0005). */
export interface PluginErrorEvent {
  readonly plugin: string;
  /** Onde a falha aconteceu. */
  readonly phase: 'listener' | 'command' | 'setup' | 'teardown' | 'scheduler';
  /** Evento ou job em processamento, quando houver. */
  readonly event: string | null;
  readonly error: unknown;
  readonly timedOut: boolean;
}

/** `message:<type>`: a mesma mensagem de `message`, já estreitada pelo tipo. */
export type MessageTypeEvents = { readonly [K in MessageType as `message:${K}`]: MessageOf<K> };

/** Todos os eventos que plugins podem assinar. */
export interface BotEvents extends TransportEvents, MessageTypeEvents {
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
 * O que um listener recebe. Todos os listeners de uma mesma emissão compartilham o mesmo
 * objeto: o `claim()` de um aparece no `claimed` dos demais.
 */
export interface ListenerContext<E extends BotEventName> {
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
}

/**
 * Campos do contexto além do que o barramento monta (`event`, `payload`, `claimed`, `claim`).
 * Quem emite os fornece; hoje é vazio, e o `Bot` (M1-16) acrescenta `reply` etc. ao
 * `ListenerContext` sem que o barramento precise conhecer a fila de saída.
 */
export type ListenerExtras<E extends BotEventName> = Omit<
  ListenerContext<E>,
  'event' | 'payload' | 'claimed' | 'claim'
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
