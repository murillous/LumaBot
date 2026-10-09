---
'@zapforge/transport-baileys': minor
---

Segue o contrato de capabilities do core (ADR 0070). O transport declara `typing` no lugar de
`presence` e implementa `sendTyping`: `text` envia a presença `composing`, e `voice`, a `recording`.
A enquete com `multiple: true` sai com `selectableCount` 0 (quantas quiser); sem ela, 1. O status
online global fica no socket nativo.
