---
'@zapforge/core': patch
---

O `close({ drain: false })` da fila de saída passa a alcançar o envio que está no "digitando"
da humanização (#229). Antes, depois da espera, a fila chamava `transport.send` mesmo já
descartada, até `humanize.maxMs` depois do shutdown, com o transport possivelmente desconectado.
Agora a espera é encerrada e o envio rejeita com `OutboundQueueError` `'closed'`, contado em
`dropped`, sem chegar ao transport.
