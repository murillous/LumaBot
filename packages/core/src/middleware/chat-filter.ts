import type { MessageContext } from '#context.ts';
import type { Chat } from '#message/types.ts';
import type { Middleware } from './pipeline.ts';

export interface ChatFilterOptions {
  /**
   * Se informado, só esses chats passam. Vale o ID do chat ou o do espaço (`parentId`): liberar
   * um servidor libera todos os canais dele.
   */
  readonly allow?: Iterable<string>;
  /**
   * Chats que nunca passam, pelo ID do chat ou do espaço. Vence a `allow`: um canal bloqueado
   * fica de fora mesmo com o servidor dele liberado.
   */
  readonly block?: Iterable<string>;
}

/** Allow/blocklist de chats (ADR 0024). As listas são copiadas na criação. */
export function chatFilter(options: ChatFilterOptions): Middleware<MessageContext> {
  const allowed = chatAllowed(options);
  return (ctx, next) => (allowed(ctx.message.chat) ? next() : undefined);
}

/**
 * A regra do `chatFilter` sem o middleware: o bot a aplica também aos eventos que não são
 * mensagem (ADR 0038). As listas são copiadas na criação.
 */
export function chatAllowed(
  options: ChatFilterOptions,
): (chat: Pick<Chat, 'id' | 'parentId'>) => boolean {
  const allow = options.allow === undefined ? null : new Set(options.allow);
  const block = new Set(options.block);
  return ({ id, parentId }) => {
    const inParent = (list: Set<string>) => parentId !== undefined && list.has(parentId);
    if (block.has(id) || inParent(block)) return false;
    return allow === null || allow.has(id) || inParent(allow);
  };
}
