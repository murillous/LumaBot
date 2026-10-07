---
'@zapforge/core': patch
---

Corrige o descarte do plugin com execuções em andamento (M1-16, ADR 0033). Antes, um reload por
config ou o teardown deixavam vivos os comandos, listeners, jobs e checagens de papel que já
rodavam: o `signal` deles não abortava e o `reply` seguia enviando pela fila de saída do kernel.
Agora o descarte expira essas execuções junto com o contexto do plugin: o `signal` de cada uma
aborta com o mesmo motivo do `ctx.signal` do plugin, e o `reply` rejeita com
`ContextExpiredError`. Vale também no `stop()` cuja drenagem da fila de entrada estoura o prazo.
