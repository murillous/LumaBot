# ADR 0047 — A espera na fila de saída não conta no prazo do handler

**Status:** Aceito (2026-10-07) · Detalha **D33** ([ADR 0033](0033-cancelamento-cooperativo.md)),
**D42** ([ADR 0042](0042-handler-lento-segura-o-chat.md)) e **D19**
([ADR 0019](0019-fila-de-saida-anti-ban.md))

## Contexto

`await ctx.reply()` num comando ou listener espera a fila de saída entregar. A fila tem intervalo
**global** de 300 ms (D19), cerca de 3 envios/s somando todos os chats. Numa rajada de 100
comandos em chats diferentes, a última resposta espera ~30 s na fila. Com isso, comandos que
funcionaram estouram `commandMs` esperando a fila, e não por lentidão do plugin (#240):

- sai `plugin.error` com `timedOut: true`, mas a resposta é entregue mesmo assim, porque foi
  enfileirada antes do prazo;
- o chat fica preso até o prazo (ADR 0042) e atrasa as mensagens seguintes dele.

A investigação mostrou que o efeito vai além da rajada. A humanização (até 3 s de "digitando"
por texto), as re-tentativas com backoff e o tempo do próprio transport também contam no prazo,
em todo `reply`. O listener sofre igual: o `reply` dele passa pelo mesmo invólucro, e o
barramento tem timer próprio.

O prazo (D33) existe para liberar o chat quando o código **do plugin** trava. O tempo que a fila
gasta é do kernel, e a fila já tem tetos próprios: `sendTimeoutMs` por chamada ao transport,
`retry.maxAttempts`, `maxPending` por prioridade, `maxPauseMs` com a conexão caída, e o `close()`
no `stop()`.

Alternativas consideradas:

- **`reply` resolve ao enfileirar**: o handler não espera a fila. Muda o contrato público:
  `reply` deixa de devolver a `MessageKey` da mensagem criada, que o plugin usa para editar,
  apagar e reagir (ADR 0040).
- **Manter e documentar** (`void ctx.reply()` quando a ordem não importa, subir `timeoutMs`): os
  falsos `timedOut` continuam em toda rajada e com humanização ligada, e quem precisa da chave
  não tem saída.
- **Pausar o prazo enquanto um envio do contexto aguarda a fila**: o prazo passa a medir só o
  tempo do plugin. O contrato não muda.

## Decisão

- O prazo de comando (`run` e `onReject`) e de listener **pausa** enquanto um `reply` ou `react`
  do contexto da execução não assenta. Isso cobre a espera na fila, a humanização, as
  re-tentativas e a chamada ao transport. Com envios sobrepostos, o prazo só volta a correr
  quando o último assenta, e volta com o tempo que sobrou.
- O mecanismo fica no `Deadline`: `hold(envio)` conta os envios pendentes da execução, e
  `armTimer(ms, fire)` é o timer do prazo que respeita a pausa. `settleWithin` (comando) e o
  barramento (listener) armam o timer por ele. Um envio feito antes de o timer armar (no trecho
  síncrono do `run`) já começa pausado.
- O `reply` pausado devolve uma promise nova, que assenta como o envio. Uma rejeição que o plugin
  ignora continua não tratada, como antes.
- Fica de fora o que não é do contexto da execução: o `ctx.send` do plugin (o kernel não sabe de
  qual execução a chamada veio), as ações de `ctx.groups` e o job do scheduler, que não tem
  `reply`. Esses continuam contando no prazo. O papel custom e a consulta de admin não enviam.
- **Benchmark (M2-4, #116):** os cenários de vazão (5.000 msg/s em 500 chats) rodam com
  `globalIntervalMs` e `chatIntervalMs` em 0. A taxa anti-ban é política e dominaria a medição.
  O benchmark mede o overhead do kernel, não o teto do D19.

## Consequências

- Rajada em chats diferentes não gera mais `plugin.error` falso. O chat segue preso enquanto o
  handler espera a própria resposta, porque é isso que mantém a ordem (ADR 0042), mas não fica
  preso além disso pelo prazo.
- Um handler que só responde (`await reply` em sequência) pode segurar o chat por mais tempo que
  `commandMs`, sempre limitado pelos tetos da fila de saída. Laço que responde para sempre
  segura o chat para sempre, como um laço que trabalha para sempre sem `await` (D33 não protege
  contra isso).
- O caminho quente paga, por `reply`, um incremento, um decremento e uma promise a mais. Os
  timers só são recriados na transição de pausa para corrida, não a cada envio.
- Um job que faz broadcast com `await ctx.send` em muitos chats ainda pode estourar `jobMs` pela
  taxa global. Se aparecer um caso real, um ADR novo liga o `send` ao prazo do job.
