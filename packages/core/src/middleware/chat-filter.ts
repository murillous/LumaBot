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
  const allow = options.allow === undefined ? null : new Set(options.allow);
  const block = new Set(options.block);
  return (ctx, next) => {
    const id = ctx.message.chat.id;
    if (block.has(id) || (allow !== null && !allow.has(id))) return undefined;
    return next();
  };
}
