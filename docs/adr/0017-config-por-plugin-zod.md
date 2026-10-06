# ADR 0017 — Config por plugin com Zod 4

**Status:** Aceito (2026-10-06) · Decisão **D17** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Cada plugin precisa de configuração validada, com segredos que não podem aparecer
em logs nem no dashboard, e o dashboard precisa gerar formulários a partir dela.

Alternativas consideradas: Valibot; TypeBox; config manual.

## Decisão

Cada plugin declara um schema **Zod 4**, com campos marcados como `secret`. A
precedência é **env > arquivo > overrides do dashboard (storage) > default**. Mudar
a config faz `teardown` → `setup` do plugin, sem reiniciar o processo.

## Consequências

- Zod exporta JSON Schema, que o dashboard usa para gerar formulários.
- Zod vira dependência pública do core (os plugins usam o mesmo `z`).
- `teardown` precisa liberar tudo o que `setup` criou, ou o reload vaza recursos.
