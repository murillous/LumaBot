# ADR 0043 — Middleware do app tem prazo

**Status:** Aceito (2026-10-07) · Detalha **D12** ([ADR 0012](0012-pipeline-de-3-estagios.md)) e
completa a premissa do [ADR 0042](0042-handler-lento-segura-o-chat.md)

## Contexto

O ADR 0042 parte de "um handler preso segura o chat até o prazo (30 s)". Isso valia para comando,
`onReject`, papel, consulta de admin e listener, mas não para middleware: o
`MiddlewarePipeline.run` não tinha prazo nenhum. Um middleware do app que trava (uma consulta a
banco ou API que nunca responde) segurava a fila do chat **para sempre**. As mensagens seguintes
acumulavam até `inbound.maxPendingPerChat` e depois eram descartadas (#239).

Alternativas consideradas:

- **Só documentar** que middleware é código do app e que travar é problema dele. Era o caminho
  mais barato, mas deixava o teto do ADR 0042 falso justamente para o código que roda primeiro.
- **Prazo total por mensagem** na fila de entrada, cobrindo middleware, comando e listeners. Esse
  prazo competiria com os que já existem: um comando com `timeoutMs` de minutos (ADR 0042) estouraria
  o prazo da mensagem antes do dele.
- **Prazo por middleware** contado sobre a cebola inteira (da entrada à saída do estágio). O
  middleware de fora estouraria sempre que comando e listeners somassem mais que o prazo dele.

## Decisão

- Cada middleware tem prazo, `timeouts.middlewareMs`, com padrão de 30 s (igual a `commandMs` e
  `listenerMs`).
- O relógio conta **só o tempo do próprio middleware**: ele para quando o middleware chama
  `next()` e volta, com o que sobrou, quando o `next()` termina. Ida e volta do mesmo middleware
  dividem um prazo só. O centro da cebola continua com os prazos dele.
- Estourado, o `run` rejeita com `MiddlewareTimeoutError`, que vai para o log
  (`falha ao processar mensagem`). A mensagem é descartada e o chat é liberado. Um `next()`
  chamado depois do prazo rejeita com o mesmo erro, sem rodar comando nem listeners, e uma
  rejeição tardia do middleware vai para o log (`middleware rejeitou depois do prazo`).
- Middleware síncrono, ou que só devolve o `next()`, não arma timer: o caminho quente não paga
  nada (plano §7), como no `settleWithin`.
- O shutdown abandona o middleware preso (`MiddlewareAbandonedError`) e desarma o timer dele:
  depois do `stop()`, nenhum timer do pipeline fica vivo.
- Não há prazo por middleware individual, como o `timeoutMs` do comando. Pode ser proposto quando
  um caso concreto pedir.

## Consequências

- O teto do ADR 0042 passa a valer para todo código no caminho da mensagem.
- Um middleware que espera de propósito por mais de 30 s (um limitador que enfileira, por
  exemplo) precisa subir `timeouts.middlewareMs`, que vale para todos.
- Como o JS não cancela promise, o middleware estourado continua rodando em segundo plano. Ele só
  é impedido de levar a mensagem adiante.
