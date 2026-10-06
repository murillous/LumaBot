# @zapforge/core — documentação

Como usar o kernel. O porquê das decisões está nos [ADRs](../../../docs/adr/README.md).

| Guia | Assunto |
| --- | --- |
| [Transport](transport.md) | Contrato `Transport`, eventos, capabilities e política de reconexão |
| [Bot e lifecycle](bot.md) | `createBot`, `start`/`stop`, estados e ganchos de parada |
| [Modelo de mensagem](message.md) | `Message`, narrowing, mídia lazy e `createMessage` para transports |
| [Fila de entrada](inbound-queue.md) | `InboundQueue`: mesmo chat em série, backlog, métricas, shutdown |
