# ADRs do ZapForge

Registros de decisão de arquitetura (o PORQUÊ) do monorepo. Cada ADR corresponde a uma
decisão da [seção 4 do plano](../../ZAPFORGE_PLAN.md#4-decisões) (`ADR 00NN` = `DNN`).
Os ADRs do LumaBot atual continuam em [`legacy/docs/adr/`](../../legacy/docs/adr/).

## Formato

Um arquivo por decisão, `NNNN-slug.md`, com:

- **Status** — `Proposto`, `Aceito`, `Substituído por ADR NNNN` ou `Descontinuado`;
- **Contexto** — o problema, as forças e as alternativas consideradas;
- **Decisão** — o que foi decidido;
- **Consequências** — o que muda, o que fica mais fácil e o que fica mais caro.

ADRs aceitos não são reescritos: uma mudança de decisão vira um ADR novo que substitui
o anterior, e o antigo passa a apontar para ele no Status.

## Índice por tema

Atalho de navegação: cada ADR aparece no tema principal dele. O índice numérico abaixo continua
sendo a referência; um ADR novo entra nos dois.

**Fundação, tooling e forma do pacote**

- [0001](0001-monorepo-pnpm-workspaces.md) — Monorepo com pnpm workspaces
- [0002](0002-typescript-no-kernel.md) — TypeScript no kernel, publicado com `.d.ts`
- [0026](0026-tooling.md) — Tooling: Node 24, pnpm, tsdown, Vitest, Biome
- [0030](0030-metas-de-performance.md) — Metas de performance com benchmark no CI
- [0054](0054-baseline-do-benchmark.md) — Baseline do benchmark medido no mesmo job, a partir do commit base (detalha D30)
- [0034](0034-biblioteca-sem-runner.md) — ZapForge é uma biblioteca, sem runner; API pública por público

**Projeto: migração, licença, release e nome**

- [0023](0023-migracao-incremental-legacy.md) — Migração incremental (`legacy/`)
- [0025](0025-sem-i18n-objeto-messages.md) — Sem i18n formal na v1; objeto `messages`
- [0027](0027-releases-changesets.md) — Releases com Changesets
- [0028](0028-licenca-apache-2.md) — Licença Apache-2.0
- [0029](0029-open-core-repo-privado.md) — Open core com repo privado
- [0031](0031-nome-zapforge.md) — Nome: ZapForge

**Bot, sessão e escopo do core**

- [0004](0004-uma-sessao-por-processo.md) — Uma sessão por processo, zero estado global
- [0013](0013-escopo-do-core.md) — Escopo do core
- [0036](0036-escopo-de-sessao.md) — Escopo de sessão no bot e no storage (detalha D04/D14)

**Transport e conexão**

- [0003](0003-transport-abstrato.md) — `Transport` abstrato, só Baileys na v1
- [0010](0010-capabilities-do-transporte.md) — Capabilities do transporte + `requires`
- [0011](0011-escape-hatch-unsafe-native.md) — Escape hatch `ctx.unsafe.native`
- [0037](0037-transport-por-fabrica.md) — Transport recebe as dependências do bot por fábrica (detalha D03)
- [0045](0045-queda-de-rede-nao-limpa-sessao.md) — Queda de rede nunca limpa a sessão (detalha D03/D37)
- [0048](0048-connect-resolve-ao-iniciar.md) — `connect()` resolve ao iniciar a tentativa; queda antes do fim não se perde (detalha D03/D39/D45)
- [0050](0050-codigo-de-pareamento.md) — Código de pareamento chega por evento, como o QR (detalha D03/D13)

**Mensagem e identidade**

- [0009](0009-modelo-de-mensagem-normalizado.md) — Modelo de mensagem normalizado
- [0046](0046-ids-de-contato-e-metadata-de-grupo.md) — Ids de contato em espaços diferentes e custo do `getGroupMetadata` (detalha D03/D09)

**Pipeline, comandos e papéis**

- [0012](0012-pipeline-de-3-estagios.md) — Pipeline de 3 estágios
- [0024](0024-papeis-no-core.md) — Papéis no core
- [0035](0035-papeis-nomeados-por-plugin.md) — Papéis custom nomeados, definidos por plugin (substitui parte de D12/D24)
- [0038](0038-filtro-de-eventos-no-kernel.md) — chatFilter e ignoreSelf valem para os eventos que não são mensagem (detalha D24)
- [0042](0042-handler-lento-segura-o-chat.md) — Comando e listener lentos seguram o chat (detalha D05/D12)
- [0043](0043-prazo-de-middleware.md) — Middleware do app tem prazo, contado fora do `next()` (detalha D12)
- [0049](0049-evento-de-comando.md) — Evento `command`: o plugin observa o comando que consumiu a mensagem (detalha D12/D40)

**Plugins: carga, config, services e execução**

- [0005](0005-plugins-no-mesmo-processo.md) — Plugins no mesmo processo, isolados por try/catch + timeout
- [0006](0006-luma-e-um-plugin.md) — Luma é um plugin (`plugin-ai`)
- [0007](0007-plugins-via-npm-e-pasta.md) — Plugins via npm e via pasta (`pluginDirs`)
- [0008](0008-sem-hot-reload.md) — Sem hot-reload de código na v1
- [0016](0016-manifesto-do-plugin.md) — Manifesto do plugin
- [0017](0017-config-por-plugin-zod.md) — Config por plugin com Zod 4
- [0018](0018-service-registry.md) — Service registry entre plugins
- [0032](0032-camadas-da-config-de-plugin.md) — Camadas e convenções da config de plugin (detalha D17)
- [0033](0033-cancelamento-cooperativo.md) — Cancelamento cooperativo do código de plugin (detalha D05)
- [0041](0041-reload-em-cascata.md) — Reload de plugin em cascata pelos dependentes (detalha D17/D18)

**Fila de saída e ações do transport**

- [0019](0019-fila-de-saida-anti-ban.md) — Fila de saída anti-ban no core
- [0039](0039-fila-de-saida-e-conexao.md) — Fila de saída pausa com a conexão caída e tem prazo por envio (detalha D19)
- [0040](0040-acoes-do-transport-no-plugin.md) — Ações e leituras do transport chegam ao plugin pela API pública (detalha D16/D19)
- [0047](0047-espera-na-fila-de-saida-fora-do-prazo.md) — A espera na fila de saída não conta no prazo do handler (detalha D19/D33/D42)

**Storage**

- [0014](0014-storage-port-sqlite-postgres.md) — `StoragePort` com SQLite e Postgres na v1; auth state no port
- [0015](0015-storage-kv-e-colecoes.md) — Storage: KV com namespace + coleções
- [0051](0051-sqlite-via-node-sqlite.md) — SQLite pelo `node:sqlite`, com schema único e migrations do adapter (detalha D14/D15)

**HTTP e dashboard**

- [0020](0020-http-unico-hono.md) — Servidor HTTP único no core (Hono)
- [0021](0021-dashboard-vira-plugin.md) — Dashboard vira plugin

**Testes e kit de autor**

- [0022](0022-kit-de-autor.md) — Kit de autor na v1
- [0044](0044-espera-pelo-bot-assentar.md) — `bot.settled()` espera o bot processar o que recebeu (detalha D22/D34)
- [0052](0052-kit-de-testes-sobre-o-vitest.md) — Kit de testes sobre o Vitest, com `receive()` que espera o bot assentar (detalha D22/D44)
- [0053](0053-core-testa-sem-o-kit.md) — O core se testa com apoios próprios, não com o `@zapforge/testing` (detalha D22/D52)

**Multiplataforma**

- [0055](0055-plataformas-alvo-e-transport-web.md) — Plataformas-alvo e um transport fora do WhatsApp antes do 1.0 (substitui parte de D03, detalha D29)

As outras decisões para atender WhatsApp, Discord, Telegram e sistemas web estão nas issues da
[#265](https://github.com/murillous/LumaBot/issues/265) e vão virar ADRs por tema (B a F, ver o
ADR 0055). Ao serem aceitos, entram aqui e no índice numérico.

## Índice numérico

| ADR | Decisão | Título | Status |
|---|---|---|---|
| [0001](0001-monorepo-pnpm-workspaces.md) | D01 | Monorepo com pnpm workspaces | Aceito |
| [0002](0002-typescript-no-kernel.md) | D02 | TypeScript no kernel, publicado com `.d.ts` | Aceito |
| [0003](0003-transport-abstrato.md) | D03 | `Transport` abstrato, só Baileys na v1 | Aceito (só Baileys na v1: ADR 0055) |
| [0004](0004-uma-sessao-por-processo.md) | D04 | Uma sessão por processo, zero estado global | Aceito |
| [0005](0005-plugins-no-mesmo-processo.md) | D05 | Plugins no mesmo processo, isolados por try/catch + timeout | Aceito |
| [0006](0006-luma-e-um-plugin.md) | D06 | Luma é um plugin (`plugin-ai`) | Aceito |
| [0007](0007-plugins-via-npm-e-pasta.md) | D07 | Plugins via npm e via pasta (`pluginDirs`) | Aceito |
| [0008](0008-sem-hot-reload.md) | D08 | Sem hot-reload de código na v1 | Aceito |
| [0009](0009-modelo-de-mensagem-normalizado.md) | D09 | Modelo de mensagem normalizado | Aceito |
| [0010](0010-capabilities-do-transporte.md) | D10 | Capabilities do transporte + `requires` | Aceito |
| [0011](0011-escape-hatch-unsafe-native.md) | D11 | Escape hatch `ctx.unsafe.native` | Aceito |
| [0012](0012-pipeline-de-3-estagios.md) | D12 | Pipeline de 3 estágios | Aceito (papéis custom: ADR 0035) |
| [0013](0013-escopo-do-core.md) | D13 | Escopo do core | Aceito |
| [0014](0014-storage-port-sqlite-postgres.md) | D14 | `StoragePort` com SQLite e Postgres na v1; auth state no port | Aceito |
| [0015](0015-storage-kv-e-colecoes.md) | D15 | Storage: KV com namespace + coleções | Aceito |
| [0016](0016-manifesto-do-plugin.md) | D16 | Manifesto do plugin | Aceito |
| [0017](0017-config-por-plugin-zod.md) | D17 | Config por plugin com Zod 4 | Aceito |
| [0018](0018-service-registry.md) | D18 | Service registry entre plugins | Aceito |
| [0019](0019-fila-de-saida-anti-ban.md) | D19 | Fila de saída anti-ban no core | Aceito |
| [0020](0020-http-unico-hono.md) | D20 | Servidor HTTP único no core (Hono) | Aceito |
| [0021](0021-dashboard-vira-plugin.md) | D21 | Dashboard vira plugin | Aceito |
| [0022](0022-kit-de-autor.md) | D22 | Kit de autor na v1 | Aceito |
| [0023](0023-migracao-incremental-legacy.md) | D23 | Migração incremental (`legacy/`) | Aceito |
| [0024](0024-papeis-no-core.md) | D24 | Papéis no core | Aceito (papéis custom: ADR 0035) |
| [0025](0025-sem-i18n-objeto-messages.md) | D25 | Sem i18n formal na v1; objeto `messages` | Aceito |
| [0026](0026-tooling.md) | D26 | Tooling: Node 24, pnpm, tsdown, Vitest, Biome | Aceito |
| [0027](0027-releases-changesets.md) | D27 | Releases com Changesets | Aceito |
| [0028](0028-licenca-apache-2.md) | D28 | Licença Apache-2.0 | Aceito |
| [0029](0029-open-core-repo-privado.md) | D29 | Open core com repo privado | Aceito (transports públicos: ADR 0055) |
| [0030](0030-metas-de-performance.md) | D30 | Metas de performance com benchmark no CI | Aceito |
| [0031](0031-nome-zapforge.md) | D31 | Nome: ZapForge | Aceito |
| [0032](0032-camadas-da-config-de-plugin.md) | D32 | Camadas e convenções da config de plugin (detalha D17) | Aceito |
| [0033](0033-cancelamento-cooperativo.md) | D33 | Cancelamento cooperativo do código de plugin (detalha D05) | Aceito |
| [0034](0034-biblioteca-sem-runner.md) | D34 | ZapForge é uma biblioteca, sem runner; API pública por público | Aceito |
| [0035](0035-papeis-nomeados-por-plugin.md) | D35 | Papéis custom nomeados, definidos por plugin (substitui parte de D12/D24) | Aceito |
| [0036](0036-escopo-de-sessao.md) | D36 | Escopo de sessão no bot e no storage (detalha D04/D14) | Aceito |
| [0037](0037-transport-por-fabrica.md) | D37 | Transport recebe as dependências do bot por fábrica (detalha D03) | Aceito |
| [0038](0038-filtro-de-eventos-no-kernel.md) | D38 | chatFilter e ignoreSelf valem para os eventos que não são mensagem (detalha D24) | Aceito |
| [0039](0039-fila-de-saida-e-conexao.md) | D39 | Fila de saída pausa com a conexão caída e tem prazo por envio (detalha D19) | Aceito |
| [0040](0040-acoes-do-transport-no-plugin.md) | D40 | Ações e leituras do transport chegam ao plugin pela API pública (detalha D16/D19) | Aceito |
| [0041](0041-reload-em-cascata.md) | D41 | Reload de plugin em cascata pelos dependentes (detalha D17/D18) | Aceito |
| [0042](0042-handler-lento-segura-o-chat.md) | D42 | Comando e listener lentos seguram o chat (detalha D05/D12) | Aceito |
| [0043](0043-prazo-de-middleware.md) | D43 | Middleware do app tem prazo, contado fora do `next()` (detalha D12) | Aceito |
| [0044](0044-espera-pelo-bot-assentar.md) | D44 | `bot.settled()` espera o bot processar o que recebeu (detalha D22/D34) | Aceito |
| [0045](0045-queda-de-rede-nao-limpa-sessao.md) | D45 | Queda de rede nunca limpa a sessão (detalha D03/D37) | Aceito |
| [0046](0046-ids-de-contato-e-metadata-de-grupo.md) | D46 | Ids de contato em espaços diferentes e custo do `getGroupMetadata` (detalha D03/D09) | Aceito |
| [0047](0047-espera-na-fila-de-saida-fora-do-prazo.md) | D47 | A espera na fila de saída não conta no prazo do handler (detalha D19/D33/D42) | Aceito |
| [0048](0048-connect-resolve-ao-iniciar.md) | D48 | `connect()` resolve ao iniciar a tentativa; queda antes do fim não se perde (detalha D03/D39/D45) | Aceito |
| [0049](0049-evento-de-comando.md) | D49 | Evento `command`: o plugin observa o comando que consumiu a mensagem (detalha D12/D40) | Aceito |
| [0050](0050-codigo-de-pareamento.md) | D50 | Código de pareamento chega por evento, como o QR (detalha D03/D13) | Aceito |
| [0051](0051-sqlite-via-node-sqlite.md) | D51 | SQLite pelo `node:sqlite`, com schema único e migrations do adapter (detalha D14/D15) | Aceito |
| [0052](0052-kit-de-testes-sobre-o-vitest.md) | D52 | Kit de testes sobre o Vitest, com `receive()` que espera o bot assentar (detalha D22/D44) | Aceito |
| [0053](0053-core-testa-sem-o-kit.md) | D53 | O core se testa com apoios próprios, não com o `@zapforge/testing` (detalha D22/D52) | Aceito |
| [0054](0054-baseline-do-benchmark.md) | D54 | Baseline do benchmark medido no mesmo job, a partir do commit base (detalha D30) | Aceito |
| [0055](0055-plataformas-alvo-e-transport-web.md) | D55 | Plataformas-alvo e um transport fora do WhatsApp antes do 1.0 (substitui parte de D03, detalha D29) | Aceito |
| [0056](0056-owners-por-telefone-ou-id.md) | D56 | Owners por telefone ou por ID do contato (detalha D24/D46) | Aceito |
| [0057](0057-contact-multiplataforma.md) | D57 | `Contact` multiplataforma: `username`, `isBot` e claims verificados (detalha D09/D38) | Aceito |
| [0058](0058-chat-multiplataforma.md) | D58 | `Chat` multiplataforma: tipo, espaço e título (detalha D09/D24/D38) | Aceito |
| [0059](0059-grupos-multiplataforma.md) | D59 | Grupos multiplataforma: admin, participantes, ações e eventos (detalha D24/D46; substitui em parte D10/D38/D40) | Aceito |
| [0060](0060-resposta-esperada.md) | D60 | Resposta esperada: conversa com estado sem segurar o chat (detalha D12/D42) | Aceito |
| [0061](0061-texto-formatado-neutro.md) | D61 | Texto formatado neutro, menções portáteis e limites de tamanho (detalha D09/D19) | Aceito |
| [0062](0062-acoes-e-botoes.md) | D62 | Ações e botões: o clique dispara um comando, com fallback em texto numerado (detalha D12/D49/D60) | Aceito |
| [0063](0063-prefixo-por-chat.md) | D63 | Prefixo por tipo de chat e por chat, vazio permitido (detalha D12/D60) | Aceito |
| [0064](0064-comandos-nativos.md) | D64 | Comandos nativos: o transport lê a lista e confirma a interação na hora (detalha D37/D42/D62) | Aceito |
| [0065](0065-varios-anexos-e-albuns.md) | D65 | Vários anexos na mensagem e envio em álbum (detalha D09/D10/D61) | Aceito |
| [0066](0066-objeto-bruto-da-mensagem.md) | D66 | Objeto bruto da mensagem no `ctx.unsafe.raw()` (detalha D11/D03) | Aceito |
| [0067](0067-retry-after-e-ritmo-do-transport.md) | D67 | Janela da plataforma no retry e ritmo padrão do transport (detalha D19/D39/D47) | Aceito |
| [0068](0068-desconexao-fatal-e-transport-sem-pareamento.md) | D68 | Desconexão fatal e transport sem pareamento: `fatal` e `auth-failed` sem `pairing` param o bot (detalha D03/D13/D45/D48) | Aceito |
| [0069](0069-unioes-de-tipo-antes-do-1-0.md) | D69 | Uniões de tipo de mensagem e de conteúdo antes do 1.0: fechadas, adição é minor (detalha D09/D10/D27) | Aceito |
| [0070](0070-capabilities-multiplataforma.md) | D70 | Capabilities multiplataforma: `typing` no lugar de `presence`, uma reação da sessão por mensagem, enquete com `multiple` e a lista só do core (detalha D10/D16) | Aceito |
| [0071](0071-voto-em-enquete.md) | D71 | Voto em enquete: evento `poll.vote` com a escolha inteira por índice, filtrado como a reação (completa D70, segue D38) | Aceito |
| [0072](0072-isolamento-por-tenant.md) | D72 | Isolamento automático por tenant: `chat.tenantId` e o mesmo `ctx.storage` no escopo do tenant corrente (detalha D36/D15) | Aceito |
| [0075](0075-varios-bots-e-escopo-compartilhado.md) | D75 | Vários bots num storage e escopo compartilhado opt-in: `ctx.storage.shared` em `$shared:<plugin>`, por tenant, e `ctx.transportName` (detalha D04, substitui parte do D36) | Aceito |
