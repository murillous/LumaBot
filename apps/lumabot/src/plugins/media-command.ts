// Peças comuns aos comandos que convertem mídia (`sticker`, `sticker-convert`, `pdf`).

import type { CommandContext, LogFields, RejectContext } from '@usebridger/core';

/** Recusa do `accepts`: ❌ na mensagem e o texto de uso (`key` nas `messages` do plugin). */
export function usage(key: string) {
  return async (ctx: RejectContext): Promise<string> => {
    await ctx.react('❌');
    return ctx.t(key);
  };
}

/** Primeiro link do texto, sem a pontuação colada no fim; `null` se não houver. */
export function urlIn(text: string | null | undefined): string | null {
  const url = text && /https?:\/\/\S+/i.exec(text)?.[0];
  return url ? url.replace(/[.,!?'"]+$/, '') : null;
}

export interface AttemptOptions {
  /** Mensagem pelo erro; o padrão é `conversionError`, que todo plugin sem `errorKey` declara. */
  readonly errorKey?: (err: unknown) => string;
  /** Campos a mais no log da falha (o link, por exemplo). */
  readonly fields?: LogFields;
}

/**
 * Roda a conversão entre as reações de andamento (⏳, ✅ ou ❌). Devolve o texto de erro para
 * o comando responder, ou `undefined` se deu certo.
 */
export async function attempt(
  ctx: CommandContext,
  work: () => Promise<void>,
  { errorKey = () => 'conversionError', fields }: AttemptOptions = {},
): Promise<string | undefined> {
  await ctx.react('⏳');
  try {
    await work();
  } catch (err) {
    ctx.log.error('falha ao processar mídia', { ...fields, err });
    await ctx.react('❌');
    return ctx.t(errorKey(err));
  }
  await ctx.react('✅');
  return undefined;
}
