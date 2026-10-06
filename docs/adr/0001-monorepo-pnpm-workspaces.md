# ADR 0001 — Monorepo com pnpm workspaces

**Status:** Aceito (2026-10-06) · Decisão **D01** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O ZapForge nasce da extração de um kernel a partir do LumaBot, que já está em
produção. Era preciso decidir onde o kernel novo vive em relação ao bot atual.
Refatorar o LumaBot in-place arrastaria os débitos do diagnóstico
([plano §3](../../ZAPFORGE_PLAN.md#3-diagnóstico-do-lumabot-atual)) — estado global, comandos
centralizados, `MessagingPort` vazando o Baileys — para dentro do kernel. Um
repositório novo isolado, por outro lado, separa o kernel do seu primeiro
consumidor real e dificulta validar que a API de plugins basta.

Alternativas consideradas: repositório novo isolado; refatoração in-place.

## Decisão

Um único repositório com **pnpm workspaces**:

- `packages/*` — core, transports, storages, kit de testes, scaffold;
- `plugins/*` — plugins oficiais públicos;
- `apps/lumabot` — app de referência (só config + seleção de plugins);
- `legacy/` — o LumaBot atual, intacto, até a paridade (ver [ADR 0023](0023-migracao-incremental-legacy.md)).

## Consequências

- O kernel nasce limpo, e o LumaBot (`apps/lumabot`) valida a API como consumidor real
  no mesmo repositório e no mesmo CI.
- Mudanças que cruzam core e plugins viram um PR só.
- O CI precisa separar o que é kernel do que é `legacy/` (workflows distintos, filtros
  de `paths`).
- Publicação no npm exige versionamento por pacote (ver [ADR 0027](0027-releases-changesets.md)).
