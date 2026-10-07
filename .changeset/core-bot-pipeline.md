---
'@zapforge/core': minor
---

Pipeline integrado no `Bot` (M1-16): `createBot()` passa a aceitar `storage`, `plugins`,
`pluginDirs`, `disabledPlugins`, `pluginConfig`, `owners`, `prefix`, `logger`/`logLevel`/
`secrets`, `middlewares`, `inbound`, `outbound`, `reconnection` e `timeouts`, e liga as peças do
M1: a mensagem do transport passa pela fila de entrada, pelos middlewares (`ignoreSelf` e
`sanitize` ligados por padrão), pelo roteador e, se não for comando, pelos listeners, com
`reply` e `log` no contexto; os plugins sobem com o contexto real (config, comandos, eventos,
serviços, storage, scheduler, `send`, `unsafe`), e conflito de comando derruba o boot. O `run`
de cada comando tem prazo (`timeouts.commandMs`, padrão 30 s): estourado, sai `plugin.error`
com `timedOut: true` (`CommandTimeoutError`) e o chat é liberado. O
`stop()` drena a fila de entrada, faz o `teardown` dos plugins, para o scheduler, drena a fila
de saída, desconecta e fecha o storage. A `ReconnectionPolicy` é executada pelo bot
(`reconnection.clearSession`), e `bot.config` expõe `setOverrides`/`describe`/`jsonSchema`.

Texto de trabalho `ctx.text` (`MessageContext.text`, `BotMessageContext`): o `sanitize` grava
nele o texto truncado (além de `ctx.sanitized`), e o roteador e os listeners o leem.

**Quebra:** `Contact.phone` (`string | null`, só dígitos) passa a ser obrigatório — transports
informam `null` quando não sabem o telefone — e `role: 'owner'` compara `owners` com
`sender.phone` em vez de `sender.id`. `ListenerContext` vira tipo condicional com
`message`/`text`/`reply`/`log` nos eventos de mensagem, e os extras de `bus.emit` passam a ser
opcionais em todo evento.
