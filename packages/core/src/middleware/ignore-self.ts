import type { MessageContext } from '#context.ts';
import type { Middleware } from './pipeline.ts';

/** Descarta mensagens enviadas pela própria sessão do bot, evitando que ele responda a si mesmo. */
export function ignoreSelf(): Middleware<MessageContext> {
  return (ctx, next) => (ctx.message.fromMe ? undefined : next());
}
