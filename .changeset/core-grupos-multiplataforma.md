---
'@zapforge/core': minor
---

Grupos multiplataforma (ADR 0059). **Quebra de API antes do 1.0.**

- O `Transport` ganha o método opcional `isChatAdmin(chat, contact)`. Com ele, o papel
  `group-admin` pergunta ao transport, com o `Chat` inteiro (inclusive o `parentId` do servidor),
  e não precisa da lista de participantes. Sem ele, o kernel segue procurando o remetente nos
  `participants` do `getGroupMetadata`, como antes.
- `GroupMetadata.participants` fica opcional: ausente onde a plataforma não lista membros. Sem a
  lista e sem `isChatAdmin`, o `group-admin` recusa. `GroupMetadata.subject` passa a se chamar
  `title`.
- A capability `groups.admin` dá lugar a `groups.add`, `groups.remove` e `groups.promote` (que vale
  também para `demote`). `ctx.groups.updateParticipants` cobra a capability da ação pedida. Troque
  `groups.admin` no `requires` dos plugins pela da ação que eles usam. O helper
  `groupActionCapability(action)` sai em `@zapforge/core/adapter`.
- Os eventos `group.joined`, `group.left`, `group.participants` e `group.updated` trocam `groupId`
  por `chat: Chat`, e `group.updated.subject` passa a se chamar `title`. O `chatFilter` casa
  `group.participants` e `group.updated` também pelo `chat.parentId`.
