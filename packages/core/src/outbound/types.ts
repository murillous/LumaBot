// Contrato da fila de saída (M1-12, ADR 0019). O M1-12 completa este arquivo; os nomes
// exportados aqui são usados por outros módulos e não mudam.

import type { MessageKey, OutgoingContent, SendOptions } from '#transport/types.ts';

/** Prioridade na fila: comandos respondem antes de broadcasts. */
export type SendPriority = 'high' | 'normal' | 'low';

export interface OutboundSendOptions extends SendOptions {
  /** Padrão: `'normal'`. */
  readonly priority?: SendPriority;
}

/** Envio exposto ao plugin (`ctx.send`); passa sempre pela fila de saída. */
export interface Sender {
  send(
    chatId: string,
    content: OutgoingContent,
    options?: OutboundSendOptions,
  ): Promise<MessageKey>;
}
