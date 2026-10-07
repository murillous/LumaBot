---
'@zapforge/core': minor
---

O plugin passa a fazer pela API pública tudo o que o transport sabe, sem `ctx.unsafe.native`
(#224, ADR 0040). `ctx.send` ganha `react`, `edit`, `delete` e `presence`. Essas ações passam pela
fila de saída com as mesmas regras do envio e aceitam `{ priority }`. `ctx.groups` traz
`metadata(groupId)`, que lê direto no transport, e `updateParticipants(groupId, ids, action)`, que
passa pela fila. Sem a capability, a ação rejeita na hora com `UnsupportedError`; depois do
descarte do contexto, com `ContextExpiredError`.

Leituras novas no contexto: `ctx.commands.list()` traz os comandos de todos os plugins, sem o
`run`. `ctx.self` é o contato da sessão. `ctx.capabilities` informa o que o transport suporta, para
recurso opcional.

Toda `Message` traz `key` (`MessageKey`), derivada por `createMessage`, inclusive na citada. O
contexto de comando e o de listener de mensagem ganham o atalho `react(emoji)`, com prioridade
`'high'` e o mesmo prazo do `reply`. O transport pode emitir o evento novo `contact.updated`
(`{ id, name?, phone? }`), que passa sempre pelo `chatFilter`.

Novos tipos exportados: `Outbound`, `ActionOptions`, `Groups`, `CommandInfo`, `GroupMetadata`,
`GroupParticipant` e `Presence`. Quem monta `Message` à mão precisa preencher `key`.
