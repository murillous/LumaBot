---
'@zapforge/core': minor
---

`bot.stats()` expõe as métricas das filas de entrada e de saída (#204). Ele devolve `{ inbound,
outbound }` com os contadores que as filas já mantinham: mensagens processadas, descartadas e com
erro; envios feitos, falhos, re-tentados e descartados; o backlog e se a fila de saída está pausada
pela conexão caída. A leitura é O(1) e cada chamada devolve uma cópia. Antes do `start()`, tudo é
zero; depois do `stop()`, ficam os valores finais. Novos tipos exportados: `BotStats`,
`InboundQueueStats` e `OutboundQueueStats`.
