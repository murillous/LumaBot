# ADR 0019 — Fila de saída anti-ban no core

**Status:** Aceito (2026-10-06) · Decisão **D19** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

O LumaBot só tem rate limit de entrada; rajadas de envio (broadcast, `@todos`)
arriscam ban do número. Deixar isso para cada plugin garante que algum plugin vai
esquecer.

Alternativas consideradas: responsabilidade do plugin.

## Decisão

O core tem uma **fila de saída** com taxa global e por chat, prioridade (comando >
broadcast) e retry com backoff. A humanização (presença "digitando") é opcional por
transport. `ctx.reply()` passa pela fila de forma transparente.

## Consequências

- Essencial para uso comercial.
- A latência de resposta pode subir sob carga, por design.
- A fila precisa entrar no benchmark, para não virar gargalo.
