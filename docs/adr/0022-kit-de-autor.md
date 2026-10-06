# ADR 0022 — Kit de autor na v1

**Status:** Aceito (2026-10-06) · Decisão **D22** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

Sem como testar um plugin sem um WhatsApp real, o ecossistema fica frágil, e a
documentação sozinha não garante que o contrato é usável.

Alternativas consideradas: só documentação.

## Decisão

A v1 entrega:

- `@zapforge/testing` — `FakeTransport`, `createTestBot`, matchers
  ([plano §6.9](../../ZAPFORGE_PLAN.md#69-testes-de-plugin));
- `create-zapforge-plugin` — scaffold;
- docs "primeiro plugin em 5 minutos" + referência gerada via TypeDoc.

## Consequências

- O próprio core e os plugins oficiais usam o kit nos testes, e é isso que mantém o kit
  funcionando.
- O benchmark ([ADR 0030](0030-metas-de-performance.md)) roda sobre o `FakeTransport`.
- Mais pacotes para manter e versionar.
