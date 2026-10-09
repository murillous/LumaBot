import type { MessageContext } from '#context.ts';
import type { Middleware } from './pipeline.ts';

/**
 * Descarta mensagens de outros bots (`sender.isBot`): no Discord e no Telegram, dois bots que
 * respondem um ao outro entram em loop (ADR 0057). Remetente sem `isBot` conta como pessoa.
 */
export function ignoreBots(): Middleware<MessageContext> {
  return (ctx, next) => (ctx.message.sender.isBot === true ? undefined : next());
}
