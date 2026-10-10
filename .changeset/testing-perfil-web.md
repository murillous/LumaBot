---
'@zapforge/testing': minor
---

O perfil `web` passa a declarar o que o `@zapforge/transport-web` declara (ADR 0077): ganha
`send.video`, `send.audio`, `quoted`, `message.edit` e `message.delete`. Um teste no transport
confere os dois. Um teste de plugin no perfil `web` que contava com a resposta sem citação passa a
vê-la citando a mensagem.
