---
'@zapforge/testing': minor
---

O `FakeTransport` segue o contrato de grupos multiplataforma do core (ADR 0059): o
`updateGroupParticipants` cobra `groups.add`, `groups.remove` ou `groups.promote` conforme a ação,
e não mais `groups.admin`. O grupo registrado com `setGroup` ou `groups` usa `title` no lugar de
`subject`.
