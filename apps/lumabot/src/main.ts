// Ponto de entrada do LumaBot: compõe o bot e cuida do processo (ADR 0034 — o kernel não tem
// runner). Nada de regra aqui: comportamento novo entra como plugin.

import { dirname, join } from 'node:path';
import { createBot, createHttp, createLogger, createSecretSet } from '@usebridger/core';
import { dashboard } from '@usebridger/plugin-dashboard';
import { metrics } from '@usebridger/plugin-metrics';
import { sqlite } from '@usebridger/storage-sqlite';
import { baileys } from '@usebridger/transport-baileys';
import { loadConfig, pluginEnv } from '#config.ts';
import { localSecret } from '#local-secret.ts';
import { ai } from '#plugins/ai/ai.ts';
import { aiMetrics } from '#plugins/ai-metrics/ai-metrics.ts';
import { download } from '#plugins/download/download.ts';
import { giveUp } from '#plugins/give-up.ts';
import { help } from '#plugins/help/help.ts';
import { luma } from '#plugins/luma/luma.ts';
import { pairing } from '#plugins/pairing.ts';
import { pdf } from '#plugins/pdf/pdf.ts';
import { ping } from '#plugins/ping.ts';
import { rank } from '#plugins/rank/rank.ts';
import { reminders } from '#plugins/reminders/reminders.ts';
import { resumo } from '#plugins/resumo/resumo.ts';
import { spontaneous } from '#plugins/spontaneous/spontaneous.ts';
import { sticker } from '#plugins/sticker/sticker.ts';
import { stickerConvert } from '#plugins/sticker-convert/sticker-convert.ts';
import { stickerText } from '#plugins/sticker-text/sticker-text.ts';
import { transcribe } from '#plugins/transcribe/transcribe.ts';
import { userNames } from '#plugins/user-names/user-names.ts';
import { utils } from '#plugins/utils/utils.ts';
import { webSearch } from '#plugins/web-search/web-search.ts';

const config = loadConfig();
// O app cria o logger para registrar também a falha de boot; o mesmo SecretSet vai para o bot,
// que censura nele os segredos da config de plugin. No terminal, linha legível; redirecionado
// (serviço, agregador), JSON.
const secrets = createSecretSet();
const log = createLogger({
  level: config.logLevel,
  format: process.stdout.isTTY ? 'pretty' : 'json',
  secrets,
  bindings: { app: 'lumabot' },
});

// Com o .env vazio, o app gera a chave mestra (sem ela o dashboard não grava as chaves da IA) e o
// token do dashboard, e guarda os dois ao lado do banco (ADR 0006). Variável definida vence o arquivo.
const env = { ...pluginEnv() };
const dataDir = dirname(config.dbPath);
if (!env['BRIDGER_SECRET_KEY']) {
  env['BRIDGER_SECRET_KEY'] = (await localSecret(join(dataDir, 'secret.key'), 32)).value;
}
if (config.dashboard && !env['BRIDGER_DASHBOARD__TOKEN']) {
  const tokenFile = join(dataDir, 'dashboard-token');
  const token = await localSecret(tokenFile, 24);
  env['BRIDGER_DASHBOARD__TOKEN'] = token.value;
  // Fora do log, como o QR: o logger censuraria o valor. Só no primeiro boot; depois, o arquivo.
  process.stdout.write(
    `\nDashboard: http://${config.dashboard.hostname}:${config.dashboard.port}/plugins/dashboard/\n` +
      (token.created
        ? `Token (salvo em ${tokenFile}): ${token.value}\n`
        : `Token em ${tokenFile}\n`),
  );
}

// `adminPlugins` libera as telas Plugins e Config.
const dashboardConfig = config.dashboard
  ? { http: createHttp(config.dashboard), adminPlugins: ['dashboard'] }
  : {};

const bot = createBot({
  transport: baileys({ pairing: config.pairing }),
  storage: sqlite({ path: config.dbPath }),
  logger: log,
  secrets,
  env,
  ...dashboardConfig,
  plugins: [
    pairing((text) => process.stdout.write(text)),
    ...(config.dashboard ? [dashboard] : []),
    // O core já logou o motivo; sem `await`, o listener termina e o stop não espera por ele.
    giveUp(() => {
      process.exitCode = 1;
      bot.stop().catch((err: unknown) => log.error('falha ao encerrar', { err }));
    }),
    ping,
    metrics,
    ai,
    aiMetrics,
    luma,
    spontaneous,
    resumo,
    transcribe,
    webSearch(),
    help,
    sticker,
    stickerText,
    stickerConvert,
    pdf(),
    reminders,
    download({ cookies: config.ytdlpCookies }),
    userNames,
    rank,
    utils,
  ],
});

// `once`: um segundo Ctrl+C cai no comportamento padrão e mata o processo se o stop travar.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info('encerrando', { signal });
    bot.stop().catch((err: unknown) => {
      log.error('falha ao encerrar', { err });
      process.exitCode = 1;
    });
  });
}

try {
  await bot.start();
} catch (err) {
  // O bot já rodou o shutdown e está em `stopped`; o processo sai sozinho.
  log.fatal('falha no boot', { err });
  process.exitCode = 1;
}
