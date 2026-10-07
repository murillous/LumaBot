// Contrato do barramento de eventos (M1-7, plano §6.4). O M1-7 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

import type { MessageOf, MessageType } from '#message/types.ts';
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
  /** Maior roda antes e vê o `claim()` primeiro. Padrão: 0. */
  readonly priority?: number;
  /** Prazo do listener em ms antes de virar `plugin.error` com `timedOut`. */
  readonly timeoutMs?: number;
}

/** O que um listener recebe. */
export interface ListenerContext<E extends BotEventName> {
  readonly event: E;
  readonly payload: BotEvents[E];
  /** Algum listener de prioridade maior já reivindicou o evento. */
  readonly claimed: boolean;
  /** Sinaliza aos listeners de prioridade menor que o evento já foi tratado. */
  claim(): void;
}

export type Listener<E extends BotEventName> = (ctx: ListenerContext<E>) => unknown;

/** Assinatura de eventos exposta ao plugin (`ctx.events`). */
export interface EventSubscriber {
  on<E extends BotEventName>(
    event: E,
    listener: Listener<E>,
    options?: ListenerOptions,
  ): Unsubscribe;
}
