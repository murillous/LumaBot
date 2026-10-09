---
'@zapforge/testing': minor
---

O `FakeTransport` segue o contrato de capabilities do core (ADR 0070): `sendTyping(chatId, kind)`
no lugar de `sendPresence`, com as chamadas gravadas em `typing` (`{ chatId, kind }`) no lugar de
`presences`, e cobra a capability `typing`.
