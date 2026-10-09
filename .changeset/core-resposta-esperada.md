---
'@zapforge/core': minor
---

Resposta esperada: conversa com estado sem segurar o chat (ADR 0060).

- `ctx.conversations.define(step, handler)` define um passo de conversa do plugin.
- `expectReply(step, { data, ttlMs })`, nos contextos de comando, de listener de mensagem e do
  próprio passo, manda a próxima mensagem do remetente, naquele chat, ao passo. O handler pergunta,
  registra a espera e termina, sem segurar o chat na fila de entrada.
- Há uma espera por (chat, remetente), e a última registrada substitui a anterior. Um comando
  digitado no meio da conversa cancela a espera e roda normalmente. A espera expira sem aviso
  (padrão: 5 minutos), fica em memória e é descartada no reload do plugin e no `stop()`.
- O passo tem o prazo do comando (`StepTimeoutError`). Uma falha nele vira `plugin.error` com a
  fase nova `'step'`. Quem faz `switch` exaustivo sobre `PluginErrorEvent.phase` precisa tratar o
  valor novo.
- Novos exports: `StepTimeoutError` e os tipos `Conversations`, `ExpectReply`,
  `ExpectReplyOptions`, `StepContext` e `StepHandler`.
