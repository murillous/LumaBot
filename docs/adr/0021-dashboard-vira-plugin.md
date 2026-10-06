# ADR 0021 — Dashboard vira plugin

**Status:** Aceito (2026-10-06) · Decisão **D21** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O dashboard do LumaBot é o processo pai: spawna o bot como filho e lê sinais como
`[LUMA_QR]` e `[LUMA_STATUS]` parseados do stdout. O protocolo é frágil e acopla o
painel ao processo.

Alternativas consideradas: supervisor separado.

## Decisão

O dashboard vira `@zapforge/plugin-dashboard`, que lê o barramento de eventos e os
schemas de config e expõe a interface pelo HTTP do core
([ADR 0020](0020-http-unico-hono.md)). O protocolo via stdout acaba.

## Consequências

- Plugin pesado que valida a API (eventos, config, HTTP).
- Reiniciar o processo passa a ser responsabilidade do supervisor (PM2/Docker), não do
  dashboard.
- Dashboard central multi-número fica para um projeto comercial futuro.
