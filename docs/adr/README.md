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
