---
'@zapforge/core': minor
---

Evento `poll.vote` (ADR 0071): o voto numa enquete chega ao plugin com
`{ chat, messageId, sender, options, fromMe }`. `options` são os índices das opções marcadas, a
partir de 0, com a escolha inteira de quem votou (`[]` = voto retirado). O `chatFilter`, o
`ignoreSelf` e o `ignoreBots` valem para ele como para a `reaction`. Mudança aditiva: transports
que não emitem o evento seguem válidos.
