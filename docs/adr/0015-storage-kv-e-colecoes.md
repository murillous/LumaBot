# ADR 0015 — Storage: KV com namespace + coleções

**Status:** Aceito (2026-10-06) · Decisão **D15** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Plugins precisam de mais que chave-valor (ranking ordenado, lembretes por
`fireAt`), mas SQL cru com migrations por plugin amarraria cada plugin ao engine e
quebraria a portabilidade entre SQLite e Postgres.

Alternativas consideradas: só KV; SQL com migrations por plugin.

## Decisão

A API pública de storage ([plano §6.6](../../ZAPFORGE_PLAN.md#66-storage)) oferece:

- **KV** com namespace por plugin;
- **coleções** com `insert`/`find`, filtros, ordenação, limite e índices declarados.

Não há SQL cru na API pública.

## Consequências

- Cobre os casos do legacy (ranking, lembretes) sem amarrar o plugin ao engine.
- Consultas complexas (joins, agregações) ficam fora; se surgirem, entram na API ou
  em um service específico.
