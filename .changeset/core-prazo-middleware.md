---
'@zapforge/core': minor
---

Middleware do app ganha prazo (#239, ADR 0043). Antes, um middleware que travava segurava a fila
do chat para sempre. Agora cada um tem `timeouts.middlewareMs` (padrão 30000), contado só no tempo
do próprio middleware: o que roda dentro do `next()` (comando e listeners) não conta. Estourado,
a mensagem é descartada, o `MiddlewareTimeoutError` vai para o log e o chat segue. Um `next()`
chamado depois do prazo não roda comando nem listeners. Middleware síncrono, ou que só devolve o
`next()`, não arma timer. O `stop()` desarma o timer de um middleware preso.
