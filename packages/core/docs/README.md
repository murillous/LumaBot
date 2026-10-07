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
| [Storage](storage.md) | KV e coleções por plugin, auth state, adapter em memória e suíte de contrato |
| [Plugins](plugins.md) | `definePlugin`, manifesto, fontes (config + `pluginDirs`), ordem, tabela de boot, `setup`/`teardown`/`reload` |
| [Fila de saída](outbound-queue.md) | `OutboundQueue`: taxa global/por chat, prioridade, retry, humanização; `createReply` |
| [Eventos](events.md) | Barramento: eventos do §6.4, filtros, prioridade, `claim()`, isolamento |
| [Services](services.md) | `ctx.services`: `provide`/`get` tipados por declaration merging, erros, registry |
| [Logger](logger.md) | `createLogger`, níveis, contexto `plugin`/`chatId`, `err`, redação de segredos |
| [Escape hatch](unsafe.md) | `ctx.unsafe.native`, aviso no log e `transports` no manifesto |
