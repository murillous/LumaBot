# @zapforge/core — documentação

Como usar o kernel. O porquê das decisões está nos [ADRs](../../../docs/adr/README.md).

| Guia | Assunto |
| --- | --- |
| [Transport](transport.md) | Contrato `Transport`, eventos, capabilities e política de reconexão |
| [Bot e lifecycle](bot.md) | `createBot`, `start`/`stop`, estados e ganchos de parada |
| [Modelo de mensagem](message.md) | `Message`, narrowing, mídia lazy e `createMessage` para transports |
| [Fila de entrada](inbound-queue.md) | `InboundQueue`: mesmo chat em série, backlog, métricas, shutdown |
| [Middlewares](middleware.md) | Pipeline em onion com prioridade e os middlewares oficiais |
| [Comandos](commands.md) | `command()`, prefixo, aliases, args, `accepts`, `role`, conflitos |
| [Fila de saída](outbound-queue.md) | `OutboundQueue`: taxa global/por chat, prioridade, retry, humanização; `createReply` |
