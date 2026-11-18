// Roda os cenários de conversa da Luma (#466) contra o modelo real e mostra o que ela respondeu em
// cada um. É opcional e gasta tokens: o `pnpm test` roda os mesmos cenários com o modelo falso. O
// modelo de imagem segue falso: o que se julga é a escolha dela.
//
// A cadeia da IA e as chaves vêm de onde o bot as lê: o que o dashboard salvou no banco
// (`LUMABOT_DB`, chaves cifradas com `BRIDGER_SECRET_KEY` ou `data/secret.key`) e, por cima, as
// `BRIDGER_AI__*` do `.env`. Cada cenário roda numa cópia do banco, apagada no fim: a conversa de
// teste nunca chega ao banco do bot.
//
//   pnpm evals:luma            todos os cenários
//   pnpm evals:luma figurinha  só os que têm "figurinha" no nome

import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqlite } from '@usebridger/storage-sqlite';
import { loadConfig, pluginEnv } from '#config.ts';
import { play, SCENARIOS } from '#plugins/luma/scenarios.ts';

const { dbPath } = loadConfig();
const env = { ...pluginEnv() };

/** A chave mestra do bot, sem gerar outra: uma chave nova não decifra as chaves salvas. */
async function secretKey(): Promise<string | undefined> {
  if (env['BRIDGER_SECRET_KEY']) return env['BRIDGER_SECRET_KEY'];
  try {
    return (await readFile(join(dirname(dbPath), 'secret.key'), 'utf8')).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Cópia consistente do banco, mesmo com o bot rodando: o `VACUUM INTO` lê numa transação, pela
 * conexão só de leitura, e junta o WAL. Copiar o arquivo direto perderia o que está no WAL.
 */
function snapshot(target: string): boolean {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    // Sem banco (bot nunca rodou aqui) vale só o `.env`; outro erro não tem como seguir.
    if ((err as { errstr?: string }).errstr === 'unable to open database file') return false;
    throw err;
  }
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
    return true;
  } finally {
    db.close();
  }
}

const key = await secretKey();
if (key) env['BRIDGER_SECRET_KEY'] = key;

const dir = await mkdtemp(join(tmpdir(), 'luma-evals-'));
try {
  const master = join(dir, 'snapshot.sqlite');
  const hasDb = snapshot(master);
  if (!hasDb && !env['BRIDGER_AI__MODELS']) {
    console.error(
      `Sem o banco do bot (${dbPath}) nem BRIDGER_AI__MODELS no .env: configure a IA pelo dashboard ou pelo .env.`,
    );
    process.exitCode = 1;
  } else {
    const filter = process.argv[2]?.toLowerCase();
    const chosen = SCENARIOS.filter((s) => !filter || s.name.toLowerCase().includes(filter));
    let failed = 0;

    for (const [i, s] of chosen.entries()) {
      let problems: string[];
      let reply = '';
      try {
        // Cópia por cenário: a memória que um grava não vaza para o próximo.
        let storage: ReturnType<typeof sqlite> | undefined;
        if (hasDb) {
          const path = join(dir, `cenario-${i}.sqlite`);
          await copyFile(master, path);
          storage = sqlite({ path });
        }
        const played = await play(s, { env, ...(storage && { storage }) });
        reply = played.reply;
        problems = await s.outcome(played);
      } catch (error) {
        // Falha de rede ou de config conta como reprovado, com a causa, e o resto segue.
        problems = [`erro: ${error instanceof Error ? error.message : String(error)}`];
      }
      if (problems.length > 0) failed += 1;
      console.log(`${problems.length === 0 ? '✅' : '❌'} #${s.issue} ${s.name}`);
      console.log(`   ${(reply || '(sem resposta em texto)').replaceAll('\n', '\n   ')}`);
      for (const p of problems) console.log(`   ↳ ${p}`);
    }

    console.log(`\n${chosen.length - failed}/${chosen.length} cenários passaram.`);
    process.exitCode = failed > 0 ? 1 : 0;
  }
} finally {
  // A cópia tem as credenciais do WhatsApp e as chaves cifradas: não fica no disco.
  await rm(dir, { recursive: true, force: true });
}
