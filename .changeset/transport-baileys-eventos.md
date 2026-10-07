---
'@zapforge/transport-baileys': minor
---

O transport passa a emitir os eventos do barramento além de `message` (#108): `reaction`,
`message.edited` (com `isEdited: true`), `message.deleted`, `group.participants`, `group.joined`,
`group.left`, `group.updated` e `contact.updated`. Todos seguem a fila das mensagens, na ordem de
chegada. O `contact.updated` sai na primeira mensagem de cada contato e depois só quando o nome ou
o telefone muda, antes da `message`. Reação, edição, apagamento e grupo completam o nome do
contato com o último `pushName` visto.
