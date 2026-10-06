import type { MessageContext } from '#context.ts';
import type { Middleware } from './pipeline.ts';

/** Campos do remetente/texto já limitados pelo middleware `sanitize`. */
export interface SanitizedFields {
  readonly text: string | null;
  readonly senderName: string | null;
}

/**
 * Contexto com o resultado de `sanitize`. `ctx.message` é imutável (contrato compartilhado),
 * então o texto limpo fica ao lado dele; sem o middleware, `sanitized` fica ausente.
 */
export interface SanitizedContext extends MessageContext {
  sanitized?: SanitizedFields;
}

export interface SanitizeOptions {
  /** Padrão `4096`, o limite do LumaBot. */
  readonly maxTextLength?: number;
  /** Padrão `100`. */
  readonly maxSenderNameLength?: number;
}

/**
 * Trunca texto/legenda e nome do remetente: um texto gigante custa CPU em todo estágio
 * seguinte (parse de comando, regex de listeners, prompt de IA) e um nome gigante polui logs.
 */
export function sanitize(options: SanitizeOptions = {}): Middleware<SanitizedContext> {
  const maxText = options.maxTextLength ?? 4096;
  const maxName = options.maxSenderNameLength ?? 100;
  for (const [name, value] of [
    ['maxTextLength', maxText],
    ['maxSenderNameLength', maxName],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} deve ser um inteiro >= 1: ${value}`);
    }
  }
  return (ctx, next) => {
    const { message } = ctx;
    ctx.sanitized = {
      text: truncate(message.text, maxText),
      senderName: truncate(message.sender.name, maxName),
    };
    return next();
  };
}

function truncate(value: string | null, max: number): string | null {
  if (value === null || value.length <= max) return value;
  // Não corta um par surrogate ao meio (emoji etc.): sobraria um caractere inválido.
  const code = value.charCodeAt(max - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? max - 1 : max;
  return value.slice(0, end);
}
