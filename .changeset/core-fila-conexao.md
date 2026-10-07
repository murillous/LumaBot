---
'@zapforge/core': minor
---

A fila de saída espera a reconexão em vez de perder as respostas (#198, ADR 0039). Antes, numa
queda de conexão, cada envio esgotava o retry em ~3 s, antes da primeira reconexão (5 s). Agora o
bot pausa a fila no `connection.status` `closed` e retoma no `open`. O que aguarda espera até
`outbound.maxPauseMs` (padrão 60 s); estourado esse teto, rejeita com `OutboundQueueError`
`'disconnected'`, e os envios novos rejeitam na hora até a conexão voltar. O `stop()` com a
conexão caída descarta o que aguarda em vez de gastar o prazo drenando.

Toda chamada da fila ao transport ganha prazo, `outbound.sendTimeoutMs` (padrão 30 s; #202). Um
`transport.send` sem resposta rejeita com `OutboundQueueError` `'timeout'`, sem re-tentar, e libera
o chat. Presença sem resposta vai para `onPresenceError`, e o envio segue.

`OutboundQueueError['reason']` ganha `'disconnected'` e `'timeout'`.
