# ADR 0013 — Escopo do core

**Status:** Aceito (2026-10-06) · Decisão **D13** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Sem uma fronteira explícita, o kernel tende a acumular features "porque todo bot
precisa". Era preciso definir o que é indispensável.

## Decisão

O core contém, e só contém ([plano §5.2](../../ZAPFORGE_PLAN.md#52-o-que-é-core--plugin)):
conexão/reconexão/QR/pairing, interface `Transport` (+ adapter Baileys em pacote
separado), modelo de mensagem e envio, filas de entrada e saída, middlewares,
comandos, barramento de eventos, lifecycle de plugins, storage, scheduler, logger,
config, papéis, HTTP sob demanda e mídia. **Todo o resto é plugin.**

## Consequências

- Help, `@todos`, nomes de usuário, mídia, download, lembretes, rank, IA e dashboard
  são plugins oficiais.
- Entrar algo novo no core exige um ADR.
- As regras de dependência ([plano §5.4](../../ZAPFORGE_PLAN.md#54-regras-de-dependência)) proíbem
  o core de importar transport, storage concreto ou plugin.
