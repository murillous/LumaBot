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
- O descarte por fila cheia já é visível: um `warn` por mensagem descartada
  (`mensagem descartada pela fila de entrada`, com `reason: 'full'`) e `bot.stats().inbound.dropped`.

## Consequências

- A ordem por chat continua garantida para comandos e listeners, como no legacy.
- O prazo de 30 s é o teto de quanto um handler preso segura o chat. Num grupo com mais de 100
  mensagens nesse intervalo, as excedentes são perdidas.
- Trabalho solto sai do prazo do bus e do `plugin.error`: o plugin responde pelo próprio timeout
  (`AbortSignal.timeout`) e pelo destino do erro. Duas execuções soltas do mesmo chat podem
  terminar fora de ordem.
- O benchmark do M2-4 (500 chats, listener com latência) mede o efeito. Se a vazão não bastar,
  um ADR novo reabre o opt-in.
