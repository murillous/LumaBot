# ADR 0006 — Luma é um plugin (`plugin-ai`)

**Status:** Aceito (2026-10-06) · Decisão **D06** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

A Luma (IA com persona, tools, histórico, resumo, spontaneous, transcrição) é a
feature mais pesada do LumaBot e está acoplada ao fluxo central. Um kernel
"indispensável" não deveria exigir IA para quem só quer um bot de figurinhas.

Alternativas consideradas: IA embutida no kernel.

## Decisão

A IA **não entra no core**. A Luma vira o plugin `@zapforge/plugin-ai`, entregue no M5.

## Consequências

- Se a Luma — o plugin mais exigente que temos — couber como plugin, a API está
  provada.
- Outros plugins que precisam de IA acessam via service registry
  ([ADR 0018](0018-service-registry.md)), não via core.
- O core não carrega dependências de SDKs de IA.
