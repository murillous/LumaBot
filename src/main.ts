// Ponto de entrada do LumaBot. No Windows, relança o processo com o `FONTCONFIG_FILE` para o
// emoji da legenda sair colorido (ver `fontconfigRelaunchEnv`); nos outros SOs, sobe o bot direto.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fontconfigRelaunchEnv } from '#config.ts';

// `src/main.ts` e `dist/main.mjs` ficam ambos um nível abaixo da raiz.
const relaunchEnv = fontconfigRelaunchEnv(
  fileURLToPath(new URL('../fontconfig/windows.conf', import.meta.url)),
);

if (relaunchEnv) {
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: relaunchEnv,
  });
  // O Ctrl+C chega também ao filho, que encerra o bot; o pai só espera e repassa o código.
  process.on('SIGINT', () => {
    // Ignorado: matar o filho aqui pularia o `bot.stop()` dele.
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
  child.on('error', (err) => {
    process.stderr.write(`falha ao relançar o bot com o FONTCONFIG_FILE: ${err.message}\n`);
    process.exitCode = 1;
  });
} else {
  await import('#bot.ts');
}
