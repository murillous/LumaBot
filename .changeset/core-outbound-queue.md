---
'@zapforge/core': minor
---

Fila de saída anti-ban (M1-12): `OutboundQueue` implementa `Sender` com intervalo mínimo global e
por chat, prioridade `high` > `normal` > `low` (FIFO no chat), retry com backoff exponencial e
jitter só para falhas transitórias, humanização opcional (presença `composing`/`recording`),
limite de backlog, `stats()` e `close({ drain })` para o shutdown. `createReply(sender, message)`
monta o `ctx.reply` (texto e atalhos por tipo), citando a mensagem com prioridade `high`.
