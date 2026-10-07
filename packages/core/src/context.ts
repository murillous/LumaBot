import type { Logger } from '#logger/types.ts';
import type { Message } from '#message/types.ts';
import type { Reply } from '#outbound/types.ts';

/**
 * Contexto de uma mensagem ao atravessar o pipeline (middlewares → comando → listeners).
 * Cada estágio estende com o que precisa; aqui fica só o que todos compartilham.
 */
export interface MessageContext {
  readonly message: Message;
  /**
   * Texto de trabalho (M1-16.2): o texto/legenda que os estágios seguintes leem. Começa igual a
   * `message.text` e um middleware pode reescrevê-lo (o `sanitize` trunca) sem tocar em
   * `message`, que é imutável. Ausente fora do kernel: quem lê usa `message.text`.
   */
  text?: string | null;
}

/**
 * Contexto que o `Bot` monta para cada mensagem: é o que middlewares, comandos e listeners de
 * mensagem recebem.
 */
export interface BotMessageContext extends MessageContext {
  /** Texto de trabalho; sem middleware que o reescreva, é `message.text`. */
  text: string | null;
  /** Responde no chat da mensagem, citando-a, pela fila de saída. */
  readonly reply: Reply;
  /** Logger com `chatId` (e `plugin`, em comandos e listeners) no contexto. */
  readonly log: Logger;
}
