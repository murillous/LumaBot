# ADR 0023 — Migração incremental (`legacy/`)

**Status:** Aceito (2026-10-06) · Decisão **D23** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O LumaBot está em produção. Um big-bang (reescrever tudo e trocar de uma vez)
deixaria o bot parado ou divergindo por meses, sem critério objetivo de "pronto".

Alternativas consideradas: big-bang.

## Decisão

O LumaBot atual vai para `legacy/`, segue em produção e mantém os testes intactos
(rodando no CI). Os plugins são portados por ordem de complexidade (M4, M5). A virada
acontece na **paridade**, medida pelo checklist do
[plano §10](../../ZAPFORGE_PLAN.md#10-checklist-de-paridade-com-o-legacy). A remoção do `legacy/`
só acontece com autorização explícita do dono do repositório.

## Consequências

- A produção não para; a paridade é um critério de aceite objetivo.
- Durante a migração, duas bases convivem no repositório (npm em `legacy/`, pnpm no
  monorepo), com CIs separados.
- O deploy de produção aponta para `legacy/` (M0-4.3).
