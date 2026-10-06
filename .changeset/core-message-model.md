---
'@zapforge/core': minor
---

Modelo de mensagem (M1-3): `createMessage` para transports construírem mensagens normalizadas
(com `is()`, `quoted` recursivo, mentions e flags com padrões) e `createMedia`, com
`download()`/`stream()` lazy e cache por mensagem.
