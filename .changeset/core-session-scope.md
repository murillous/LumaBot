---
'@zapforge/core': minor
---

Escopo de sessão (M1-20, ADR 0036). `createBot({ session })` (padrão `'default'`, kebab-case)
põe no escopo da sessão tudo o que o bot persiste: storage dos plugins, jobs do scheduler e
overrides de config. Bots de sessões diferentes dividem um storage sem interferir; a mesma
sessão em dois bots vivos no mesmo storage faz o `start()` do segundo rejeitar com
`BotConfigError`, e o storage compartilhado só fecha quando o último bot para. A sessão
`'default'` mantém o formato atual dos namespaces. Nome de plugin com `:` passa a lançar
`ReservedNamespaceError`. `DisconnectReason` ganha `'replaced'` (conexão assumida por outra da
mesma sessão): a `ReconnectionPolicy` decide `{ action: 'stop' }` e o bot para com erro no log,
sem reconectar.
