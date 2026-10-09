// Ponto de entrada do LumaBot: compõe o bot e cuida do processo (ADR 0034 — o kernel não tem
// runner). Nada de regra aqui: comportamento novo entra como plugin.

import { createBot, createLogger, createSecretSet } from '@zapforge/core';
import { sqlite } from '@zapforge/storage-sqlite';
import { baileys } from '@zapforge/transport-baileys';
import { loadConfig } from '#config.ts';
import { pairing } from '#plugins/pairing.ts';
import { ping } from '#plugins/ping.ts';

const config = loadConfig();
// O app cria o logger para registrar também a falha de boot; o mesmo SecretSet vai para o bot,
// que censura nele os segredos da config de plugin.
const secrets = createSecretSet();
const log = createLogger({ level: config.logLevel, secrets, bindings: { app: 'lumabot' } });

const bot = createBot({
  transport: baileys({ pairing: config.pairing }),
  storage: sqlite({ path: config.dbPath }),
  logger: log,
  secrets,
  plugins: [pairing((text) => process.stdout.write(text)), ping],
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
