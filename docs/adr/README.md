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

## Índice

| ADR | Decisão | Título | Status |
|---|---|---|---|
| [0001](0001-monorepo-pnpm-workspaces.md) | D01 | Monorepo com pnpm workspaces | Aceito |
| [0002](0002-typescript-no-kernel.md) | D02 | TypeScript no kernel, publicado com `.d.ts` | Aceito |
| [0003](0003-transport-abstrato.md) | D03 | `Transport` abstrato, só Baileys na v1 | Aceito |
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
| [0029](0029-open-core-repo-privado.md) | D29 | Open core com repo privado | Aceito |
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
