---
'@zapforge/core': minor
---

Transport por fábrica (M1-21, ADR 0037). `BotConfig.transport` aceita também
`(deps: TransportDeps) => Transport`: o `createBot` chama a fábrica uma vez, sem I/O, com a
`session`, o `auth` (`storage.authState(session)`) e um `log` filho do logger do bot
(`{ transport: name }`, com a censura de segredos), que descarta as linhas até o `start()`.
Fábrica que lança vira `BotConfigError` com o erro em `cause`. Com fábrica, a decisão
`clean-session` da reconexão limpa o `auth` sem `reconnection.clearSession`, que segue como
override. `TransportDeps` sai em `@zapforge/core/adapter`. Instâncias prontas continuam aceitas.
