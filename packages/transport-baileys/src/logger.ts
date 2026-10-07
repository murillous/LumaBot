// O Baileys loga no formato do pino (`logger.info(obj, msg)`); o bot, no do core
// (`log.info(msg, fields)`). Este adapter traduz um para o outro, para as linhas do Baileys
// passarem pelo logger do bot, com a censura de segredos dele (ADR 0032).

import type { LogFields, Logger } from '@zapforge/core';
import type { SocketConfig } from 'baileys';

/** Logger que o Baileys aceita; o pacote não exporta o `ILogger` pela entrada principal. */
export type ILogger = SocketConfig['logger'];

type Method = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export function toBaileysLogger(log: Logger): ILogger {
  const write =
    (method: Method) =>
    (obj: unknown, msg?: string): void => {
      if (typeof obj === 'string') log[method](obj);
      else log[method](msg ?? '', toFields(obj));
    };
  return {
    // O Baileys consulta o nível para pular logs caros; lido a cada vez porque o logger da
    // fábrica só passa a valer no `start()`.
    get level(): string {
      return log.level;
    },
    child: (bindings) => toBaileysLogger(log.child(bindings)),
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
}

function toFields(obj: unknown): LogFields | undefined {
  if (obj instanceof Error) return { err: obj };
  if (typeof obj === 'object' && obj !== null) return obj as LogFields;
  return obj === undefined ? undefined : { value: obj };
}
