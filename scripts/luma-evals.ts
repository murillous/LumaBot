// Roda os cenários de conversa da Luma (#466) contra o modelo real da cadeia `BRIDGER_AI__MODELS`
// e mostra o que ela respondeu em cada um. É opcional e gasta tokens: o `pnpm test` roda os mesmos
// cenários com o modelo falso. O modelo de imagem segue falso: o que se julga é a escolha dela.
//
//   pnpm evals:luma            todos os cenários
//   pnpm evals:luma figurinha  só os que têm "figurinha" no nome

import { pluginEnv } from '#config.ts';
import { play, SCENARIOS } from '#plugins/luma/scenarios.ts';

const env = pluginEnv();
if (!env['BRIDGER_AI__MODELS']) {
  console.error('Defina BRIDGER_AI__MODELS e as chaves (BRIDGER_AI__KEYS__*) no .env.');
  process.exit(1);
}

const filter = process.argv[2]?.toLowerCase();
const chosen = SCENARIOS.filter((s) => !filter || s.name.toLowerCase().includes(filter));
let failed = 0;

for (const s of chosen) {
  let problems: string[];
  let reply = '';
  try {
    const played = await play(s, { env });
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
