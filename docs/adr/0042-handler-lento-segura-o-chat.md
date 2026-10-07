# ADR 0042 — Comando e listener lentos seguram o chat

**Status:** Aceito (2026-10-07) · Detalha **D12** ([ADR 0012](0012-pipeline-de-3-estagios.md)) e
**D05** ([ADR 0005](0005-plugins-no-mesmo-processo.md))

## Contexto

A fila de entrada põe o mesmo chat em série (plano §5.3, porta do `JidQueue` do legacy). A tarefa
dela é o tratamento inteiro da mensagem: middlewares, roteador e `bus.emit('message')`, que só
resolve quando todos os listeners assentam. Por isso um handler lento segura a próxima mensagem do
chat até terminar ou estourar o prazo (`timeouts.commandMs` e `timeouts.listenerMs`, 30 s cada)
(#227). Isso vale para listener (a Luma esperando o LLM) e também para comando (um `!sticker` com
ffmpeg). Num grupo movimentado, o backlog chega a `inbound.maxPendingPerChat` (100), e as
mensagens novas, inclusive comandos, passam a ser descartadas.

O legacy faz o mesmo, e pior: os `onMessage` rodam um depois do outro dentro da fila do JID, e a
Luma espera o LLM ali. A ordem por chat é o que protege o estado por conversa dela: o histórico
(`chat:remetente`) e o buffer de contexto do grupo.

Alternativas consideradas:

- **Listeners não seguram o chat**: libera a fila depois do roteador. Perde a ordem de quem guarda
  estado por conversa e quebra a volta da cebola (ADR 0012): o middleware deixa de medir o
  tratamento inteiro e de manter o "digitando".
- **Worker threads para plugins**: o trabalho pesado do legacy já roda fora da thread do JS
  (yt-dlp e ffmpeg como processos, sharp no pool do libuv). O que trava é a ordem do chat, e o
  comando esperaria o worker do mesmo jeito. Um plugin com CPU pesada em JS pode usar
  `node:worker_threads` direto; uma API no core espera um caso real.
- **Opt-in por listener** (`on('message', { holdsChat: false }, …)`): muda o contrato público do
  barramento sem um caso concreto que precise disso hoje. Pode ser proposto quando um plugin do
  M5 mostrar a necessidade.

## Decisão

- Comando e listener seguram a fila do chat até terminar ou estourar o prazo. O comportamento
  não muda: este ADR registra a consequência.
- Um handler que leva segundos e não precisa de ordem com as mensagens seguintes **se solta**:
  responde ou reivindica (`claim()`) rápido e continua sem `await`, numa promise com `catch`
  próprio. O contexto continua válido depois que o handler termina (`reply`, `signal` e o `send`
  do plugin), até o plugin descer.
- O comando ganha `timeoutMs` opcional (`command({ timeoutMs })`), que vale para o `run` e o
  `onReject` dele. Sem ele, vale `timeouts.commandMs`. O listener já tinha o equivalente em
  `on(evento, { timeoutMs })`. Assim um download de minutos não obriga a subir o prazo de todos os
  comandos, e um comando travado por bug continua liberando o chat em 30 s. A consulta de admin e
  os papéis custom continuam com o `commandMs`: não são código do comando.
- O descarte por fila cheia já é visível: um `warn` por mensagem descartada
  (`mensagem descartada pela fila de entrada`, com `reason: 'full'`) e `bot.stats().inbound.dropped`.

## Consequências

- A ordem por chat continua garantida para comandos e listeners, como no legacy.
- O prazo (30 s, ou o `timeoutMs` do handler) é o teto de quanto um handler preso segura o chat. Num grupo com mais de 100
  mensagens nesse intervalo, as excedentes são perdidas. Middleware do app não tinha prazo e
  escapava desse teto; o [ADR 0043](0043-prazo-de-middleware.md) deu um a ele
  (`timeouts.middlewareMs`).
- Trabalho solto sai do prazo do bus e do `plugin.error`: o plugin responde pelo próprio timeout
  (`AbortSignal.timeout`) e pelo destino do erro. Duas execuções soltas do mesmo chat podem
  terminar fora de ordem.
- O benchmark do M2-4 (500 chats, listener com latência) mede o efeito. Se a vazão não bastar,
  um ADR novo reabre o opt-in.
