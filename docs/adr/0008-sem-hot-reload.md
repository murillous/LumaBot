# ADR 0008 — Sem hot-reload de código na v1

**Status:** Aceito (2026-10-06) · Decisão **D08** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Recarregar o código de um plugin sem reiniciar o processo é tentador para
desenvolvimento e para o dashboard, mas módulos ESM não descarregam: listeners
antigos ficam registrados e estado órfão se acumula.

Alternativas consideradas: hot-reload de código.

## Decisão

Não há hot-reload de **código** na v1. Para aplicar código novo, reinicia o processo
(PM2/Docker). Mudança de **config** é diferente e recarrega o plugin sem restart
(ver [ADR 0017](0017-config-por-plugin-zod.md)).

## Consequências

- Evita vazamento de listeners e estado órfão.
- O ciclo de desenvolvimento depende de restart rápido, coberto pela meta de boot
  < 500 ms com 20 plugins ([ADR 0030](0030-metas-de-performance.md)).
