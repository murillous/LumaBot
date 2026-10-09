# @zapforge/core — documentação

Como usar o kernel. O porquê das decisões está nos [ADRs](../../../docs/adr/README.md).

## Pontos de entrada

A API pública se divide por público ([ADR 0034](../../../docs/adr/0034-biblioteca-sem-runner.md)):

| Import | Para quem | O que traz |
| --- | --- | --- |
| `@zapforge/core` | Autor de plugin e app | `definePlugin`, `command`, `secret`, tipos dos contextos, eventos, mensagem, storage do plugin e os erros que o plugin trata; `createBot` e sua config, middlewares oficiais, `createLogger`, `createSecretSet`, `createMemoryStorage` |
| `@zapforge/core/adapter` | Autor de transport ou storage | Contratos `Transport`/`StoragePort`, `TypedEmitter`, `createMessage`, `createMedia`, `messageKey`, `ReconnectionPolicy`, helpers de capability, normalização de consultas, `StorageClosedError` |
| `@zapforge/core/storage-contract` | Autor de storage | Suíte de contrato (`defineStorageContract`) |

O adapter usa também o modelo compartilhado de `@zapforge/core` (`Message`, `MessageKey`,
`OutgoingContent`, tipos de storage). Host de plugins, barramento, filas, scheduler e roteador
são internos: os guias abaixo mostram como funcionam, mas os exemplos com import `#…` só valem
dentro do core. A lista de cada entrada é fixada em `src/entries.test.ts`; export novo é decisão
explícita.

| Guia | Assunto |
| --- | --- |
| [Transport](transport.md) | Contrato `Transport`, eventos, capabilities e política de reconexão |
| [Bot](bot.md) | `createBot` e opções, fluxo da mensagem, ordem de boot e shutdown, reconexão, exemplo ponta a ponta |
| [Modelo de mensagem](message.md) | `Message`, narrowing, mídia lazy e `createMessage` para transports |
| [Fila de entrada](inbound-queue.md) | `InboundQueue`: mesmo chat em série, backlog, métricas, shutdown |
| [Middlewares](middleware.md) | Pipeline em onion com prioridade e os middlewares oficiais |
| [Comandos](commands.md) | `command()`, prefixo, aliases, args, `accepts`, `role`, conflitos |
| [Conversas](conversations.md) | Resposta esperada: `expectReply` e `ctx.conversations.define`, sem segurar o chat |
| [Storage](storage.md) | KV e coleções por plugin, auth state, adapter em memória e suíte de contrato |
| [Scheduler](scheduler.md) | `ctx.scheduler`: `at`/`on`/`cancel`, persistência, restart, entrega pelo menos uma vez |
| [Plugins](plugins.md) | `definePlugin`, manifesto, fontes (config + `pluginDirs`), ordem, tabela de boot, `setup`/`teardown`/`reload` |
| [Fila de saída](outbound-queue.md) | `OutboundQueue`: taxa global/por chat, prioridade, retry, humanização; `createReply` |
| [Eventos](events.md) | Barramento: eventos do §6.4, filtros, prioridade, `claim()`, isolamento |
| [Services](services.md) | `ctx.services`: `provide`/`get` tipados por declaration merging, erros, registry |
| [Logger](logger.md) | `createLogger`, níveis, contexto `plugin`/`chatId`, `err`, redação de segredos |
| [Escape hatch](unsafe.md) | `ctx.unsafe.native`, aviso no log e `transports` no manifesto |
| [Config](config.md) | Config por plugin com Zod: precedência env > arquivo > overrides > default, `secret`, `messages`, reload, `owners` |
