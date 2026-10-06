# ADR 0018 — Service registry entre plugins

**Status:** Aceito (2026-10-06) · Decisão **D18** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Plugins precisam conversar entre si (ex.: um plugin de resumo usando a IA), mas a IA
não pode entrar no core ([ADR 0006](0006-luma-e-um-plugin.md)).

Alternativas consideradas: interface de IA no core.

## Decisão

O core oferece um **service registry**: o plugin publica com
`ctx.services.provide(name, impl)` e consome com `ctx.services.get(name)`. A
tipagem vem de declaration merging na interface `Services` do `@zapforge/core`
([plano §6.7](../../ZAPFORGE_PLAN.md#67-services-entre-plugins)). Quem consome declara `dependsOn`.

## Consequências

- Mantém o [ADR 0006](0006-luma-e-um-plugin.md).
- Extrair um `@zapforge/ai-contract` só se surgirem plugins de IA concorrentes.
- A ordem de boot respeita `dependsOn`, para que o service exista no `setup` de quem
  o consome.
