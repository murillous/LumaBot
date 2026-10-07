import type { MessageContext } from '#context.ts';
import type { Middleware } from './pipeline.ts';

export interface ChatFilterOptions {
  /** Se informado, só esses chats (IDs nativos) passam. */
  readonly allow?: Iterable<string>;
  /** Chats que nunca passam. Vence a `allow` quando o chat está nas duas. */
  readonly block?: Iterable<string>;
}

/** Allow/blocklist de chats (ADR 0024). As listas são copiadas na criação. */
export function chatFilter(options: ChatFilterOptions): Middleware<MessageContext> {
  const allowed = chatAllowed(options);
  return (ctx, next) => (allowed(ctx.message.chat.id) ? next() : undefined);
}

/**
 * A regra do `chatFilter` sem o middleware: o bot a aplica também aos eventos que não são
 * mensagem (ADR 0038). As listas são copiadas na criação.
 */
export function chatAllowed(options: ChatFilterOptions): (chatId: string) => boolean {
  const allow = options.allow === undefined ? null : new Set(options.allow);
  const block = new Set(options.block);
  return (id) => !block.has(id) && (allow === null || allow.has(id));
}
