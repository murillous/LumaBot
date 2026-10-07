---
'@zapforge/core': minor
---

A espera do `reply` na fila de saída não conta mais no prazo do handler (#240, ADR 0047). Antes,
uma rajada de comandos em chats diferentes estourava `timeouts.commandMs` esperando a taxa global
da fila (300 ms entre envios), e saía `plugin.error` com `timedOut: true` para comandos que
funcionaram. Agora o prazo de comando (`run` e `onReject`) e de listener pausa enquanto um
`reply` ou `react` do contexto não assenta, cobrindo fila, humanização, re-tentativas e transport,
e volta com o tempo que sobrou. O `ctx.send` do plugin, `ctx.groups` e os jobs seguem contando.
