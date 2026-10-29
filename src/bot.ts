// O bot: compõe transport, storage e plugins e cuida do processo (o kernel do Bridger não tem
// runner). Nada de regra aqui: comportamento novo entra como plugin. Quem o sobe é o `main.ts`.

import { dirname, join } from 'node:path';
import { createBot, createHttp, createLogger, createSecretSet } from '@usebridger/core';
import { dashboard } from '@usebridger/plugin-dashboard';
import { sqlite } from '@usebridger/storage-sqlite';
import { baileys } from '@usebridger/transport-baileys';
import { plugins as apiPlugins } from '#api-plugins.ts';
import { AUDIT_RETENTION_DAYS, loadConfig, pluginEnv } from '#config.ts';
import { localSecret } from '#local-secret.ts';
import { ownerAudit } from '#owner-audit.ts';
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
// token do primeiro acesso, e guarda os dois ao lado do banco. Variável definida vence o
// arquivo.
const env = { ...pluginEnv() };
const dataDir = dirname(config.dbPath);
if (!env['BRIDGER_SECRET_KEY']) {
  env['BRIDGER_SECRET_KEY'] = (await localSecret(join(dataDir, 'secret.key'), 32)).value;
}

// O dashboard é cliente da API do core: login por e-mail e senha, e o `bootstrapToken` cria o
// primeiro owner. Depois do primeiro usuário, o token não vale mais.
let apiConfig = {};
if (config.dashboard) {
  const tokenFile = join(dataDir, 'bootstrap-token');
  const token = await localSecret(tokenFile, 24);
  // Fora do log, como o QR: o logger censuraria o valor. Só no primeiro boot; depois, o arquivo.
  process.stdout.write(
    `\nDashboard: http://${config.dashboard.hostname}:${config.dashboard.port}/plugins/dashboard/\n` +
      (token.created
        ? `Token do primeiro acesso (salvo em ${tokenFile}): ${token.value}\n`
        : `Token do primeiro acesso em ${tokenFile}\n`),
  );
  apiConfig = {
    http: createHttp(config.dashboard),
    api: { auth: { bootstrapToken: token.value } },
  };
}

const bot = createBot({
  transport: baileys({ pairing: config.pairing }),
  storage: sqlite({ path: config.dbPath }),
  logger: log,
  secrets,
  env,
  audit: { retentionDays: AUDIT_RETENTION_DAYS },
  ...apiConfig,
  plugins: [
    pairing((text) => process.stdout.write(text)),
    ...(config.dashboard ? [dashboard] : []),
    // O core já logou o motivo; sem `await`, o listener termina e o stop não espera por ele.
    giveUp(() => {
      process.exitCode = 1;
      bot.stop().catch((err: unknown) => log.error('falha ao encerrar', { err }));
    }),
    ownerAudit,
    ping,
    // `metrics` e `ai`, os que registram rotas na API (a lista também gera a spec do dashboard).
    ...apiPlugins,
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
