// Implementação do `Logger` sobre pino (M1-14). O pino fica só aqui dentro: a API pública fala
// `Logger`/`LoggerOptions`, para trocar a implementação sem quebrar plugins.

import { type Logger as PinoLogger, pino, stdSerializers } from 'pino';
import type { LogFields, Logger, LogLevel } from './types.ts';

/** Para onde vão as linhas JSON (uma por chamada, terminada em `\n`). */
export interface LogDestination {
  write(line: string): void;
}

export interface LoggerOptions {
  /** Nível mínimo emitido. Padrão: `'info'`. */
  readonly level?: LogLevel;
  /** Destino das linhas. Padrão: stdout do processo. */
  readonly destination?: LogDestination;
  /** Campos presentes em toda linha deste logger e dos filhos (ex.: `{ app: 'meu-bot' }`). */
  readonly bindings?: LogFields;
  /**
   * Caminhos de campos trocados por `[REDACTED]`, na sintaxe de redação do pino
   * (`'password'`, `'config.apiKey'`, `'*.token'`). Pega o campo pelo nome, onde quer que o
   * valor esteja.
   */
  readonly redact?: readonly string[];
  /**
   * Valores secretos (ex.: campos `secret` da config) trocados por `[REDACTED]` em qualquer
   * lugar da linha: mensagem, campos, bindings, `err.message`/`err.stack`. Pega o valor, sob
   * qualquer nome de campo. Strings vazias são ignoradas.
   */
  readonly secrets?: readonly string[];
}

const CENSOR = '[REDACTED]';

/**
 * Logger estruturado em JSON. `child({ plugin })` e `child({ chatId })` acumulam contexto; o
 * campo `err` é serializado com `message`, `stack` e `cause`.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const destination = withSecretsCensored(options.destination, options.secrets);
  const root = pino(
    {
      level: options.level ?? 'info',
      // `errWithCause` mantém a `cause` como objeto estruturado (com stack própria), em vez de
      // concatená-la na mensagem como o serializer padrão.
      serializers: { err: stdSerializers.errWithCause },
      ...(options.redact && options.redact.length > 0
        ? { redact: { paths: [...options.redact], censor: CENSOR } }
        : {}),
    },
    destination,
  );
  return wrap(options.bindings ? root.child(options.bindings) : root);
}

// Censura por valor no texto já serializado: pega o segredo onde quer que ele apareça, o que a
// redação por caminho não garante (ex.: token interpolado na mensagem ou no `err.message`).
// Custo só em linha emitida, e só quando há segredo configurado.
function withSecretsCensored(
  destination: LogDestination | undefined,
  secrets: readonly string[] | undefined,
): LogDestination | undefined {
  // O segredo aparece na linha na forma escapada do JSON; o mais longo primeiro, para um segredo
  // que contém outro ser trocado inteiro.
  const needles = (secrets ?? [])
    .filter((secret) => secret.length > 0)
    .map((secret) => JSON.stringify(secret).slice(1, -1))
    .sort((a, b) => b.length - a.length);
  if (needles.length === 0) return destination;
  // Sem destino explícito, o padrão é o mesmo do pino: stdout.
  const target = destination ?? pino.destination(1);
  return {
    write(line: string): void {
      let censored = line;
      for (const needle of needles) censored = censored.replaceAll(needle, CENSOR);
      target.write(censored);
    },
  };
}

function wrap(log: PinoLogger): Logger {
  // Sem campos, chama o pino só com a mensagem: evita alocar um objeto vazio por linha. Em nível
  // desabilitado o método do pino já é um no-op, então nada é serializado.
  return {
    get level(): LogLevel {
      return log.level as LogLevel;
    },
    trace: (message, fields) => (fields ? log.trace(fields, message) : log.trace(message)),
    debug: (message, fields) => (fields ? log.debug(fields, message) : log.debug(message)),
    info: (message, fields) => (fields ? log.info(fields, message) : log.info(message)),
    warn: (message, fields) => (fields ? log.warn(fields, message) : log.warn(message)),
    error: (message, fields) => (fields ? log.error(fields, message) : log.error(message)),
    fatal: (message, fields) => (fields ? log.fatal(fields, message) : log.fatal(message)),
    child: (bindings) => wrap(log.child(bindings)),
  };
}

// Descarta a linha: é o propósito do logger no-op.
const noop = (): void => {
  return;
};

// Objeto congelado e sem recurso: compartilhá-lo não cria estado global mutável.
const NOOP_LOGGER: Logger = Object.freeze({
  level: 'silent',
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: (): Logger => NOOP_LOGGER,
});

/** Logger que descarta tudo, sem custo: para testes e como padrão quando ninguém configurou. */
export function createNoopLogger(): Logger {
  return NOOP_LOGGER;
}
