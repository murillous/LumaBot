# ADR 0025 — Sem i18n formal na v1; objeto `messages`

**Status:** Aceito (2026-10-06) · Decisão **D25** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O público inicial é brasileiro. Um sistema de i18n completo (`ctx.t()`, catálogos,
plurais) na v1 seria custo sem demanda, mas textos espalhados pelo código tornariam
o i18n futuro uma reescrita.

Alternativas consideradas: `ctx.t()` já na v1.

## Decisão

Não há i18n formal na v1. As mensagens que um plugin mostra ao usuário ficam
isoladas num objeto `messages` no manifesto, sobrescrevível pela config do plugin.

## Consequências

- Quem usa o bot em outro idioma (ou com outro tom) sobrescreve só os textos.
- O i18n pode entrar depois sem quebrar a API: `messages` vira o catálogo padrão.
