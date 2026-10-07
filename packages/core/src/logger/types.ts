// Contrato do logger (M1-14). Plugins e o kernel dependem só desta interface; a implementação
// com pino fica atrás dela, para o core não vazar o pino na API pública.

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/** Campos estruturados de uma linha de log (ex.: `{ chatId, err }`). */
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  readonly level: LogLevel;
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  fatal(message: string, fields?: LogFields): void;
  /** Logger filho que acrescenta `bindings` (ex.: `{ plugin }`, `{ chatId }`) a toda linha. */
  child(bindings: LogFields): Logger;
}
