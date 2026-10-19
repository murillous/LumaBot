// Única camada que lê `process.env` (regra do Biome). O app recebe a config já pronta; os
// testes injetam o ambiente.

import type { ConfigEnv, LogLevel } from '@usebridger/core';
import type { BaileysPairing } from '@usebridger/transport-baileys';

export interface AppConfig {
  /** Arquivo SQLite: dados dos plugins e credenciais do WhatsApp. */
  readonly dbPath: string;
  readonly pairing: BaileysPairing;
  readonly logLevel: LogLevel;
  /** Cookies (formato Netscape) que o plugin `download` repassa ao yt-dlp. */
  readonly ytdlpCookies?: string;
  /** Presente só com `LUMABOT_DASHBOARD_PORT`: sem porta, o app não abre HTTP nem carrega o dashboard. */
  readonly dashboard?: { readonly port: number; readonly hostname: string };
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
    ...(env['LUMABOT_YTDLP_COOKIES'] ? { ytdlpCookies: env['LUMABOT_YTDLP_COOKIES'] } : {}),
    ...loadDashboard(env),
  };
}

function loadDashboard(env: ConfigEnv): Pick<AppConfig, 'dashboard'> {
  const raw = env['LUMABOT_DASHBOARD_PORT'];
  if (!raw) return {};
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(`LUMABOT_DASHBOARD_PORT inválido: "${raw}" (use 1 a 65535)`);
  }
  // Só loopback por padrão: o core não faz TLS nem limita tentativas de login, então a porta só
  // sai da máquina por decisão explícita (atrás de um proxy HTTPS).
  return { dashboard: { port, hostname: env['LUMABOT_DASHBOARD_HOST'] || '127.0.0.1' } };
}
