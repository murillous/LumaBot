# ADR 0005 — Plugins no mesmo processo, isolados por try/catch + timeout

**Status:** Aceito (2026-10-06) · Decisão **D05** do [plano](../../ZAPFORGE_PLAN.md#4-decisões)

## Contexto

No LumaBot, o `onMessage` de todos os plugins é chamado com `await` em série: uma
exceção ou uma trava num plugin afeta todos os demais. Ao mesmo tempo, a meta de
performance ([ADR 0030](0030-metas-de-performance.md)) não comporta serializar cada
mensagem para outro thread ou processo.

Alternativas consideradas: worker threads; sandbox com permissões.

## Decisão

Plugins rodam **no mesmo processo** do kernel. Cada handler é isolado por try/catch
e timeout, com log identificando o plugin, e recebe uma API restrita (sem acesso ao
socket do transporte; a exceção explícita é a do [ADR 0011](0011-escape-hatch-unsafe-native.md)).

## Consequências

- Sem custo de serialização: dispatch rápido.
- Um plugin malicioso ainda pode fazer o que o processo pode fazer; não há fronteira
  de segurança. Isso é aceitável enquanto os plugins são escolhidos pelo dono do bot.
- Permissões declarativas só entram se houver um marketplace público.
