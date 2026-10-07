---
'@zapforge/core': minor
---

`chatFilter` e `ignoreSelf` valem para os eventos que não são mensagem (#219, ADR 0038). Antes,
`reaction`, `message.deleted` e `group.*` iam direto aos listeners: chegavam de chat bloqueado, a
reação da própria sessão voltava para os plugins e o evento que chegava durante o boot se perdia.
Agora o bot aplica a mesma config de middlewares a esses eventos: o `chatFilter` barra `reaction`
e `message.deleted` por `chat.id` e `group.participants` e `group.updated` por `groupId`
(`group.joined` e `group.left` sempre passam), e o `ignoreSelf` barra a reação e a deleção com
`fromMe: true`. Esses eventos esperam o fim do boot, sem entrar na fila do chat.

**Breaking (adapters):** os payloads de `reaction` e `message.deleted` em `TransportEvents` ganham
o campo obrigatório `fromMe: boolean`, que o adapter preenche.
