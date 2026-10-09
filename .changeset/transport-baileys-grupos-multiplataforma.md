---
'@zapforge/transport-baileys': minor
---

Segue o contrato de grupos multiplataforma do core (ADR 0059). Os eventos `group.*` trazem o grupo
em `chat` no lugar de `groupId`, e o `group.updated` e o `getGroupMetadata` trazem o nome em
`title` (o `subject` do WhatsApp). O transport declara `groups.add`, `groups.remove` e
`groups.promote` no lugar de `groups.admin`. O comportamento no WhatsApp não muda.
