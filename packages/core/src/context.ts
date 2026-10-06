import type { Message } from '#message/types.ts';

/**
 * Contexto de uma mensagem ao atravessar o pipeline (middlewares → comando → listeners).
 * Cada estágio estende com o que precisa; aqui fica só o que todos compartilham.
 */
export interface MessageContext {
  readonly message: Message;
}
