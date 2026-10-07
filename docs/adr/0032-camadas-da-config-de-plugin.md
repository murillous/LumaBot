# ADR 0032 — Camadas e convenções da config de plugin

**Status:** Aceito (2026-10-07) · Detalha a decisão **D17** ([ADR 0017](0017-config-por-plugin-zod.md))

## Contexto

O ADR 0017 fixou Zod 4, campos `secret`, a precedência env > arquivo > overrides > default e o
reload por `teardown` → `setup`. Para implementar (M1-13) faltava decidir o que vira contrato
público e difícil de mudar depois: o nome das variáveis de ambiente, o formato do "arquivo",
onde ficam as sobrescritas de `messages` (ADR 0025), como marcar um campo secreto e o que
acontece quando a config de um plugin é inválida.

Alternativas consideradas: variáveis por plugin sem prefixo (`STICKER_QUALITY`); `messages` num
mapa separado (`pluginMessages`); marcar segredo por lista de caminhos no manifesto; config
inválida derrubar o boot.

## Decisão

- **Env**: `ZAPFORGE_<PLUGIN>__<CAMPO>`, com plugin kebab-case e campos camelCase em
  SCREAMING_SNAKE e `__` entre níveis (`ZAPFORGE_USER_NAMES__OPENAI__API_KEY`). Só campos
  declarados no schema são lidos; o texto é convertido para o tipo do campo (número, booleano,
  literal, JSON para arrays/objetos). O prefixo evita colisão com variáveis de outras
  ferramentas; o `__` deixa nome de plugin e de campo inequívocos. Dois campos que geram a mesma
  variável (`openAIKey` e `openAiKey` → `OPEN_AI_KEY`) são erro do autor do plugin, e o plugin é
  recusado no boot: uma variável não pode preencher dois campos em silêncio.
- **Arquivo**: um objeto `nome do plugin → entrada` passado pelo app (o `pluginConfig` da config
  do bot). A mesma forma de entrada vale para os overrides do storage
  (`kernelStorage(port, 'config').kv`, chave = nome do plugin).
- **`messages`** é chave reservada da entrada (`{ quality: 90, messages: { needMedia: '…' } }`),
  com a mesma precedência dos campos (inclusive `ZAPFORGE_<PLUGIN>__MESSAGES__<CHAVE>`). O schema
  do plugin não pode ter campo `messages`; chave que o manifesto não declara é erro.
- **Segredo** é metadado do schema: `secret(z.string())` grava `{ secret: true, writeOnly: true }`
  no registro do Zod. Assim o JSON Schema exportado para o dashboard já carrega a marca, e o
  segredo sobrevive a `.optional()`/`.default()`. `secret()` só vale em campo de `z.object`
  (em qualquer nível de objetos): é seguindo objetos que a config acha o segredo para censurar,
  mascarar e recusar no override. Dentro de array, record ou union ele passaria sem nenhuma
  dessas proteções, então é erro do autor e o plugin é recusado no boot. Uma lista secreta
  marca o campo inteiro (`secret(z.array(z.string()))`).
- **Config inválida ignora o plugin**, não derruba o boot: a fábrica de contexto lança
  `PluginConfigError`, que vira `setup-failed` (fase `context`) com o motivo na tabela de boot.
  Numa mudança em runtime, a config nova é validada antes de salvar; inválida é recusada e o
  plugin segue com a anterior.
- **Segredo não entra por override**: o storage guarda o override em texto puro (SQLite,
  Postgres, backups), então `setOverrides` recusa qualquer campo `secret`, inclusive aninhado,
  com `PluginConfigError` (fonte `override`) apontando a env e o caminho no arquivo. Segredo vem
  só de env ou do arquivo. Override legado com segredo (gravado antes desta regra ou direto no
  banco) tem o campo ignorado na leitura, com `warn` sem o valor, em vez de falhar o plugin: um
  dado antigo não deve desligar o plugin. O JSON Schema marca o campo com
  `x-zapforge-override: false` (e não `readOnly`, que contradiz o `writeOnly` já presente) para
  o dashboard não oferecer a edição.
- **Segredos no log** chegam por uma fonte viva (`SecretSet`) compartilhada entre a config e o
  logger, porque a config é resolvida depois que o logger existe e muda no reload. O logger
  ignora valores com menos de 4 caracteres (`MIN_SECRET_LENGTH`): a censura troca o valor onde
  ele aparecer, e um segredo como `"1"` apagaria pedaços de todo log. A resolução avisa desse
  campo uma vez, com plugin e caminho, sem o valor.

## Consequências

- Renomear um campo de config muda o nome da variável de ambiente: é quebra para quem configura.
- Uma config errada desliga só aquele plugin; o operador vê o campo e a fonte do erro na tabela
  de boot (em `warn`) em vez de o bot inteiro não subir.
- Overrides ficam em texto puro no storage, mas sem segredos: o dashboard não edita segredo, e
  trocar uma chave exige mexer em env ou no arquivo e reiniciar (ou recarregar) o plugin.
  Cifrar segredos no storage, para o dashboard poder editá-los, fica para o M5, com ADR próprio.
- Erros de validação nunca carregam o valor recebido, que pode ser secreto.
- Um segredo com menos de 4 caracteres sai no log sem censura; o aviso no boot diz qual campo.
