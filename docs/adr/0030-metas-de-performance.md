# ADR 0030 — Metas de performance com benchmark no CI

**Status:** Aceito (2026-10-06) · Decisão **D30** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

"Máximo de performance" é um objetivo do projeto, mas sem uma régua não há aceite
nem detecção de regressão. O LumaBot tem um vazamento conhecido (`rateLimiter` é um
`Map` nunca limpo) que só uma medição de memória teria pegado.

Alternativas consideradas: "rápido" sem métrica.

## Decisão

Metas medidas no CI com `FakeTransport`, sem I/O de rede
([plano §7](../../ZAPFORGE_PLAN.md#7-metas-de-performance)):

| Métrica | Meta |
|---|---|
| Overhead do kernel por mensagem | p99 < 1 ms |
| Vazão sintética | ≥ 5.000 msg/s em 500 chats, 1 núcleo |
| Memória ociosa | < 80 MB |
| Crescimento de memória após 1M mensagens | ~0 |
| Boot até "pronto para conectar" com 20 plugins | < 500 ms |

O PR falha se regredir mais de 10%.

## Consequências

- O job de benchmark existe como placeholder desde o M0-3 e é ativado no M2.
- Vira critério do DoD a partir do M2.
- Benchmarks em runner compartilhado têm ruído; a margem de 10% e repetições
  compensam.
