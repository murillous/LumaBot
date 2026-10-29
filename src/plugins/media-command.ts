// Peças comuns aos comandos que convertem mídia (`sticker`, `sticker-convert`, `pdf`).

import type { CommandContext, Media, RejectContext } from '@usebridger/core';
import type { ActionStep, Track } from './action-metrics.ts';

/** Recusa do `accepts`: ❌ na mensagem e o texto de uso (`key` nas `messages` do plugin). */
export function usage(key: string) {
  return async (ctx: RejectContext): Promise<string> => {
    await ctx.react('❌');
    return ctx.t(key);
  };
}

/** Mídia do comando cujo `accepts` só lista tipos com mídia: o kernel já garantiu que existe. */
export function mediaOf(ctx: CommandContext): Media {
  if (!ctx.media) throw new Error(`!${ctx.command} rodou sem a mídia do accepts`);
  return ctx.media;
}

/**
 * Roda a conversão entre as reações de andamento (⏳, ✅ ou ❌), registrada pelo `track` do
 * plugin (log e métricas, com `kind`). Devolve o texto de erro para o comando responder, ou
 * `undefined` se deu certo. `errorKey` escolhe a mensagem pelo erro; o padrão é
 * `conversionError`, que todo plugin que usa o `attempt` declara.
 */
export async function attempt(
  ctx: CommandContext,
  track: Track,
  kind: string,
  work: (step: ActionStep) => Promise<void>,
  errorKey: (err: unknown) => string = () => 'conversionError',
): Promise<string | undefined> {
  await ctx.react('⏳');
  try {
    await track(ctx.log, kind, work);
  } catch (err) {
    // O `track` já registrou a falha.
    await ctx.react('❌');
    return ctx.t(errorKey(err));
  }
  await ctx.react('✅');
  return undefined;
}
