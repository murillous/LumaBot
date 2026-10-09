// Única camada que lê `process.env` (regra do Biome). O app recebe a config já pronta; os
// testes injetam o ambiente.

import type { ConfigEnv, LogLevel } from '@zapforge/core';
import type { BaileysPairing } from '@zapforge/transport-baileys';

export interface AppConfig {
  /** Arquivo SQLite: dados dos plugins e credenciais do WhatsApp. */
  readonly dbPath: string;
  readonly pairing: BaileysPairing;
  readonly logLevel: LogLevel;
}

const LOG_LEVELS: readonly LogLevel[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
];

/**
 * Lê a config do app das variáveis `LUMABOT_*`. Lança com o nome da variável quando o valor é
 * inválido; o telefone de pareamento é validado pelo `baileys()`.
 */
export function loadConfig(env: ConfigEnv = process.env): AppConfig {
  const logLevel = env['LUMABOT_LOG_LEVEL'] || 'info';
  if (!LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw new Error(`LUMABOT_LOG_LEVEL inválido: "${logLevel}" (use ${LOG_LEVELS.join(', ')})`);
  }
  const phone = env['LUMABOT_PAIRING_PHONE'];
  return {
    dbPath: env['LUMABOT_DB'] || 'data/lumabot.sqlite',
    pairing: phone ? { phone } : 'qr',
    logLevel: logLevel as LogLevel,
  };
}
